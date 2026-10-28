import { createHmac, timingSafeEqual } from 'crypto';

// Stateless signed tokens, same scheme as Arena's security.py: base64url(payload).base64url(hmac).
// The confirmation token carries everything needed to create the subscription, so
// nothing is stored until the link is clicked. The unsubscribe token has no expiry
// (an old email must keep working) and is just a signature over the address.

export const CONFIRM_TTL_HOURS = 24;

const b64 = (buf: Buffer) => buf.toString('base64url');

function secret(): string {
  const value = process.env.HMAC_SECRET_KEY;
  if (!value) throw new Error('HMAC_SECRET_KEY is not configured');
  return value;
}

function sign(data: Buffer): Buffer {
  return createHmac('sha256', secret()).update(data).digest();
}

function split(token: string): { payload: Buffer; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  return { payload: Buffer.from(parts[0], 'base64url'), signature: Buffer.from(parts[1], 'base64url') };
}

function validSignature(payload: Buffer, signature: Buffer): boolean {
  const expected = sign(payload);
  return expected.length === signature.length && timingSafeEqual(expected, signature);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface ConfirmPayload {
  email: string;
  username: string;
}

export function createConfirmToken(email: string, username: string, now = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({
      purpose: 'email_confirm',
      email: normalizeEmail(email),
      username,
      exp: now.getTime() / 1000 + CONFIRM_TTL_HOURS * 3600,
    }),
  );
  return `${b64(payload)}.${b64(sign(payload))}`;
}

export function verifyConfirmToken(token: string, now = new Date()): ConfirmPayload | null {
  try {
    const parts = split(token);
    if (!parts || !validSignature(parts.payload, parts.signature)) return null;
    const data = JSON.parse(parts.payload.toString('utf8'));
    if (data.purpose !== 'email_confirm' || now.getTime() / 1000 > data.exp) return null;
    if (typeof data.email !== 'string' || typeof data.username !== 'string') return null;
    return { email: data.email, username: data.username };
  } catch {
    return null;
  }
}

export function createUnsubscribeToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ purpose: 'email_unsubscribe', email: normalizeEmail(email) }));
  return `${b64(payload)}.${b64(sign(payload))}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const parts = split(token);
    if (!parts || !validSignature(parts.payload, parts.signature)) return null;
    const data = JSON.parse(parts.payload.toString('utf8'));
    if (data.purpose !== 'email_unsubscribe' || typeof data.email !== 'string') return null;
    return data.email;
  } catch {
    return null;
  }
}
