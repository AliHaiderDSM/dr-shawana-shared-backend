import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const ISSUER = 'dsm-api';
const AUDIENCE = 'dsm-staff';
const CLOCK_SKEW_SECONDS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const HEADER = encode({ alg: 'HS256', typ: 'JWT' });
const developmentSecret = randomBytes(48).toString('hex');

const signingKey = () => env.JWT_SECRET ?? developmentSecret;
const signatureOf = (input: string) => createHmac('sha256', signingKey()).update(input).digest();

export interface AccessClaims {
  userId: string;
  sessionId: string;
  expiresAt: number;
}

const nowInSeconds = () => Math.floor(Date.now() / 1000);

export function signAccessToken(userId: string, sessionId: string, now = nowInSeconds()) {
  const expiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
  const payload = encode({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: userId,
    sid: sessionId,
    typ: 'access',
    iat: now,
    nbf: now,
    exp: expiresAt,
    jti: randomUUID(),
  });
  const body = `${HEADER}.${payload}`;
  return { token: `${body}.${signatureOf(body).toString('base64url')}`, expiresAt };
}

function decode(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string, now = nowInSeconds()): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  const header = decode(rawHeader);
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  const expected = signatureOf(`${rawHeader}.${rawPayload}`);
  const given = Buffer.from(rawSignature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = decode(rawPayload);
  if (!claims) return null;
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE || claims.typ !== 'access') return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) return null;
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now) return null;
  if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return null;
  if (typeof claims.sid !== 'string' || !UUID.test(claims.sid)) return null;
  return { userId: claims.sub, sessionId: claims.sid, expiresAt: claims.exp };
}
