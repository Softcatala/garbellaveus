import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { confirmationEmail, reminderEmail, EmailContent, ClipCard } from './email-templates';
import { MetricsService } from '../observability/metrics.service';
import { CONFIRM_TTL_HOURS, createConfirmToken, createUnsubscribeToken } from './email-token';

const SMTP_TIMEOUT_MS = 10_000;

export interface OutgoingEmail extends EmailContent {
  kind: 'confirmation' | 'reminder';
  to: string;
  headers?: Record<string, string>;
}

// SMTP sender, configured like Arena's email_service.py (SMTP_HOST/PORT/SECURITY/
// USER/PASSWORD, EMAIL_FROM_*, FRONTEND_BASE_URL). Without SMTP_HOST nothing is
// sent: the message is logged so the flow can be tried locally.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly metrics: MetricsService) {}

  get smtpConfigured(): boolean {
    return !!process.env.SMTP_HOST;
  }

  private get frontendBaseUrl(): string {
    return (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
  }

  confirmationLink(email: string, username: string): string {
    return `${this.frontendBaseUrl}/confirma-correu?token=${encodeURIComponent(createConfirmToken(email, username))}`;
  }

  unsubscribeLink(email: string): string {
    return `${this.frontendBaseUrl}/baixa-correu?token=${encodeURIComponent(createUnsubscribeToken(email))}`;
  }

  // Direct API URL for the List-Unsubscribe header, so mail clients can do an
  // RFC 8058 one-click POST without going through the SPA.
  private oneClickUnsubscribeUrl(email: string): string {
    return `${this.frontendBaseUrl}/api/subscriptions/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(email))}`;
  }

  buildConfirmation(email: string, username: string): OutgoingEmail {
    return { kind: 'confirmation', to: email, ...confirmationEmail(this.confirmationLink(email, username), CONFIRM_TTL_HOURS) };
  }

  // Deep link to the evaluate page on one clip. A plain GET that only opens the
  // page: audio has to be heard and the vote made there, so link-prefetching mail
  // scanners can never cast a vote.
  clipLink(clipId: string): string {
    return `${this.frontendBaseUrl}/avalua?clipId=${encodeURIComponent(clipId)}&dimension=transcription`;
  }

  buildReminder(email: string, clips: number, clip?: { clipId: string; text: string }): OutgoingEmail {
    const card: ClipCard | undefined = clip && { text: clip.text, link: this.clipLink(clip.clipId) };
    const content = reminderEmail(clips, this.frontendBaseUrl, this.unsubscribeLink(email), card);
    return {
      kind: 'reminder',
      to: email,
      ...content,
      headers: {
        'List-Unsubscribe': `<${this.oneClickUnsubscribeUrl(email)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  // Resolves true only when the SMTP server accepted the message. Throws on
  // transport errors; callers decide whether that is fatal.
  async send(message: OutgoingEmail): Promise<boolean> {
    if (!this.smtpConfigured) {
      this.logger.warn(`SMTP not configured; not sending "${message.subject}":\n${message.text}`);
      this.metrics.emailsTotal.inc({ kind: message.kind, outcome: 'not_configured' });
      return false;
    }
    const security = process.env.SMTP_SECURITY || 'starttls';
    const user = process.env.SMTP_USER;
    // nodemailer only authenticates when the server advertises AUTH, so an
    // internal relay that accepts mail without credentials still works.
    const transport = createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: security === 'ssl',
      requireTLS: security === 'starttls',
      ignoreTLS: security === 'none',
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      auth: user ? { user, pass: process.env.SMTP_PASSWORD || '' } : undefined,
    });
    const name = process.env.EMAIL_FROM_NAME || 'GarbellaVeus';
    const address = process.env.EMAIL_FROM_ADDRESS || 'garbellaveus@softcatala.org';
    try {
      await transport.sendMail({
        from: { name, address },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });
      this.metrics.emailsTotal.inc({ kind: message.kind, outcome: 'sent' });
      return true;
    } catch (error) {
      this.metrics.emailsTotal.inc({ kind: message.kind, outcome: 'failed' });
      throw error;
    } finally {
      transport.close();
    }
  }

  // Fire-and-forget variant for request handlers: a mail outage must not break
  // the request, and — as in Arena — neither the address nor the error text is
  // logged, only the error type and SMTP code.
  async sendQuietly(message: OutgoingEmail, kind: string): Promise<boolean> {
    try {
      return await this.send(message);
    } catch (error) {
      const e = error as { name?: string; responseCode?: number };
      this.logger.error(`Could not send email (${kind}): ${e.name ?? 'Error'}${e.responseCode ? ` (SMTP ${e.responseCode})` : ''}`);
      return false;
    }
  }
}
