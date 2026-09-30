import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { paginate, type ListQuery } from '../../lib/pagination';
import { Supplier, type SupplierType } from './supplier.entity';

const base = branchScopedRepository(Supplier, 's');

export const suppliersRepository = {
  ...base,

  list(branchId: string, query: ListQuery & { type?: SupplierType }, manager?: EntityManager) {
    const qb = base.query(branchId, manager);
    if (query.type) qb.andWhere('s.type = :type', { type: query.type });
    return paginate(qb, query, {
      searchColumns: ['s.name', 's.phone', 's.address'],
      sortMap: { name: 's.name', createdAt: 's.createdAt', type: 's.type' },
    });
  },

  options(branchId: string, type?: SupplierType, manager?: EntityManager) {
    const qb = base.query(branchId, manager).select(['s.id', 's.name', 's.type']).orderBy('s.name', 'ASC');
    if (type) qb.andWhere('s.type = :type', { type });
    return qb.getMany();
  },
};
