import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const fallbackSecret = randomBytes(32).toString('hex');

function secret() {
  const base = env.PATIENT_LINK_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY ?? fallbackSecret;
  return createHmac('sha256', base).update('dsm-signed-token-v1').digest();
}

function sign(body: string) {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function createSignedToken(payload: Record<string, unknown>, ttlSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp: expiresAt })).toString('base64url');
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(expiresAt * 1000) };
}

export function readSignedToken<T extends Record<string, unknown>>(
  token: string,
): (T & { exp: number }) | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
