import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmailSubscription } from '../domain/email-subscription.entity';
import { Vote } from '../domain/vote.entity';
import { EmailService } from '../email/email.service';
import { ClipService } from './clip.service';
import { TranscriptionService } from './transcription.service';
import { deduplicateTranscriptions } from './unique-transcriptions';

// Same rules as Arena's reminder_service.py: at most one reminder a week, only
// once the person has been quiet for a week, and at most three in a row without
// them voting again.
export const REMINDER_INTERVAL_MS = 7 * 24 * 3_600_000;
export const MAX_REMINDERS = 3;
const TIMEZONE = 'Europe/Madrid';
const MAX_CARD_CHARS = 300;

function madridOffsetMs(instant: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(instant).map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

// Next Monday 10:00 Europe/Madrid strictly after `now` (Arena's weekly slot).
export function nextRun(now: Date): Date {
  for (let k = 0; k < 9; k++) {
    const day = new Date(now.getTime() + k * 24 * 3_600_000);
    const local = new Date(day.getTime() + madridOffsetMs(day));
    if (local.getUTCDay() !== 1) continue;
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 10);
    let candidate = new Date(wall - madridOffsetMs(new Date(wall)));
    candidate = new Date(wall - madridOffsetMs(candidate)); // settle across a DST edge
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new Error('unreachable');
}

@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(EmailSubscription) private readonly subscriptions: Repository<EmailSubscription>,
    @InjectRepository(Vote) private readonly votes: Repository<Vote>,
    private readonly email: EmailService,
    private readonly clips: ClipService,
    private readonly transcriptions: TranscriptionService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.REMINDERS_ENABLED === 'false') return;
    if (!this.email.smtpConfigured) {
      this.logger.warn('SMTP_HOST not configured; reminders are disabled');
      return;
    }
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    const at = nextRun(new Date());
    this.logger.log(`Next reminder run: ${at.toISOString()}`);
    this.timer = setTimeout(() => {
      this.sendDueReminders()
        .then((sent) => this.logger.log(`Reminders sent: ${sent}`))
        .catch((error) => this.logger.error(`Weekly reminder run failed: ${(error as Error).name}`))
        .finally(() => this.schedule());
    }, at.getTime() - Date.now());
    this.timer.unref();
  }

  // A clip to show in the email: one none of the address's linked usernames has
  // answered yet, with its best transcription. Null (the email then just links to
  // the site) when nothing suitable is found or anything goes wrong.
  private async pickClip(usernames: string[]): Promise<{ clipId: string; text: string } | null> {
    try {
      const skip: string[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        const clip = await this.clips.nextForEvaluation(usernames[0], 'transcription', skip);
        if (!clip) return null;
        const answered = await this.votes.count({ where: { clipId: clip.clipId, username: In(usernames) } });
        if (answered === 0) {
          const [best] = deduplicateTranscriptions(await this.transcriptions.findByClip(clip.clipId));
          const text = (best?.text ?? clip.candidate1 ?? clip.candidate2 ?? '').trim();
          return text ? { clipId: clip.clipId, text: text.slice(0, MAX_CARD_CHARS) } : null;
        }
        skip.push(clip.clipId);
      }
    } catch (error) {
      this.logger.warn(`Could not pick a clip for a reminder: ${(error as Error).name}`);
    }
    return null;
  }

  async sendDueReminders(now = new Date()): Promise<number> {
    let sent = 0;
    const subscriptions = await this.subscriptions.find({ relations: { links: true } });
    for (const sub of subscriptions) {
      const usernames = sub.links.map((l) => l.username);
      if (!usernames.length) continue;
      const stats = await this.votes
        .createQueryBuilder('v')
        .select('MAX(v.created_at)', 'lastVote')
        .addSelect('COUNT(DISTINCT v.clip_id)', 'clips')
        .where({ username: In(usernames) })
        .getRawOne<{ lastVote: string | null; clips: string }>();
      const lastVote = stats?.lastVote;
      if (!lastVote) continue;

      // Activity since the last reminder resets the cap.
      const count = sub.reminderSentAt && lastVote <= sub.reminderSentAt ? sub.reminderCount : 0;
      const baseline = [lastVote, sub.consentedAt, sub.reminderSentAt ?? lastVote].reduce((a, b) => (a > b ? a : b));
      const tooRecent = now.getTime() - new Date(baseline).getTime() < REMINDER_INTERVAL_MS;
      if (tooRecent || count >= MAX_REMINDERS) continue;

      let accepted = false;
      try {
        accepted = await this.email.send(this.email.buildReminder(sub.email, Number(stats?.clips) || 0, (await this.pickClip(usernames)) ?? undefined));
      } catch (error) {
        // Neither the address nor the error text: only the error type.
        this.logger.error(`Could not send reminder: ${(error as Error).name}`);
      }
      if (accepted) {
        await this.subscriptions.update(sub.id, { reminderSentAt: now.toISOString(), reminderCount: count + 1 });
        sent++;
      }
    }
    return sent;
  }
}
