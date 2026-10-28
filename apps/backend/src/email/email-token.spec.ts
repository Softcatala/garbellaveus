import {
  createConfirmToken,
  verifyConfirmToken,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  CONFIRM_TTL_HOURS,
} from './email-token';

describe('email tokens', () => {
  beforeAll(() => {
    process.env.HMAC_SECRET_KEY = 'test-secret';
  });

  it('round-trips a confirmation token, normalising the address', () => {
    const token = createConfirmToken('  Ada@Example.ORG ', 'uuid-1');
    expect(verifyConfirmToken(token)).toEqual({ email: 'ada@example.org', username: 'uuid-1' });
  });

  it('rejects an expired confirmation token', () => {
    const issued = new Date('2026-01-01T00:00:00Z');
    const token = createConfirmToken('a@b.cat', 'u', issued);
    const later = new Date(issued.getTime() + (CONFIRM_TTL_HOURS * 3600 + 1) * 1000);
    expect(verifyConfirmToken(token, later)).toBeNull();
  });

  it('rejects a tampered or foreign-purpose token', () => {
    const token = createConfirmToken('a@b.cat', 'u');
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ purpose: 'email_confirm', email: 'x@y.cat', username: 'u', exp: 9e9 })).toString('base64url');
    expect(verifyConfirmToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyConfirmToken(`${payload}.`)).toBeNull();
    expect(verifyConfirmToken('garbage')).toBeNull();
    // An unsubscribe token must not pass as a confirmation token, nor vice versa.
    expect(verifyConfirmToken(createUnsubscribeToken('a@b.cat'))).toBeNull();
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it('unsubscribe tokens never expire and carry the address', () => {
    expect(verifyUnsubscribeToken(createUnsubscribeToken('A@B.cat'))).toBe('a@b.cat');
    expect(verifyUnsubscribeToken('nope')).toBeNull();
  });

  it('throws when the secret is missing', () => {
    const saved = process.env.HMAC_SECRET_KEY;
    delete process.env.HMAC_SECRET_KEY;
    expect(() => createUnsubscribeToken('a@b.cat')).toThrow();
    process.env.HMAC_SECRET_KEY = saved;
  });
});
