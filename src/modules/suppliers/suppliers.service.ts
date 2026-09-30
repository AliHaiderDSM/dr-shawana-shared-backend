import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { type ListQuery } from '../../lib/pagination';
import { auditService } from '../audit/audit.service';
import { type Supplier, type SupplierType } from './supplier.entity';
import { suppliersRepository } from './suppliers.repository';
import { type CreateSupplierInput, type UpdateSupplierInput } from './suppliers.schemas';

export const toSupplierDto = (supplier: Supplier) => withoutInternals(supplier);

async function getSupplier(branchId: string, id: string, manager?: EntityManager) {
  const supplier = await suppliersRepository.findById(branchId, id, manager);
  if (!supplier) throw AppError.notFound('Supplier');
  return supplier;
}

export const suppliersService = {
  async list(branchId: string, query: ListQuery & { type?: SupplierType }) {
    const { items, meta } = await suppliersRepository.list(branchId, query);
    return { items: items.map(toSupplierDto), meta };
  },

  options(branchId: string, query?: { type?: SupplierType }) {
    return suppliersRepository.options(branchId, query?.type);
  },

  async get(branchId: string, id: string) {
    return toSupplierDto(await getSupplier(branchId, id));
  },

  async requireOfType(branchId: string, id: string, type: SupplierType, manager?: EntityManager) {
    const supplier = await getSupplier(branchId, id, manager);
    if (supplier.type !== type) throw AppError.badRequest(`The selected ${supplier.type} is not a ${type}`);
    return supplier;
  },

  async create(actor: Actor, branchId: string, input: CreateSupplierInput) {
    return toSupplierDto(await suppliersRepository.create(branchId, actor.userId, input));
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateSupplierInput) {
    const supplier = await getSupplier(branchId, id);
    Object.assign(supplier, input, { updatedBy: actor.userId });
    return toSupplierDto(await suppliersRepository.save(supplier));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const supplier = await getSupplier(branchId, id, em);
      await suppliersRepository.softDelete(supplier, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'supplier',
          entityId: id,
          before: toSupplierDto(supplier),
        },
        em,
      );
    });
  },
};
