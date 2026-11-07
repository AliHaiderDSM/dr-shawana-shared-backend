import { createHmac, randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken, verifyAccessToken } from './jwt';

const userId = randomUUID();
const sessionId = randomUUID();
const now = 1_800_000_000;

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function reSigned(token: string, change: (claims: Record<string, unknown>) => Record<string, unknown>) {
  const [header, payload, signature] = token.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  return `${header}.${part(change(claims))}.${signature}`;
}

describe('access tokens', () => {
  it('round-trips the user and session', () => {
    const { token, expiresAt } = signAccessToken(userId, sessionId, now);
    expect(expiresAt).toBe(now + ACCESS_TOKEN_TTL_SECONDS);
    expect(verifyAccessToken(token, now + 60)).toEqual({ userId, sessionId, expiresAt });
  });

  it('rejects an expired token with no grace', () => {
    const { token } = signAccessToken(userId, sessionId, now);
    expect(verifyAccessToken(token, now + ACCESS_TOKEN_TTL_SECONDS)).toBeNull();
  });

  it('rejects changed claims, a forged signature and other algorithms', () => {
    const { token } = signAccessToken(userId, sessionId, now);
    expect(
      verifyAccessToken(
        reSigned(token, (c) => ({ ...c, sub: randomUUID() })),
        now,
      ),
    ).toBeNull();
    expect(
      verifyAccessToken(
        reSigned(token, (c) => ({ ...c, aud: 'other' })),
        now,
      ),
    ).toBeNull();
    const [, payload] = token.split('.') as [string, string];
    const forgedHeader = part({ alg: 'HS256', typ: 'JWT' });
    const forged = createHmac('sha256', 'guessed-secret')
      .update(`${forgedHeader}.${payload}`)
      .digest('base64url');
    expect(verifyAccessToken(`${forgedHeader}.${payload}.${forged}`, now)).toBeNull();
    expect(verifyAccessToken(`${part({ alg: 'none', typ: 'JWT' })}.${payload}.`, now)).toBeNull();
    expect(verifyAccessToken('a-staff-uuid', now)).toBeNull();
  });

  it('rejects a token issued in the future', () => {
    const { token } = signAccessToken(userId, sessionId, now + 600);
    expect(verifyAccessToken(token, now)).toBeNull();
  });
});
