import { type Session } from '@supabase/supabase-js';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { permissionsFor } from '../../lib/permissions';
import { createSupabaseAuthClient } from '../../lib/supabase';
import { auditService } from '../audit/audit.service';
import { type StaffProfile } from '../staff/staff-profile.entity';
import { staffAccounts } from '../staff/staff-accounts';
import { staffRepository } from '../staff/staff.repository';
import { toStaffDto } from '../staff/staff.service';
import { type UpdateOwnProfileInput } from './auth.schemas';

const INVALID_CREDENTIALS = 'Invalid username/email or password';

function assertCanSignIn(profile: StaffProfile | null): asserts profile is StaffProfile {
  if (!profile) throw AppError.unauthorized('No staff account is linked to this login');
  if (profile.status !== 'active') throw AppError.forbidden('Your account is inactive');
  if (profile.role === 'super_admin') return;
  const branch = profile.branch;
  if (!branch || branch.deletedAt || branch.status !== 'active') {
    throw AppError.forbidden('Your branch is inactive');
  }
}

function toMe(profile: StaffProfile) {
  const branch = profile.branch;
  return {
    profile: toStaffDto(profile),
    role: profile.role,
    branch: branch ? { id: branch.id, name: branch.name, code: branch.code, city: branch.city } : null,
    permissions: permissionsFor(profile.role),
  };
}

async function loadProfile(userId: string) {
  const profile = await staffRepository.findByIdForAuth(userId);
  assertCanSignIn(profile);
  return profile;
}

function toSession(session: Session, profile: StaffProfile) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    tokenType: 'bearer' as const,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? null,
    me: toMe(profile),
  };
}

async function verifyPassword(email: string, password: string): Promise<Session | null> {
  const { data, error } = await createSupabaseAuthClient().auth.signInWithPassword({ email, password });
  return error || !data.session ? null : data.session;
}

export const authService = {
  async resolveContext(userId: string): Promise<Express.AuthContext> {
    const profile = await loadProfile(userId);
    return {
      userId: profile.id,
      role: profile.role,
      branchId: profile.branchId,
      isSuperAdmin: profile.role === 'super_admin',
    };
  },

  async login(identifier: string, password: string) {
    const account = await staffRepository.findByLogin(identifier);
    if (!account) throw AppError.unauthorized(INVALID_CREDENTIALS);

    const session = await verifyPassword(account.email, password);
    if (!session) throw AppError.unauthorized(INVALID_CREDENTIALS);

    const profile = await loadProfile(account.id);
    await staffRepository.touchLastLogin(profile.id);
    return toSession(session, profile);
  },

  async refresh(refreshToken: string) {
    const { data, error } = await createSupabaseAuthClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session || !data.user)
      throw AppError.unauthorized('Session expired, please log in again');
    return toSession(data.session, await loadProfile(data.user.id));
  },

  async me(userId: string) {
    return toMe(await loadProfile(userId));
  },

  async updateOwnProfile(actor: Actor, input: UpdateOwnProfileInput) {
    const profile = await loadProfile(actor.userId);
    Object.assign(profile, input, { updatedBy: actor.userId });
    await staffRepository.save(profile);
    return toMe(profile);
  },

  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    const profile = await loadProfile(actor.userId);
    if (!(await verifyPassword(profile.email, currentPassword))) {
      throw AppError.badRequest('Current password is incorrect');
    }
    await withTransaction(async (em) => {
      profile.mustChangePassword = false;
      profile.updatedBy = actor.userId;
      await staffRepository.save(profile, em);
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
      await staffAccounts.setPassword(profile.id, newPassword);
    });
  },
};
