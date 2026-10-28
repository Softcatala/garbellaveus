import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionService } from './subscription.service';
import { EmailService } from '../email/email.service';
import { MetricsService } from '../observability/metrics.service';
import { EmailSubscription } from '../domain/email-subscription.entity';
import { EmailUuidLink } from '../domain/email-uuid-link.entity';
import { Clip } from '../domain/clip.entity';
import { Transcription } from '../domain/transcription.entity';
import { Vote } from '../domain/vote.entity';
import { IssueReport } from '../domain/issue-report.entity';
import { createConfirmToken, createUnsubscribeToken } from '../email/email-token';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let subs: Repository<EmailSubscription>;
  let links: Repository<EmailUuidLink>;
  let votes: Repository<Vote>;
  let metrics: MetricsService;
  const email = { sendQuietly: jest.fn().mockResolvedValue(true), buildConfirmation: jest.fn((to: string, u: string) => ({ to, u })) };

  beforeAll(() => {
    process.env.HMAC_SECRET_KEY = 'test-secret';
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [EmailSubscription, EmailUuidLink, Clip, Transcription, Vote, IssueReport],
          synchronize: true,
          // Needed so ON DELETE CASCADE is honoured like in the real database file.
          extra: {},
        }),
        TypeOrmModule.forFeature([EmailSubscription, EmailUuidLink, Vote, Clip]),
      ],
      providers: [SubscriptionService, MetricsService, { provide: EmailService, useValue: email }],
    }).compile();
    service = module.get(SubscriptionService);
    metrics = module.get(MetricsService);
    subs = module.get(getRepositoryToken(EmailSubscription));
    links = module.get(getRepositoryToken(EmailUuidLink));
    votes = module.get(getRepositoryToken(Vote));
    const clips: Repository<Clip> = module.get(getRepositoryToken(Clip));
    for (const id of ['c1', 'c2', 'c3']) await clips.save(clips.create({ clipId: id }));
  });

  const vote = (clipId: string, username: string, dimension = 'transcription') =>
    votes.save(votes.create({ clipId, dimension, username, targetId: '1', value: 1, createdAt: new Date().toISOString() }));

  describe('requestConfirmation', () => {
    it('sends a confirmation email and stores nothing', async () => {
      await service.requestConfirmation(' Ada@Example.org ', 'u1');
      expect(email.buildConfirmation).toHaveBeenCalledWith('ada@example.org', 'u1');
      expect(email.sendQuietly).toHaveBeenCalledTimes(1);
      expect(await subs.count()).toBe(0);
      expect(await links.count()).toBe(0);
    });

    it('rate-limits repeated requests for the same address or the same username', async () => {
      await service.requestConfirmation('a@b.cat', 'u1');
      await expect(service.requestConfirmation('a@b.cat', 'u2')).rejects.toMatchObject({ status: 429 });
      await expect(service.requestConfirmation('other@b.cat', 'u1')).rejects.toMatchObject({ status: 429 });
      await service.requestConfirmation('other@b.cat', 'u3');
      expect(email.sendQuietly).toHaveBeenCalledTimes(2);
    });

    it('does not re-send when the address is already confirmed for that username', async () => {
      await service.confirm(createConfirmToken('a@b.cat', 'u1'));
      await service.requestConfirmation('a@b.cat', 'u1');
      expect(email.sendQuietly).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('creates the subscription and links the username', async () => {
      await service.confirm(createConfirmToken('Ada@Example.org', 'u1'));
      const [sub] = await subs.find();
      expect(sub).toMatchObject({ email: 'ada@example.org', consentVersion: 'v1', reminderCount: 0 });
      expect(await links.find()).toMatchObject([{ username: 'u1', subscriptionId: sub.id }]);
    });

    it('is idempotent', async () => {
      const token = createConfirmToken('a@b.cat', 'u1');
      await service.confirm(token);
      await service.confirm(token);
      expect(await subs.count()).toBe(1);
      expect(await links.count()).toBe(1);
    });

    it('lets one username hold several addresses and one address several usernames', async () => {
      await service.confirm(createConfirmToken('a@b.cat', 'u1'));
      await service.confirm(createConfirmToken('c@d.cat', 'u1'));
      await service.confirm(createConfirmToken('a@b.cat', 'u2'));
      expect(await subs.count()).toBe(2);
      expect(await links.count()).toBe(3);
    });

    it('rejects invalid tokens without writing anything', async () => {
      await expect(service.confirm('nonsense')).rejects.toMatchObject({ status: 400 });
      await expect(service.confirm(createUnsubscribeToken('a@b.cat'))).rejects.toMatchObject({ status: 400 });
      expect(await subs.count()).toBe(0);
    });
  });

  describe('metrics', () => {
    const events = async () => {
      const out: Record<string, number> = {};
      for (const v of (await metrics.emailSubscriptionEventsTotal.get()).values) out[v.labels.event as string] = v.value;
      return out;
    };
    const subscribers = async () => (await metrics.emailSubscribers.get()).values[0]?.value;

    it('counts requests, rate limiting, confirmations and unsubscribes and tracks the subscriber gauge', async () => {
      await service.requestConfirmation('a@b.cat', 'u1');
      await expect(service.requestConfirmation('a@b.cat', 'u1')).rejects.toBeDefined();
      await service.confirm(createConfirmToken('a@b.cat', 'u1'));
      await service.confirm(createConfirmToken('a@b.cat', 'u1')); // idempotent: not counted again
      expect(await subscribers()).toBe(1);
      await service.unsubscribe(createUnsubscribeToken('a@b.cat'));
      expect(await subscribers()).toBe(0);
      expect(await events()).toEqual({ requested: 1, rate_limited: 1, confirmed: 1, unsubscribed: 1 });
    });
  });

  describe('status', () => {
    it('counts distinct clips answered, not individual vote rows', async () => {
      await vote('c1', 'u1');
      await vote('c1', 'u1', 'dialect');
      await vote('c2', 'u1');
      await vote('c3', 'someone-else');
      expect(await service.status('u1')).toEqual({ subscribed: false, validations: 2 });
    });

    it('reports subscribed once the username has a confirmed address', async () => {
      await service.confirm(createConfirmToken('a@b.cat', 'u1'));
      expect((await service.status('u1')).subscribed).toBe(true);
      expect((await service.status('u2')).subscribed).toBe(false);
    });
  });

  describe('unsubscribe', () => {
    it('deletes the address and all its links but keeps the anonymous votes', async () => {
      await service.confirm(createConfirmToken('a@b.cat', 'u1'));
      await service.confirm(createConfirmToken('a@b.cat', 'u2'));
      await service.confirm(createConfirmToken('keep@b.cat', 'u1'));
      await vote('c1', 'u1');

      await service.unsubscribe(createUnsubscribeToken('A@B.cat'));

      expect((await subs.find()).map((s) => s.email)).toEqual(['keep@b.cat']);
      expect(await links.count()).toBe(1);
      expect(await votes.count()).toBe(1);
      expect((await service.status('u2')).subscribed).toBe(false);
      expect((await service.status('u1')).subscribed).toBe(true); // still has keep@b.cat
    });

    it('is idempotent and silent about unknown addresses', async () => {
      await expect(service.unsubscribe(createUnsubscribeToken('nobody@b.cat'))).resolves.toBeUndefined();
    });

    it('rejects a bad token', async () => {
      await expect(service.unsubscribe('bad')).rejects.toMatchObject({ status: 400 });
    });
  });
});
