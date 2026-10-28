import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReminderService, nextRun, REMINDER_INTERVAL_MS } from './reminder.service';
import { EmailService } from '../email/email.service';
import { ClipService } from './clip.service';
import { TranscriptionService } from './transcription.service';
import { EmailSubscription } from '../domain/email-subscription.entity';
import { EmailUuidLink } from '../domain/email-uuid-link.entity';
import { Clip } from '../domain/clip.entity';
import { Transcription } from '../domain/transcription.entity';
import { Vote } from '../domain/vote.entity';
import { IssueReport } from '../domain/issue-report.entity';

const DAY = 24 * 3_600_000;
const NOW = new Date('2026-03-04T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('ReminderService', () => {
  let service: ReminderService;
  let subs: Repository<EmailSubscription>;
  let links: Repository<EmailUuidLink>;
  let votes: Repository<Vote>;
  const email = {
    smtpConfigured: true,
    buildReminder: jest.fn((to: string, clips: number) => ({ to, clips })),
    send: jest.fn().mockResolvedValue(true),
  };

  const clipService = { nextForEvaluation: jest.fn() };
  const transcriptionService = { findByClip: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    email.send.mockResolvedValue(true);
    clipService.nextForEvaluation.mockResolvedValue(null);
    transcriptionService.findByClip.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [EmailSubscription, EmailUuidLink, Clip, Transcription, Vote, IssueReport],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([EmailSubscription, EmailUuidLink, Vote, Clip]),
      ],
      providers: [
        ReminderService,
        { provide: EmailService, useValue: email },
        { provide: ClipService, useValue: clipService },
        { provide: TranscriptionService, useValue: transcriptionService },
      ],
    }).compile();
    service = module.get(ReminderService);
    subs = module.get(getRepositoryToken(EmailSubscription));
    links = module.get(getRepositoryToken(EmailUuidLink));
    votes = module.get(getRepositoryToken(Vote));
    const clips: Repository<Clip> = module.get(getRepositoryToken(Clip));
    for (const id of ['c1', 'c2']) await clips.save(clips.create({ clipId: id }));
  });

  async function subscriber(opts: { lastVote?: string; consented?: string; sentAt?: string | null; count?: number; username?: string }) {
    const username = opts.username ?? 'u1';
    const sub = await subs.save(
      subs.create({
        email: `${username}@x.cat`,
        consentedAt: opts.consented ?? ago(60 * DAY),
        consentVersion: 'v1',
        reminderSentAt: opts.sentAt ?? null,
        reminderCount: opts.count ?? 0,
      }),
    );
    await links.save(links.create({ username, subscriptionId: sub.id }));
    if (opts.lastVote) {
      await votes.save(votes.create({ clipId: 'c1', dimension: 'transcription', username, targetId: '1', value: 1, createdAt: opts.lastVote }));
    }
    return sub;
  }

  it('reminds someone who has been quiet for a week, with their clip count', async () => {
    await subscriber({ lastVote: ago(8 * DAY) });
    expect(await service.sendDueReminders(NOW)).toBe(1);
    expect(email.buildReminder).toHaveBeenCalledWith('u1@x.cat', 1, undefined);
    const [sub] = await subs.find();
    expect(sub).toMatchObject({ reminderCount: 1, reminderSentAt: NOW.toISOString() });
  });

  it('skips people who voted within the last week', async () => {
    await subscriber({ lastVote: ago(2 * DAY) });
    expect(await service.sendDueReminders(NOW)).toBe(0);
  });

  it('skips someone who consented within the last week even if their last vote is old', async () => {
    await subscriber({ lastVote: ago(30 * DAY), consented: ago(1 * DAY) });
    expect(await service.sendDueReminders(NOW)).toBe(0);
  });

  it('never reminds someone with no votes', async () => {
    await subscriber({});
    expect(await service.sendDueReminders(NOW)).toBe(0);
  });

  it('spaces reminders a week apart and stops after three without activity', async () => {
    const sub = await subscriber({ lastVote: ago(60 * DAY), sentAt: ago(3 * DAY), count: 1 });
    expect(await service.sendDueReminders(NOW)).toBe(0); // sent 3 days ago
    await subs.update(sub.id, { reminderSentAt: ago(8 * DAY), reminderCount: 3 });
    expect(await service.sendDueReminders(NOW)).toBe(0); // cap reached
  });

  it('resets the cap once the person votes again after the last reminder', async () => {
    await subscriber({ lastVote: ago(8 * DAY), sentAt: ago(20 * DAY), count: 3 });
    expect(await service.sendDueReminders(NOW)).toBe(1);
    expect((await subs.find())[0].reminderCount).toBe(1);
  });

  it('does not record a send the SMTP server did not accept', async () => {
    await subscriber({ lastVote: ago(8 * DAY) });
    email.send.mockResolvedValue(false);
    expect(await service.sendDueReminders(NOW)).toBe(0);
    expect((await subs.find())[0]).toMatchObject({ reminderCount: 0, reminderSentAt: null });
  });

  it('survives an SMTP error and carries on with the next subscriber', async () => {
    await subscriber({ lastVote: ago(8 * DAY), username: 'u1' });
    await subscriber({ lastVote: ago(8 * DAY), username: 'u2' });
    email.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
    expect(await service.sendDueReminders(NOW)).toBe(1);
  });

  it('pools votes across every uuid linked to the address', async () => {
    const sub = await subscriber({ lastVote: ago(30 * DAY), username: 'old' });
    await links.save(links.create({ username: 'new', subscriptionId: sub.id }));
    await votes.save(votes.create({ clipId: 'c2', dimension: 'transcription', username: 'new', targetId: '1', value: 1, createdAt: ago(1 * DAY) }));
    expect(await service.sendDueReminders(NOW)).toBe(0); // voted yesterday from the other browser
  });

  describe('clip card', () => {
    const clip = (clipId: string, candidate1 = 'text del candidat') => ({ clipId, candidate1, candidate2: null });

    it('shows a clip with its best transcription', async () => {
      await subscriber({ lastVote: ago(8 * DAY) });
      clipService.nextForEvaluation.mockResolvedValue(clip('c2'));
      transcriptionService.findByClip.mockResolvedValue([
        { id: 1, clipId: 'c2', origin: 'gemini', text: 'hola bon dia' },
      ]);
      await service.sendDueReminders(NOW);
      expect(clipService.nextForEvaluation).toHaveBeenCalledWith('u1', 'transcription', []);
      expect(email.buildReminder).toHaveBeenCalledWith('u1@x.cat', 1, { clipId: 'c2', text: 'hola bon dia' });
    });

    it('falls back to the dataset candidate when the clip has no transcription rows', async () => {
      await subscriber({ lastVote: ago(8 * DAY) });
      clipService.nextForEvaluation.mockResolvedValue(clip('c2'));
      await service.sendDueReminders(NOW);
      expect(email.buildReminder).toHaveBeenCalledWith('u1@x.cat', 1, { clipId: 'c2', text: 'text del candidat' });
    });

    it('skips a clip another linked uuid already answered and picks the next', async () => {
      const sub = await subscriber({ lastVote: ago(8 * DAY), username: 'a' });
      await links.save(links.create({ username: 'b', subscriptionId: sub.id }));
      await votes.save(votes.create({ clipId: 'c2', dimension: 'transcription', username: 'b', targetId: '1', value: 1, createdAt: ago(9 * DAY) }));
      clipService.nextForEvaluation
        .mockResolvedValueOnce(clip('c2'))
        .mockResolvedValueOnce(clip('c3'));
      await service.sendDueReminders(NOW);
      expect(clipService.nextForEvaluation).toHaveBeenLastCalledWith('a', 'transcription', ['c2']);
      expect(email.buildReminder).toHaveBeenCalledWith('a@x.cat', 2, { clipId: 'c3', text: 'text del candidat' });
    });

    it('still sends the reminder, without a card, when no clip can be picked', async () => {
      await subscriber({ lastVote: ago(8 * DAY) });
      clipService.nextForEvaluation.mockRejectedValue(new Error('db down'));
      expect(await service.sendDueReminders(NOW)).toBe(1);
      expect(email.buildReminder).toHaveBeenCalledWith('u1@x.cat', 1, undefined);
    });
  });

  it('uses the weekly interval Arena uses', () => {
    expect(REMINDER_INTERVAL_MS).toBe(7 * DAY);
  });
});

describe('nextRun', () => {
  it('is the next Monday 10:00 Madrid time (CET in winter)', () => {
    expect(nextRun(new Date('2026-03-04T12:00:00Z')).toISOString()).toBe('2026-03-09T09:00:00.000Z');
  });
  it('is 08:00 UTC in summer (CEST)', () => {
    expect(nextRun(new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-07-06T08:00:00.000Z');
  });
  it('rolls a week forward once this Monday 10:00 has passed', () => {
    expect(nextRun(new Date('2026-03-09T09:00:00Z')).toISOString()).toBe('2026-03-16T09:00:00.000Z');
    expect(nextRun(new Date('2026-03-09T08:59:00Z')).toISOString()).toBe('2026-03-09T09:00:00.000Z');
  });
  it('handles the DST change week', () => {
    // Clocks go forward on Sun 2026-03-29; Monday 30th 10:00 is CEST = 08:00Z.
    expect(nextRun(new Date('2026-03-27T12:00:00Z')).toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });
});
