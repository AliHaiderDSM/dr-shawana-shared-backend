import { type EntityManager } from 'typeorm';
import { repo } from '../../database/transaction';
import { paginate, type ListQuery } from '../../lib/pagination';
import { Branch, type BranchStatus } from './branch.entity';

export interface BranchListQuery extends ListQuery {
  status?: BranchStatus;
}

export const branchesRepository = {
  findById(id: string, manager?: EntityManager) {
    return repo(Branch, manager).findOne({ where: { id } });
  },

  findByCode(code: string, manager?: EntityManager) {
    return repo(Branch, manager).findOne({ where: { code } });
  },

  findWarehouse(manager?: EntityManager) {
    return repo(Branch, manager).findOne({ where: { kind: 'warehouse' } });
  },

  list(query: BranchListQuery, manager?: EntityManager) {
    const qb = repo(Branch, manager).createQueryBuilder('b');
    if (query.status) qb.andWhere('b.status = :status', { status: query.status });
    return paginate(qb, query, {
      searchColumns: ['b.name', 'b.code', 'b.city'],
      sortMap: { createdAt: 'b.createdAt', name: 'b.name', code: 'b.code', city: 'b.city' },
    });
  },

  options(manager?: EntityManager) {
    return repo(Branch, manager).find({
      select: { id: true, name: true, code: true, city: true, status: true, kind: true },
      order: { kind: 'DESC', name: 'ASC' },
    });
  },

  create(data: Partial<Branch>, manager?: EntityManager) {
    const branches = repo(Branch, manager);
    return branches.save(branches.create(data));
  },

  save(branch: Branch, manager?: EntityManager) {
    return repo(Branch, manager).save(branch);
  },

  async softDelete(branch: Branch, actorId: string, manager?: EntityManager) {
    await repo(Branch, manager).update({ id: branch.id }, { deletedBy: actorId });
    await repo(Branch, manager).softDelete({ id: branch.id });
  },
};
