import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { perUserLimit } from '../../lib/rate-limit';
import { promisify } from 'node:util';
import { type RequestHandler } from 'express';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { createSignedToken, readSignedToken } from '../../lib/signed-token';
import { last9Of } from '../patients/phone';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_PASSWORD_FAILURES = 10;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;

const INVALID_CODE = 'This phone number and code do not match. Ask the clinic for a new code.';
const SESSION_ENDED = 'Your session has ended. Ask the clinic for a new code to log in.';
const INVALID_PASSWORD =
  'This phone number and password do not match. Use Forgot password with a code from the clinic.';
const LOCKED = 'Too many wrong passwords. Try again in 15 minutes or use Forgot password.';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const codeHash = (patientId: string, code: string) => sha256(`patient-activation:${patientId}:${code}`);
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function passwordMatches(password: string, stored: string) {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const given = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface AccountRow {
  activatedAt: Date | null;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  passwordHash: string | null;
  passwordSetAt: Date | null;
  passwordFailures: number;
  passwordLockedUntil: Date | null;
}

async function accountOf(patientId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT activated_at AS "activatedAt", disabled_at AS "disabledAt", last_login_at AS "lastLoginAt",
            password_hash AS "passwordHash", password_set_at AS "passwordSetAt",
            failed_attempts AS "passwordFailures", locked_until AS "passwordLockedUntil"
       FROM patient_accounts WHERE patient_id = $1`,
    [patientId],
  )) as AccountRow[];
  return row ?? null;
}

async function patientByPhone(phone: string) {
  const last9 = last9Of(phone);
  if (!last9) return null;
  const [row] = (await AppDataSource.query(
    `SELECT id FROM patients WHERE phone_last9 = $1 AND deleted_at IS NULL`,
    [last9],
  )) as { id: string }[];
  return row?.id ?? null;
}

async function openSession(patientId: string, device: string | null) {
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const [session] = (await AppDataSource.query(
    `INSERT INTO patient_sessions (patient_id, refresh_hash, expires_at, device, last_used_at)
     VALUES ($1, $2, $3, $4, now()) RETURNING id`,
    [patientId, sha256(refreshToken), expiresAt, device?.slice(0, 120) ?? null],
  )) as { id: string }[];
  return tokensFor(patientId, session!.id, refreshToken, expiresAt);
}

async function consumeCode(phone: string, given: string) {
  const patientId = await patientByPhone(phone);
  if (!patientId) throw AppError.unauthorized(INVALID_CODE);
  const [code] = (await AppDataSource.query(
    `SELECT id, code_hash AS "codeHash", attempts FROM patient_activation_codes
      WHERE patient_id = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [patientId],
  )) as { id: string; codeHash: string; attempts: number }[];
  if (!code || code.attempts >= MAX_CODE_ATTEMPTS) throw AppError.unauthorized(INVALID_CODE);
  const actual = Buffer.from(codeHash(patientId, given.trim()));
  const expected = Buffer.from(code.codeHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    await AppDataSource.query(`UPDATE patient_activation_codes SET attempts = attempts + 1 WHERE id = $1`, [
      code.id,
    ]);
    throw AppError.unauthorized(INVALID_CODE);
  }
  return { patientId, codeId: code.id };
}

async function activate(patientId: string, codeId: string, passwordHash: string | null) {
  await withTransaction(async (em) => {
    await em.query(`UPDATE patient_activation_codes SET used_at = now() WHERE id = $1`, [codeId]);
    await em.query(
      `INSERT INTO patient_accounts (patient_id, activated_at, last_login_at)
       VALUES ($1, now(), now())
       ON CONFLICT (patient_id) DO UPDATE SET activated_at = COALESCE(patient_accounts.activated_at, now()),
         disabled_at = NULL, last_login_at = now(), updated_at = now()`,
      [patientId],
    );
    if (passwordHash) {
      await em.query(
        `UPDATE patient_accounts SET password_hash = $2, password_set_at = now(), failed_attempts = 0,
           locked_until = NULL WHERE patient_id = $1`,
        [patientId, passwordHash],
      );
      await em.query(
        `UPDATE patient_sessions SET revoked_at = now() WHERE patient_id = $1 AND revoked_at IS NULL`,
        [patientId],
      );
      await em.query(`DELETE FROM patient_push_tokens WHERE patient_id = $1`, [patientId]);
    }
  });
}

function tokensFor(patientId: string, sessionId: string, refreshToken: string, refreshExpiresAt: Date) {
  const access = createSignedToken({ kind: 'patient-access', patientId, sid: sessionId }, ACCESS_TTL_SECONDS);
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export const patientAuth = {
  async accessStatus(patientId: string) {
    const account = await accountOf(patientId);
    const [code] = (await AppDataSource.query(
      `SELECT expires_at AS "expiresAt" FROM patient_activation_codes
        WHERE patient_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
        ORDER BY created_at DESC LIMIT 1`,
      [patientId, MAX_CODE_ATTEMPTS],
    )) as { expiresAt: Date }[];
    const status = account?.disabledAt
      ? 'disabled'
      : account?.activatedAt
        ? 'active'
        : code
          ? 'invited'
          : 'not_invited';
    return {
      status: status as 'disabled' | 'active' | 'invited' | 'not_invited',
      activatedAt: account?.activatedAt?.toISOString() ?? null,
      lastLoginAt: account?.lastLoginAt?.toISOString() ?? null,
      codeExpiresAt: code ? code.expiresAt.toISOString() : null,
      hasPassword: Boolean(account?.passwordHash),
      passwordSetAt: account?.passwordSetAt?.toISOString() ?? null,
    };
  },

  async issueCode(patientId: string, branchId: string | null, staffId: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await withTransaction(async (em) => {
      await em.query(
        `UPDATE patient_activation_codes SET used_at = now() WHERE patient_id = $1 AND used_at IS NULL`,
        [patientId],
      );
      await em.query(
        `INSERT INTO patient_activation_codes (patient_id, branch_id, code_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [patientId, branchId, codeHash(patientId, code), expiresAt, staffId],
      );
      await em.query(
        `INSERT INTO patient_accounts (patient_id) VALUES ($1) ON CONFLICT (patient_id) DO NOTHING`,
        [patientId],
      );
    });
    return { code, expiresAt: expiresAt.toISOString() };
  },

  async disable(patientId: string) {
    await withTransaction(async (em) => {
      await em.query(
        `UPDATE patient_accounts SET disabled_at = now(), updated_at = now() WHERE patient_id = $1`,
        [patientId],
      );
      await em.query(
        `UPDATE patient_activation_codes SET used_at = now() WHERE patient_id = $1 AND used_at IS NULL`,
        [patientId],
      );
      await em.query(
        `UPDATE patient_sessions SET revoked_at = now() WHERE patient_id = $1 AND revoked_at IS NULL`,
        [patientId],
      );
      await em.query(`DELETE FROM patient_push_tokens WHERE patient_id = $1`, [patientId]);
    });
  },

  async loginWithCode(input: { phone: string; code: string; device?: string | null }) {
    const { patientId, codeId } = await consumeCode(input.phone, input.code);
    await activate(patientId, codeId, null);
    return openSession(patientId, input.device ?? null);
  },

  async loginWithPassword(input: { phone: string; password: string; device?: string | null }) {
    const patientId = await patientByPhone(input.phone);
    const account = patientId ? await accountOf(patientId) : null;
    if (!patientId || !account?.passwordHash || !account.activatedAt || account.disabledAt)
      throw AppError.unauthorized(INVALID_PASSWORD);
    if (account.passwordLockedUntil && account.passwordLockedUntil > new Date())
      throw new AppError(429, 'RATE_LIMITED', LOCKED);
    if (!(await passwordMatches(input.password, account.passwordHash))) {
      const failures = account.passwordFailures + 1;
      const locked = failures >= MAX_PASSWORD_FAILURES;
      await AppDataSource.query(
        `UPDATE patient_accounts SET failed_attempts = $2, locked_until = $3 WHERE patient_id = $1`,
        [patientId, locked ? 0 : failures, locked ? new Date(Date.now() + PASSWORD_LOCK_MS) : null],
      );
      throw AppError.unauthorized(INVALID_PASSWORD);
    }
    await AppDataSource.query(
      `UPDATE patient_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = now(),
         updated_at = now() WHERE patient_id = $1`,
      [patientId],
    );
    return openSession(patientId, input.device ?? null);
  },

  async resetPassword(input: { phone: string; code: string; password: string; device?: string | null }) {
    const { patientId, codeId } = await consumeCode(input.phone, input.code);
    await activate(patientId, codeId, await hashPassword(input.password));
    return openSession(patientId, input.device ?? null);
  },

  async setPassword(patientId: string, input: { currentPassword?: string | null; password: string }) {
    const account = await accountOf(patientId);
    if (!account) throw AppError.unauthorized();
    if (account.passwordHash) {
      if (!input.currentPassword || !(await passwordMatches(input.currentPassword, account.passwordHash)))
        throw AppError.badRequest('Your current password is not right');
    }
    await AppDataSource.query(
      `UPDATE patient_accounts SET password_hash = $2, password_set_at = now(), failed_attempts = 0,
         locked_until = NULL, updated_at = now() WHERE patient_id = $1`,
      [patientId, await hashPassword(input.password)],
    );
  },

  async hasPassword(patientId: string) {
    return Boolean((await accountOf(patientId))?.passwordHash);
  },

  async refresh(refreshToken: string) {
    const [session] = (await AppDataSource.query(
      `SELECT s.id, s.patient_id AS "patientId" FROM patient_sessions s
         JOIN patient_accounts a ON a.patient_id = s.patient_id
        WHERE s.refresh_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND a.disabled_at IS NULL AND a.activated_at IS NOT NULL`,
      [sha256(refreshToken)],
    )) as { id: string; patientId: string }[];
    if (!session) throw AppError.unauthorized(SESSION_ENDED);
    const next = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await AppDataSource.query(
      `UPDATE patient_sessions SET refresh_hash = $2, expires_at = $3, last_used_at = now() WHERE id = $1`,
      [session.id, sha256(next), expiresAt],
    );
    return tokensFor(session.patientId, session.id, next, expiresAt);
  },

  async logout(sessionId: string) {
    await AppDataSource.query(`UPDATE patient_sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
    await AppDataSource.query(`DELETE FROM patient_push_tokens WHERE session_id = $1`, [sessionId]);
  },
};

function bearerToken(header: string | undefined) {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export const authenticatePatient: RequestHandler = async (req, res, next) => {
  if (req.patient) return next();
  const token = bearerToken(req.header('authorization'));
  const payload = token
    ? readSignedToken<{ kind?: unknown; patientId?: unknown; sid?: unknown }>(token)
    : null;
  if (
    !payload ||
    payload.kind !== 'patient-access' ||
    typeof payload.patientId !== 'string' ||
    typeof payload.sid !== 'string'
  ) {
    return next(AppError.unauthorized(SESSION_ENDED));
  }
  const [session] = (await AppDataSource.query(
    `SELECT s.id FROM patient_sessions s
       JOIN patient_accounts a ON a.patient_id = s.patient_id
       JOIN patients p ON p.id = s.patient_id AND p.deleted_at IS NULL
      WHERE s.id = $1 AND s.patient_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND a.disabled_at IS NULL`,
    [payload.sid, payload.patientId],
  )) as { id: string }[];
  if (!session) return next(AppError.unauthorized(SESSION_ENDED));
  req.patient = { patientId: payload.patientId, sessionId: payload.sid };
  void perUserLimit(req, res, next);
};

export function patientOf(req: { patient?: { patientId: string; sessionId: string } }) {
  if (!req.patient) throw AppError.unauthorized();
  return req.patient;
}
