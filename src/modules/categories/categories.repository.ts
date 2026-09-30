import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { paginate, type ListQuery } from '../../lib/pagination';
import { Category } from './category.entity';

const base = branchScopedRepository(Category, 'c');

export const categoriesRepository = {
  ...base,

  list(branchId: string, query: ListQuery, manager?: EntityManager) {
    return paginate(base.query(branchId, manager), query, {
      searchColumns: ['c.name'],
      sortMap: { name: 'c.name', createdAt: 'c.createdAt' },
    });
  },

  options(branchId: string, manager?: EntityManager) {
    return base.query(branchId, manager).select(['c.id', 'c.name']).orderBy('c.name', 'ASC').getMany();
  },

  findByName(branchId: string, name: string, manager?: EntityManager) {
    return base.query(branchId, manager).andWhere('lower(c.name) = lower(:name)', { name }).getOne();
  },
};
