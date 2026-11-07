import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from '../../lib/jwt';
import { spendPasswordCheck } from '../../lib/password';
import { permissionsFor } from '../../lib/permissions';
import { auditService } from '../audit/audit.service';
import { type StaffProfile } from '../staff/staff-profile.entity';
import { staffAccounts } from '../staff/staff-accounts';
import { staffRepository } from '../staff/staff.repository';
import { toStaffDto } from '../staff/staff.service';
import { type UpdateOwnProfileInput } from './auth.schemas';
import { staffSessions, type IssuedRefresh, type SessionMeta } from './staff-sessions';

const INVALID_CREDENTIALS = 'Invalid username/email or password';
const LOCKED = 'Too many failed attempts. Try again in 15 minutes.';

function assertCanSignIn(profile: StaffProfile | null): asserts profile is StaffProfile {
  if (!profile) throw AppError.unauthorized('No staff account is linked to this login');
  if (profile.status !== 'active') throw AppError.forbidden('Your account is inactive');
  if (profile.role === 'super_admin') return;
  const branch = profile.branch;
  if (!branch || branch.deletedAt || branch.status !== 'active') {
    throw AppError.forbidden('Your branch is inactive');
  }
}

async function toMe(profile: StaffProfile) {
  const branch = profile.branch;
  const [dispatch] = (await AppDataSource.query(
    `SELECT id FROM branches WHERE kind::text = 'dispatch' AND deleted_at IS NULL LIMIT 1`,
  )) as { id: string }[];
  return {
    profile: toStaffDto(profile),
    role: profile.role,
    branch: branch
      ? {
          id: branch.id,
          name: branch.name,
          code: branch.code,
          city: branch.city,
          kind: branch.kind,
          onlineSales: branch.onlineSales,
        }
      : null,
    permissions: permissionsFor(profile.role),
    dispatchDepartmentId: dispatch?.id ?? null,
  };
}

async function loadProfile(userId: string) {
  const profile = await staffRepository.findByIdForAuth(userId);
  assertCanSignIn(profile);
  return profile;
}

async function toSession(issued: IssuedRefresh, profile: StaffProfile) {
  const access = signAccessToken(profile.id, issued.sessionId);
  return {
    accessToken: access.token,
    refreshToken: issued.refreshToken as string | null,
    tokenType: 'bearer' as const,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    expiresAt: access.expiresAt,
    refreshExpiresAt: issued.refreshExpiresAt.toISOString(),
    me: await toMe(profile),
  };
}

export type StaffSession = Awaited<ReturnType<typeof toSession>>;

const noMeta: SessionMeta = { device: null, ip: null };

export const authService = {
  async resolveContext(userId: string, sessionId: string | null = null): Promise<Express.AuthContext> {
    const profile = await loadProfile(userId);
    return {
      userId: profile.id,
      role: profile.role,
      branchId: profile.branchId,
      isSuperAdmin: profile.role === 'super_admin',
      sessionId,
    };
  },

  async login(identifier: string, password: string, meta: SessionMeta = noMeta) {
    const account = await staffRepository.findByLogin(identifier);
    if (!account) {
      await spendPasswordCheck(password);
      throw AppError.unauthorized(INVALID_CREDENTIALS);
    }
    const check = await staffAccounts.checkPassword(account.id, password);
    if (check === 'locked') throw new AppError(429, 'RATE_LIMITED', LOCKED);
    if (check !== 'ok') throw AppError.unauthorized(INVALID_CREDENTIALS);

    const profile = await loadProfile(account.id);
    await staffRepository.touchLastLogin(profile.id);
    return toSession(await staffSessions.open(profile.id, meta), profile);
  },

  async refresh(refreshToken: string, meta: SessionMeta = noMeta) {
    const issued = await staffSessions.rotate(refreshToken, meta);
    return toSession(issued, await loadProfile(issued.staffId));
  },

  async logout(refreshToken: string) {
    await staffSessions.revokeByToken(refreshToken);
  },

  async me(userId: string) {
    return await toMe(await loadProfile(userId));
  },

  async updateOwnProfile(actor: Actor, input: UpdateOwnProfileInput) {
    const profile = await loadProfile(actor.userId);
    Object.assign(profile, input, { updatedBy: actor.userId });
    await staffRepository.save(profile);
    return await toMe(profile);
  },

  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    const profile = await loadProfile(actor.userId);
    const check = await staffAccounts.checkPassword(profile.id, currentPassword);
    if (check === 'locked') throw new AppError(429, 'RATE_LIMITED', LOCKED);
    if (check !== 'ok') throw AppError.badRequest('Current password is incorrect');
    const hash = await staffAccounts.hashPassword(newPassword);
    await withTransaction(async (em) => {
      profile.mustChangePassword = false;
      profile.updatedBy = actor.userId;
      await staffRepository.save(profile, em);
      await staffAccounts.saveHash(profile.id, hash, em);
      await staffAccounts.endSessions(profile.id, 'password_changed', em, actor.sessionId ?? undefined);
      await auditService.record(
        {
          actor,
          branchId: profile.branchId,
          action: 'change_password',
          entity: 'staff',
          entityId: profile.id,
        },
        em,
      );
    });
  },
};
