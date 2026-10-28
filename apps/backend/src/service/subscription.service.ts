import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailSubscription } from '../domain/email-subscription.entity';
import { EmailUuidLink } from '../domain/email-uuid-link.entity';
import { Vote } from '../domain/vote.entity';
import { EmailService } from '../email/email.service';
import { normalizeEmail, verifyConfirmToken, verifyUnsubscribeToken } from '../email/email-token';

// Bumped whenever the consent wording shown in the prompt changes materially.
export const CONSENT_VERSION = 'v1';

// Confirmation requests are unauthenticated and, being stateless, would otherwise
// let anyone make us mail an arbitrary address. Cooldowns per address and per
// anonymous username, plus a global hourly cap, bound that. In-memory is enough:
// a restart only resets the counters.
const COOLDOWN_MS = 60_000;
const GLOBAL_HOURLY_CAP = 100;
const HOUR_MS = 3_600_000;

@Injectable()
export class SubscriptionService {
  private readonly lastRequest = new Map<string, number>();
  private recentRequests: number[] = [];

  constructor(
    @InjectRepository(EmailSubscription) private readonly subscriptions: Repository<EmailSubscription>,
    @InjectRepository(EmailUuidLink) private readonly links: Repository<EmailUuidLink>,
    @InjectRepository(Vote) private readonly votes: Repository<Vote>,
    private readonly email: EmailService,
  ) {}

  private checkRateLimit(email: string, username: string, now: number): void {
    this.recentRequests = this.recentRequests.filter((t) => now - t < HOUR_MS);
    const keys = [`e:${email}`, `u:${username}`];
    const limited =
      this.recentRequests.length >= GLOBAL_HOURLY_CAP ||
      keys.some((k) => now - (this.lastRequest.get(k) ?? -Infinity) < COOLDOWN_MS);
    if (limited) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    for (const k of keys) this.lastRequest.set(k, now);
    this.recentRequests.push(now);
    // Opportunistic cleanup so the map cannot grow without bound.
    if (this.lastRequest.size > 10_000) {
      for (const [k, t] of this.lastRequest) if (now - t >= COOLDOWN_MS) this.lastRequest.delete(k);
    }
  }

  // Step 1 of the double opt-in. Persists nothing: the signed token in the email
  // is the pending request. Always looks the same to the caller, so the response
  // does not reveal whether an address is already subscribed.
  async requestConfirmation(rawEmail: string, username: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    this.checkRateLimit(email, username, Date.now());

    const existing = await this.subscriptions.findOne({ where: { email } });
    if (existing && (await this.links.findOne({ where: { subscriptionId: existing.id, username } }))) {
      return; // already confirmed from this browser; nothing to do
    }
    // Sent in the background: an SMTP outage must not fail the request, and the
    // person can simply ask again.
    void this.email.sendQuietly(this.email.buildConfirmation(email, username), 'confirmation');
  }

  // Step 2: the emailed link was opened. Idempotent.
  async confirm(token: string): Promise<void> {
    const payload = verifyConfirmToken(token);
    if (!payload) throw new BadRequestException('Invalid or expired link');

    let subscription = await this.subscriptions.findOne({ where: { email: payload.email } });
    if (!subscription) {
      subscription = await this.subscriptions.save(
        this.subscriptions.create({
          email: payload.email,
          consentedAt: new Date().toISOString(),
          consentVersion: CONSENT_VERSION,
          reminderSentAt: null,
          reminderCount: 0,
        }),
      );
    }
    const link = await this.links.findOne({ where: { subscriptionId: subscription.id, username: payload.username } });
    if (!link) {
      await this.links.save(this.links.create({ subscriptionId: subscription.id, username: payload.username }));
    }
  }

  // Drives the prompt: how many clips this username has answered (positive or
  // negative — skips are never stored server-side) and whether it already has a
  // confirmed address.
  async status(username: string): Promise<{ subscribed: boolean; validations: number }> {
    const row = await this.votes
      .createQueryBuilder('v')
      .select('COUNT(DISTINCT v.clip_id)', 'n')
      .where('v.username = :username', { username })
      .getRawOne<{ n: string }>();
    const subscribed = (await this.links.count({ where: { username } })) > 0;
    return { subscribed, validations: Number(row?.n) || 0 };
  }

  // Deletes the address and every link to a username. Votes are untouched: they
  // only ever held the anonymous username, so afterwards nothing connects the
  // address to any validation. Idempotent and silent about unknown addresses.
  async unsubscribe(token: string): Promise<void> {
    const email = verifyUnsubscribeToken(token);
    if (!email) throw new BadRequestException('Invalid link');
    const subscription = await this.subscriptions.findOne({ where: { email } });
    if (!subscription) return;
    await this.links.delete({ subscriptionId: subscription.id });
    await this.subscriptions.delete(subscription.id);
  }
}
