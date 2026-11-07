import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import bcrypt from 'bcryptjs';

const COST = { N: 2 ** 15, r: 8, p: 3 };
const SHORT_FORM_COST = { N: 2 ** 14, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_N = 2 ** 20;
const CURRENT_PREFIX = `scrypt$${COST.N}$${COST.r}$${COST.p}$`;

const memoryFor = (N: number, r: number) => 256 * N * r;

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...COST,
    maxmem: memoryFor(COST.N, COST.r),
  });
  return `${CURRENT_PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
}

const isBcrypt = (stored: string) => /^\$2[aby]\$\d{2}\$/.test(stored);

function parseScrypt(stored: string) {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) {
    return { cost: SHORT_FORM_COST, salt: parts[1], key: parts[2], normalize: false };
  }
  if (parts.length !== 6) return null;
  const cost = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (![cost.N, cost.r, cost.p].every(Number.isInteger) || cost.N > MAX_N || cost.r > 32 || cost.p > 16) {
    return null;
  }
  return { cost, salt: parts[4], key: parts[5], normalize: true };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isBcrypt(stored)) return bcrypt.compare(password, stored);
  const parsed = parseScrypt(stored);
  if (!parsed?.salt || !parsed.key) return false;
  const expected = Buffer.from(parsed.key, 'base64');
  if (expected.length < 32) return false;
  const given = await derive(
    parsed.normalize ? password.normalize('NFKC') : password,
    Buffer.from(parsed.salt, 'base64'),
    expected.length,
    { ...parsed.cost, maxmem: memoryFor(parsed.cost.N, parsed.cost.r) },
  );
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const needsRehash = (stored: string) => !stored.startsWith(CURRENT_PREFIX);

let decoy: Promise<string> | null = null;

export async function spendPasswordCheck(password: string): Promise<void> {
  decoy ??= hashPassword(randomBytes(24).toString('base64'));
  await verifyPassword(password, await decoy);
}
