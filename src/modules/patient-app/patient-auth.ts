import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
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

const INVALID_CODE = 'This phone number and code do not match. Ask the clinic for a new code.';
const SESSION_ENDED = 'Your session has ended. Ask the clinic for a new code to log in.';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const codeHash = (patientId: string, code: string) => sha256(`patient-activation:${patientId}:${code}`);

interface AccountRow {
  activatedAt: Date | null;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
}

async function accountOf(patientId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT activated_at AS "activatedAt", disabled_at AS "disabledAt", last_login_at AS "lastLoginAt"
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
    const patientId = await patientByPhone(input.phone);
    if (!patientId) throw AppError.unauthorized(INVALID_CODE);
    const [code] = (await AppDataSource.query(
      `SELECT id, code_hash AS "codeHash", attempts FROM patient_activation_codes
        WHERE patient_id = $1 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [patientId],
    )) as { id: string; codeHash: string; attempts: number }[];
    if (!code || code.attempts >= MAX_CODE_ATTEMPTS) throw AppError.unauthorized(INVALID_CODE);
    const given = Buffer.from(codeHash(patientId, input.code.trim()));
    const expected = Buffer.from(code.codeHash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      await AppDataSource.query(`UPDATE patient_activation_codes SET attempts = attempts + 1 WHERE id = $1`, [
        code.id,
      ]);
      throw AppError.unauthorized(INVALID_CODE);
    }
    await withTransaction(async (em) => {
      await em.query(`UPDATE patient_activation_codes SET used_at = now() WHERE id = $1`, [code.id]);
      await em.query(
        `INSERT INTO patient_accounts (patient_id, activated_at, last_login_at)
         VALUES ($1, now(), now())
         ON CONFLICT (patient_id) DO UPDATE SET activated_at = COALESCE(patient_accounts.activated_at, now()),
           disabled_at = NULL, last_login_at = now(), updated_at = now()`,
        [patientId],
      );
    });
    return openSession(patientId, input.device ?? null);
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

export const authenticatePatient: RequestHandler = async (req, _res, next) => {
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
  next();
};

export function patientOf(req: { patient?: { patientId: string; sessionId: string } }) {
  if (!req.patient) throw AppError.unauthorized();
  return req.patient;
}
