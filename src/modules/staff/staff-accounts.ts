import { type EntityManager } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
import { hashPassword, needsRehash, spendPasswordCheck, verifyPassword } from '../../lib/password';
import { logger } from '../../lib/logger';
import { staffSessions, type RevokeReason } from '../auth/staff-sessions';

const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

export type PasswordCheck = 'ok' | 'invalid' | 'locked';

const db = (manager?: EntityManager) => manager ?? AppDataSource.manager;

interface CredentialRow {
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export const staffAccounts = {
  hashPassword,

  async saveHash(staffId: string, passwordHash: string, manager?: EntityManager): Promise<void> {
    await db(manager).query(
      `INSERT INTO staff_credentials (staff_id, password_hash, password_changed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (staff_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         password_changed_at = now(), failed_attempts = 0, locked_until = NULL, updated_at = now()`,
      [staffId, passwordHash],
    );
  },

  async setPassword(staffId: string, password: string, manager?: EntityManager): Promise<void> {
    await this.saveHash(staffId, await hashPassword(password), manager);
  },

  async checkPassword(staffId: string, password: string): Promise<PasswordCheck> {
    const [row] = (await AppDataSource.query(
      `SELECT password_hash AS "passwordHash", failed_attempts AS "failedAttempts", locked_until AS "lockedUntil"
         FROM staff_credentials WHERE staff_id = $1`,
      [staffId],
    )) as CredentialRow[];
    if (!row) {
      await spendPasswordCheck(password);
      return 'invalid';
    }
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return 'locked';
    if (!(await verifyPassword(password, row.passwordHash))) {
      await AppDataSource.query(
        `UPDATE staff_credentials SET
           failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
           locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
           updated_at = now()
         WHERE staff_id = $1`,
        [staffId, MAX_FAILURES, LOCK_MINUTES],
      );
      return 'invalid';
    }
    if (row.failedAttempts > 0 || row.lockedUntil) {
      await AppDataSource.query(
        `UPDATE staff_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE staff_id = $1`,
        [staffId],
      );
    }
    if (needsRehash(row.passwordHash)) {
      const upgraded = await hashPassword(password);
      await AppDataSource.query(
        `UPDATE staff_credentials SET password_hash = $2, updated_at = now() WHERE staff_id = $1 AND password_hash = $3`,
        [staffId, upgraded, row.passwordHash],
      ).catch((err: unknown) => logger.warn({ err, staffId }, 'Could not upgrade the password hash'));
    }
    return 'ok';
  },

  async endSessions(staffId: string, reason: RevokeReason, manager?: EntityManager, keepSessionId?: string) {
    await staffSessions.revokeAll(staffId, reason, manager, keepSessionId);
  },
};
