import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { canManageRole, DISPATCH_ROLES, WAREHOUSE_ROLES, type Role } from '../../lib/permissions';
import { auditService } from '../audit/audit.service';
import { branchesRepository } from '../branches/branches.repository';
import { type StaffProfile, type StaffStatus } from './staff-profile.entity';
import { staffAccounts } from './staff-accounts';
import { staffRepository, type StaffListQuery } from './staff.repository';
import { type UpdateStaffInput } from './staff.schemas';

export interface NewStaffAccount {
  role: Role;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  phone?: string | null;
  gender?: StaffProfile['gender'];
  designation?: string | null;
}

export function toStaffDto(profile: StaffProfile) {
  return {
    id: profile.id,
    branchId: profile.branchId,
    role: profile.role,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    username: profile.username,
    phone: profile.phone,
    gender: profile.gender,
    designation: profile.designation,
    branch: profile.branch
      ? {
          id: profile.branch.id,
          name: profile.branch.name,
          code: profile.branch.code,
          kind: profile.branch.kind,
        }
      : null,
    avatarPath: profile.avatarPath,
    status: profile.status,
    mustChangePassword: profile.mustChangePassword,
    lastLoginAt: profile.lastLoginAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function assertCanManage(actor: Actor, role: Role) {
  if (!canManageRole(actor.role, role)) {
    throw AppError.forbidden(`You cannot manage staff with the ${role} role`);
  }
}

function assertRoleFitsBranch(kind: string, role: Role) {
  if (kind === 'warehouse' && !WAREHOUSE_ROLES.includes(role)) {
    throw AppError.conflict(
      'The Super Admin stock has only Warehouse Keepers and Lab Officers. The Super Admin runs it.',
    );
  }
  if (kind !== 'warehouse' && WAREHOUSE_ROLES.includes(role)) {
    throw AppError.unprocessable('Warehouse Keepers and Lab Officers work only at the Super Admin stock');
  }
  if (kind !== 'dispatch' && (role === 'store_keeper' || role === 'dispatcher')) {
    throw AppError.unprocessable(
      `${role === 'dispatcher' ? 'A Dispatcher' : 'A Store Keeper'} works only in the Dispatch Department`,
    );
  }
  if (kind === 'dispatch' && !DISPATCH_ROLES.includes(role)) {
    throw AppError.unprocessable(
      'The Dispatch Department has only these roles: Branch Admin, Store Keeper, Delivery Print and Dispatcher',
    );
  }
}

function assertNotSelf(actor: Actor, profile: StaffProfile) {
  if (actor.userId === profile.id) throw AppError.forbidden('You cannot change your own account here');
}

async function ensureBranchExists(branchId: string, manager?: EntityManager) {
  const branch = await branchesRepository.findById(branchId, manager);
  if (!branch) throw AppError.notFound('Branch');
  return branch;
}

async function assertUnique(email: string, username: string, excludeId?: string) {
  const conflicts = await staffRepository.findConflicts(email, username, excludeId);
  if (conflicts.some((c) => c.email === email)) throw AppError.conflict('Email is already in use');
  if (conflicts.some((c) => c.username === username)) throw AppError.conflict('Username is already taken');
}

export async function getInBranch(branchId: string, id: string, manager?: EntityManager) {
  const profile = await staffRepository.findInBranch(branchId, id, manager);
  if (!profile) throw AppError.notFound('Staff member');
  return profile;
}

export const staffService = {
  async createAccount(
    actor: Actor | null,
    branchId: string | null,
    input: NewStaffAccount,
    afterInsert?: (manager: EntityManager, profile: StaffProfile) => Promise<void>,
  ) {
    await assertUnique(input.email, input.username);
    const userId = await staffAccounts.create(input.email, input.password, {
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
    });

    try {
      const created = await withTransaction(async (em) => {
        const profile = await staffRepository.insert(
          {
            id: userId,
            branchId,
            role: input.role,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            username: input.username,
            phone: input.phone ?? null,
            gender: input.gender ?? null,
            designation: input.designation ?? null,
            status: 'active',
            mustChangePassword: true,
            createdBy: actor?.userId ?? null,
          },
          em,
        );
        await auditService.record(
          {
            actor,
            branchId,
            action: 'create',
            entity: 'staff',
            entityId: profile.id,
            after: toStaffDto(profile),
          },
          em,
        );
        await afterInsert?.(em, profile);
        return profile;
      });
      return created;
    } catch (err) {
      await staffAccounts.remove(userId).catch((cleanupError: unknown) => {
        logger.error({ err: cleanupError, userId }, 'Failed to remove auth user after profile insert failed');
      });
      throw err;
    }
  },

  async create(actor: Actor, branchId: string, input: NewStaffAccount) {
    assertCanManage(actor, input.role);
    const branch = await ensureBranchExists(branchId);
    assertRoleFitsBranch(branch.kind, input.role);
    return toStaffDto(await this.createAccount(actor, branchId, input));
  },

  async list(branchId: string | null, query: StaffListQuery) {
    if (branchId) await ensureBranchExists(branchId);
    const { items, meta } = await staffRepository.listInBranch(branchId, query);
    return { items: items.map(toStaffDto), meta };
  },

  async get(branchId: string, id: string) {
    return toStaffDto(await getInBranch(branchId, id));
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateStaffInput) {
    return withTransaction(async (em) => {
      const profile = await getInBranch(branchId, id, em);
      assertNotSelf(actor, profile);
      assertCanManage(actor, profile.role);
      if (input.role) {
        assertCanManage(actor, input.role);
        const branch = await ensureBranchExists(branchId, em);
        assertRoleFitsBranch(branch.kind, input.role);
      }

      const email = input.email ?? profile.email;
      const username = input.username ?? profile.username;
      if (email !== profile.email || username !== profile.username) await assertUnique(email, username, id);

      const before = toStaffDto(profile);
      const emailChanged = email !== profile.email;
      Object.assign(profile, input, { updatedBy: actor.userId });
      const saved = await staffRepository.save(profile, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'staff',
          entityId: id,
          before,
          after: toStaffDto(saved),
        },
        em,
      );
      if (emailChanged) await staffAccounts.setEmail(id, email);
      return toStaffDto(saved);
    });
  },

  async resetPassword(actor: Actor, branchId: string, id: string, password: string) {
    const result = await withTransaction(async (em) => {
      const profile = await getInBranch(branchId, id, em);
      assertNotSelf(actor, profile);
      assertCanManage(actor, profile.role);
      profile.mustChangePassword = true;
      profile.updatedBy = actor.userId;
      const saved = await staffRepository.save(profile, em);
      await auditService.record(
        { actor, branchId, action: 'reset_password', entity: 'staff', entityId: id },
        em,
      );
      await staffAccounts.setPassword(id, password);
      return toStaffDto(saved);
    });
    return result;
  },

  async setStatus(actor: Actor, branchId: string, id: string, status: StaffStatus) {
    return withTransaction(async (em) => {
      const profile = await getInBranch(branchId, id, em);
      assertNotSelf(actor, profile);
      assertCanManage(actor, profile.role);
      if (profile.status === status) return toStaffDto(profile);

      const before = toStaffDto(profile);
      profile.status = status;
      profile.updatedBy = actor.userId;
      const saved = await staffRepository.save(profile, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: status === 'active' ? 'activate' : 'deactivate',
          entity: 'staff',
          entityId: id,
          before,
          after: toStaffDto(saved),
        },
        em,
      );
      await staffAccounts.setBlocked(id, status === 'inactive');
      return toStaffDto(saved);
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const profile = await getInBranch(branchId, id, em);
      assertNotSelf(actor, profile);
      assertCanManage(actor, profile.role);
      await staffRepository.softDelete(profile, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'staff', entityId: id, before: toStaffDto(profile) },
        em,
      );
      await staffAccounts.setBlocked(id, true);
    });
  },
};
