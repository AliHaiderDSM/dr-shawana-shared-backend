import { createHash, randomBytes } from 'node:crypto';
import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

const IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REUSE_GRACE_MS = 30_000;
const SESSION_ENDED = 'Session expired, please log in again';

export type RevokeReason =
  'logout' | 'reuse' | 'password_changed' | 'password_reset' | 'deactivated' | 'deleted';

export interface SessionMeta {
  device: string | null;
  ip: string | null;
}

export interface IssuedRefresh {
  sessionId: string;
  staffId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface SessionRow {
  id: string;
  staffId: string;
  rotatedAt: Date | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const trim = (value: string | null, max: number) => (value ? value.slice(0, max) : null);
const db = (manager?: EntityManager) => manager ?? AppDataSource.manager;

const COLUMNS = `id, staff_id AS "staffId", rotated_at AS "rotatedAt", expires_at AS "expiresAt",
  absolute_expires_at AS "absoluteExpiresAt", revoked_at AS "revokedAt"`;

export const staffSessions = {
  async open(staffId: string, meta: SessionMeta): Promise<IssuedRefresh> {
    const refreshToken = newToken();
    const now = Date.now();
    const absolute = new Date(now + ABSOLUTE_TTL_MS);
    const expiresAt = new Date(now + IDLE_TTL_MS);
    await AppDataSource.query(
      `DELETE FROM staff_sessions WHERE staff_id = $1
         AND (absolute_expires_at < now() OR expires_at < now() OR revoked_at < now() - interval '30 days')`,
      [staffId],
    );
    const [row] = (await AppDataSource.query(
      `INSERT INTO staff_sessions (staff_id, refresh_hash, expires_at, absolute_expires_at, device, ip)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [staffId, hashOf(refreshToken), expiresAt, absolute, trim(meta.device, 200), trim(meta.ip, 64)],
    )) as { id: string }[];
    return { sessionId: row!.id, staffId, refreshToken, refreshExpiresAt: expiresAt };
  },

  async rotate(refreshToken: string, meta: SessionMeta): Promise<IssuedRefresh> {
    const presented = hashOf(refreshToken);
    const outcome = await withTransaction(async (em) => {
      const [current] = (await em.query(
        `SELECT ${COLUMNS} FROM staff_sessions WHERE refresh_hash = $1 FOR UPDATE`,
        [presented],
      )) as SessionRow[];
      if (current) {
        const now = Date.now();
        if (
          current.revokedAt ||
          current.expiresAt.getTime() <= now ||
          current.absoluteExpiresAt.getTime() <= now
        ) {
          return null;
        }
        const next = newToken();
        const expiresAt = new Date(Math.min(now + IDLE_TTL_MS, current.absoluteExpiresAt.getTime()));
        await em.query(
          `UPDATE staff_sessions SET previous_hash = refresh_hash, refresh_hash = $2, rotated_at = now(),
             last_used_at = now(), expires_at = $3, ip = COALESCE($4, ip), device = COALESCE($5, device)
           WHERE id = $1`,
          [current.id, hashOf(next), expiresAt, trim(meta.ip, 64), trim(meta.device, 200)],
        );
        return {
          sessionId: current.id,
          staffId: current.staffId,
          refreshToken: next,
          refreshExpiresAt: expiresAt,
        };
      }
      const [replayed] = (await em.query(
        `SELECT ${COLUMNS} FROM staff_sessions WHERE previous_hash = $1 FOR UPDATE`,
        [presented],
      )) as SessionRow[];
      if (!replayed || replayed.revokedAt) return null;
      if (replayed.rotatedAt && Date.now() - replayed.rotatedAt.getTime() < REUSE_GRACE_MS) return null;
      await em.query(`UPDATE staff_sessions SET revoked_at = now(), revoked_reason = 'reuse' WHERE id = $1`, [
        replayed.id,
      ]);
      logger.warn(
        { sessionId: replayed.id, staffId: replayed.staffId },
        'Refresh token reuse detected, session revoked',
      );
      return null;
    });
    if (!outcome) throw AppError.unauthorized(SESSION_ENDED);
    return outcome;
  },

  async revokeByToken(refreshToken: string): Promise<void> {
    await AppDataSource.query(
      `UPDATE staff_sessions SET revoked_at = now(), revoked_reason = 'logout'
        WHERE refresh_hash = $1 AND revoked_at IS NULL`,
      [hashOf(refreshToken)],
    );
  },

  async isLive(sessionId: string, staffId: string): Promise<boolean> {
    const rows = (await AppDataSource.query(
      `SELECT 1 FROM staff_sessions
        WHERE id = $1 AND staff_id = $2 AND revoked_at IS NULL AND expires_at > now() AND absolute_expires_at > now()`,
      [sessionId, staffId],
    )) as unknown[];
    return rows.length > 0;
  },

  async revokeAll(staffId: string, reason: RevokeReason, manager?: EntityManager, keepSessionId?: string) {
    await db(manager).query(
      `UPDATE staff_sessions SET revoked_at = now(), revoked_reason = $2
        WHERE staff_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [staffId, reason, keepSessionId ?? null],
    );
  },
};
