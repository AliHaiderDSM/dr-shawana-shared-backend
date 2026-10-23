import { createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { env } from '../config/env';

export interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

export type JwtCheck = { userId: string } | { invalid: string } | { unknown: true };

const LEEWAY_SECONDS = 30;
const JWKS_TTL_MS = 10 * 60_000;
const ALGORITHMS: Record<string, { hash: string; dsa?: 'ieee-p1363' }> = {
  ES256: { hash: 'sha256', dsa: 'ieee-p1363' },
  RS256: { hash: 'RSA-SHA256' },
};

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

export function checkSupabaseJwt(
  token: string,
  keys: Jwk[],
  issuer: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): JwtCheck {
  const parts = token.split('.');
  if (parts.length !== 3) return { unknown: true };
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decode(rawHeader);
    payload = decode(rawPayload);
  } catch {
    return { invalid: 'Malformed token' };
  }
  const algorithm = ALGORITHMS[String(header.alg)];
  if (!algorithm) return { unknown: true };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { unknown: true };
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return { unknown: true };
  }
  const signed = verifySignature(
    algorithm.hash,
    Buffer.from(`${rawHeader}.${rawPayload}`),
    algorithm.dsa ? { key, dsaEncoding: algorithm.dsa } : key,
    Buffer.from(rawSignature, 'base64url'),
  );
  if (!signed) return { invalid: 'Bad signature' };
  if (typeof payload.exp !== 'number' || payload.exp + LEEWAY_SECONDS < nowSeconds) {
    return { invalid: 'Token expired' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_SECONDS > nowSeconds) {
    return { invalid: 'Token not active yet' };
  }
  if (payload.iss !== issuer) return { unknown: true };
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes('authenticated')) return { unknown: true };
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return { invalid: 'No subject' };
  return { userId: payload.sub };
}

let cache: { keys: Jwk[]; at: number } | null = null;
let lastForced = 0;
const FORCE_GAP_MS = 60_000;

async function loadKeys(force = false): Promise<Jwk[]> {
  if (!env.SUPABASE_URL) return [];
  if (force && Date.now() - lastForced < FORCE_GAP_MS) return cache?.keys ?? [];
  if (force) lastForced = Date.now();
  if (!force && cache && Date.now() - cache.at < JWKS_TTL_MS) return cache.keys;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return cache?.keys ?? [];
    const body = (await response.json()) as { keys?: Jwk[] };
    cache = { keys: body.keys ?? [], at: Date.now() };
    return cache.keys;
  } catch {
    return cache?.keys ?? [];
  }
}

export async function verifySupabaseJwt(token: string): Promise<JwtCheck> {
  if (!env.SUPABASE_URL || token.split('.').length !== 3) return { unknown: true };
  const issuer = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
  const first = checkSupabaseJwt(token, await loadKeys(), issuer);
  if (!('unknown' in first)) return first;
  return checkSupabaseJwt(token, await loadKeys(true), issuer);
}
