import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import bcrypt from 'bcryptjs';

const COST = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_N = 2 ** 20;
const CURRENT_PREFIX = `scrypt$${COST.N}$${COST.r}$${COST.p}$`;

const memoryFor = (N: number, r: number) => 256 * N * r;

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, KEY_LENGTH, { ...COST, maxmem: memoryFor(COST.N, COST.r) });
  return `${CURRENT_PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
}

const isLegacyBcrypt = (stored: string) => /^\$2[aby]\$\d{2}\$/.test(stored);

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyBcrypt(stored)) return bcrypt.compare(password, stored);
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every(Number.isInteger) || cost.N > MAX_N || cost.r > 32 || cost.p > 16) {
    return false;
  }
  const expected = Buffer.from(key, 'base64');
  if (expected.length < 32) return false;
  const given = await derive(password, Buffer.from(salt, 'base64'), expected.length, {
    ...cost,
    maxmem: memoryFor(cost.N, cost.r),
  });
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const needsRehash = (stored: string) => !stored.startsWith(CURRENT_PREFIX);

let decoy: Promise<string> | null = null;

export async function spendPasswordCheck(password: string): Promise<void> {
  decoy ??= hashPassword(randomBytes(24).toString('base64'));
  await verifyPassword(password, await decoy);
}
