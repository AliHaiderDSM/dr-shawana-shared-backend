import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { auditService } from '../audit/audit.service';
import { catalogService } from '../prescriptions/prescriptions.service';
import { staffRepository } from '../staff/staff.repository';
import { toStaffDto, staffService, type NewStaffAccount } from '../staff/staff.service';
import { type Branch, type BranchStatus } from './branch.entity';
import { branchesRepository, type BranchListQuery } from './branches.repository';
import { type CreateBranchInput, type UpdateBranchInput } from './branches.schemas';

export function toBranchDto(branch: Branch) {
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    city: branch.city,
    address: branch.address,
    phone: branch.phone,
    email: branch.email,
    logoPath: branch.logoPath,
    kind: branch.kind,
    status: branch.status,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}

async function getBranch(id: string, manager?: EntityManager) {
  const branch = await branchesRepository.findById(id, manager);
  if (!branch) throw AppError.notFound('Branch');
  return branch;
}

async function assertCodeAvailable(code: string, excludeId?: string, manager?: EntityManager) {
  const existing = await branchesRepository.findByCode(code, manager);
  if (existing && existing.id !== excludeId) throw AppError.conflict(`Branch code ${code} is already used`);
}

function assertNotWarehouse(branch: Branch, action: string) {
  if (branch.kind === 'warehouse') throw AppError.conflict(`The Super Admin stock cannot be ${action}`);
}

export const branchesService = {
  async list(query: BranchListQuery) {
    const { items, meta } = await branchesRepository.list(query);
    return { items: items.map(toBranchDto), meta };
  },

  options() {
    return branchesRepository.options();
  },

  async get(id: string) {
    return toBranchDto(await getBranch(id));
  },

  async create(actor: Actor, input: CreateBranchInput) {
    return withTransaction(async (em) => {
      await assertCodeAvailable(input.code, undefined, em);
      const branch = await branchesRepository.create(
        { ...input, kind: 'branch', status: 'active', createdBy: actor.userId },
        em,
      );
      await catalogService.seedBranch(branch.id, em);
      await auditService.record(
        {
          actor,
          branchId: branch.id,
          action: 'create',
          entity: 'branch',
          entityId: branch.id,
          after: toBranchDto(branch),
        },
        em,
      );
      return toBranchDto(branch);
    });
  },

  async update(actor: Actor, id: string, input: UpdateBranchInput) {
    return withTransaction(async (em) => {
      const branch = await getBranch(id, em);
      if (input.code && input.code !== branch.code) await assertCodeAvailable(input.code, id, em);
      const before = toBranchDto(branch);
      Object.assign(branch, input, { updatedBy: actor.userId });
      const saved = await branchesRepository.save(branch, em);
      await auditService.record(
        {
          actor,
          branchId: id,
          action: 'update',
          entity: 'branch',
          entityId: id,
          before,
          after: toBranchDto(saved),
        },
        em,
      );
      return toBranchDto(saved);
    });
  },

  async setStatus(actor: Actor, id: string, status: BranchStatus) {
    return withTransaction(async (em) => {
      const branch = await getBranch(id, em);
      if (status === 'inactive') assertNotWarehouse(branch, 'deactivated');
      if (branch.status === status) return toBranchDto(branch);
      const before = toBranchDto(branch);
      branch.status = status;
      branch.updatedBy = actor.userId;
      const saved = await branchesRepository.save(branch, em);
      await auditService.record(
        {
          actor,
          branchId: id,
          action: status === 'active' ? 'activate' : 'deactivate',
          entity: 'branch',
          entityId: id,
          before,
          after: toBranchDto(saved),
        },
        em,
      );
      return toBranchDto(saved);
    });
  },

  async remove(actor: Actor, id: string) {
    await withTransaction(async (em) => {
      const branch = await getBranch(id, em);
      assertNotWarehouse(branch, 'deleted');
      if ((await staffRepository.countInBranch(id, em)) > 0) {
        throw AppError.conflict(
          'This branch still has staff. Deactivate it instead, or remove its staff first.',
        );
      }
      await branchesRepository.softDelete(branch, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId: id,
          action: 'delete',
          entity: 'branch',
          entityId: id,
          before: toBranchDto(branch),
        },
        em,
      );
    });
  },

  async createBranchAdmin(actor: Actor, branchId: string, input: Omit<NewStaffAccount, 'role'>) {
    assertNotWarehouse(await getBranch(branchId), 'given staff');
    const profile = await staffService.createAccount(actor, branchId, { ...input, role: 'branch_admin' });
    return toStaffDto(profile);
  },
};
