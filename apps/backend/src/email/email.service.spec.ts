import { EmailService } from './email.service';
import { MetricsService } from '../observability/metrics.service';
import { verifyConfirmToken, verifyUnsubscribeToken } from './email-token';

describe('EmailService', () => {
  const metrics = new MetricsService();
  const service = new EmailService(metrics);
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.HMAC_SECRET_KEY = 'test-secret';
    process.env.FRONTEND_BASE_URL = 'https://garbellaveus.example/';
    delete process.env.SMTP_HOST;
  });
  afterAll(() => {
    process.env = saved;
  });

  const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get('token')!);

  it('builds a confirmation link on the SPA route carrying a valid token', () => {
    const link = service.confirmationLink('A@b.cat', 'u1');
    expect(link.startsWith('https://garbellaveus.example/confirma-correu?token=')).toBe(true);
    expect(verifyConfirmToken(tokenOf(link))).toEqual({ email: 'a@b.cat', username: 'u1' });
  });

  it('puts both unsubscribe links in a reminder, with the one-click header', () => {
    const msg = service.buildReminder('a@b.cat', 12);
    expect(msg.text).toContain('12 talls');
    expect(msg.text).toContain('https://garbellaveus.example/baixa-correu?token=');
    expect(msg.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const oneClick = msg.headers!['List-Unsubscribe'].slice(1, -1);
    expect(oneClick.startsWith('https://garbellaveus.example/api/subscriptions/unsubscribe?token=')).toBe(true);
    expect(verifyUnsubscribeToken(tokenOf(oneClick))).toBe('a@b.cat');
  });

  it('puts the clip card in the reminder with a deep link that only opens the page', () => {
    const msg = service.buildReminder('a@b.cat', 3, { clipId: 'abc 1', text: 'hola <b>món</b>' });
    expect(msg.text).toContain('«hola <b>món</b>»');
    expect(msg.text).toContain('https://garbellaveus.example/avalua?clipId=abc%201&dimension=transcription');
    expect(msg.html).toContain('hola &lt;b&gt;món&lt;/b&gt;');
    expect(msg.html).not.toContain('<b>món</b>');
    expect(msg.html).toContain('Escolta el tall i valida');
  });

  it('falls back to a plain link to the site when there is no clip', () => {
    const msg = service.buildReminder('a@b.cat', 3);
    expect(msg.text).toContain('Avalua: https://garbellaveus.example');
    expect(msg.text).not.toContain('Escolta el tall');
  });

  it('does not send without SMTP_HOST', async () => {
    expect(service.smtpConfigured).toBe(false);
    expect(await service.send(service.buildConfirmation('a@b.cat', 'u1'))).toBe(false);
    expect((await metrics.emailsTotal.get()).values).toEqual([
      expect.objectContaining({ labels: { kind: 'confirmation', outcome: 'not_configured' }, value: 1 }),
    ]);
  });

  it('counts a transport failure as failed, rethrows it, and sendQuietly swallows it', async () => {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1'; // nothing listens here
    process.env.SMTP_SECURITY = 'none';
    const message = service.buildReminder('a@b.cat', 1);
    await expect(service.send(message)).rejects.toBeDefined();
    expect(await service.sendQuietly(message, 'reminder')).toBe(false);
    const failed = (await metrics.emailsTotal.get()).values.find((v) => v.labels.outcome === 'failed');
    expect(failed).toMatchObject({ labels: { kind: 'reminder', outcome: 'failed' }, value: 2 });
  });
});
