import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo } from '../../database/transaction';
import { paginate, type ListQuery } from '../../lib/pagination';
import { BundleItem } from './bundle-item.entity';
import { Bundle } from './bundle.entity';

const base = branchScopedRepository(Bundle, 'b');

const withItems = (branchId: string, manager?: EntityManager) =>
  base
    .query(branchId, manager)
    .leftJoinAndSelect('b.items', 'item')
    .leftJoinAndSelect('item.product', 'product');

export const bundlesRepository = {
  ...base,

  findWithItems(branchId: string, id: string, manager?: EntityManager) {
    return withItems(branchId, manager).andWhere('b.id = :id', { id }).getOne();
  },

  async list(branchId: string, query: ListQuery, manager?: EntityManager) {
    const page = await paginate(base.query(branchId, manager), query, {
      searchColumns: ['b.name'],
      sortMap: { name: 'b.name', createdAt: 'b.createdAt', totalPrice: 'b.totalPrice' },
    });
    if (page.items.length === 0) return page;
    const ids = page.items.map((b) => b.id);
    const full = await withItems(branchId, manager).andWhere('b.id IN (:...ids)', { ids }).getMany();
    const byId = new Map(full.map((b) => [b.id, b]));
    return { ...page, items: page.items.map((b) => byId.get(b.id) ?? b) };
  },

  options(branchId: string, manager?: EntityManager) {
    return base
      .query(branchId, manager)
      .select(['b.id', 'b.name', 'b.totalPrice'])
      .orderBy('b.name', 'ASC')
      .getMany();
  },

  async replaceItems(bundleId: string, items: Partial<BundleItem>[], manager?: EntityManager) {
    const repository = repo(BundleItem, manager);
    await repository.delete({ bundleId });
    await repository.save(items.map((item) => repository.create({ ...item, bundleId })));
  },
};
