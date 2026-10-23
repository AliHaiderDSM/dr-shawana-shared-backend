import { generateKeyPairSync, sign } from 'node:crypto';
import { checkSupabaseJwt, type Jwk } from './jwt';

const ISSUER = 'https://demo.supabase.co/auth/v1';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid: 'key-1', alg: 'ES256' };
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(
  payload: object,
  header: object = { alg: 'ES256', kid: 'key-1', typ: 'JWT' },
  key = privateKey,
) {
  const data = `${part(header)}.${part(payload)}`;
  const signature = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );
  return `${data}.${signature}`;
}

const now = 1_800_000_000;
const good = { sub: 'user-1', aud: 'authenticated', iss: ISSUER, exp: now + 3600, role: 'authenticated' };

describe('checkSupabaseJwt', () => {
  it('accepts a token signed by a Supabase key', () => {
    expect(checkSupabaseJwt(token(good), [jwk], ISSUER, now)).toEqual({ userId: 'user-1' });
  });

  it('rejects expired, forged and foreign tokens', () => {
    expect(checkSupabaseJwt(token({ ...good, exp: now - 120 }), [jwk], ISSUER, now)).toEqual({
      invalid: 'Token expired',
    });
    expect(checkSupabaseJwt(token(good, undefined, other.privateKey), [jwk], ISSUER, now)).toEqual({
      invalid: 'Bad signature',
    });
    expect(
      checkSupabaseJwt(token({ ...good, iss: 'https://evil.example/auth/v1' }), [jwk], ISSUER, now),
    ).toEqual({ unknown: true });
    expect(checkSupabaseJwt(token({ ...good, aud: 'anon' }), [jwk], ISSUER, now)).toEqual({
      unknown: true,
    });
    const [h, p] = token(good).split('.');
    expect(checkSupabaseJwt(`${h}.${p}.${'A'.repeat(86)}`, [jwk], ISSUER, now)).toEqual({
      invalid: 'Bad signature',
    });
  });

  it('leaves unknown keys, other algorithms and non-JWT tokens to Supabase', () => {
    expect(checkSupabaseJwt(token(good, { alg: 'ES256', kid: 'key-2' }), [jwk], ISSUER, now)).toEqual({
      unknown: true,
    });
    expect(checkSupabaseJwt(token(good, { alg: 'HS256', kid: 'key-1' }), [jwk], ISSUER, now)).toEqual({
      unknown: true,
    });
    expect(checkSupabaseJwt('a-staff-uuid', [jwk], ISSUER, now)).toEqual({ unknown: true });
  });
});
