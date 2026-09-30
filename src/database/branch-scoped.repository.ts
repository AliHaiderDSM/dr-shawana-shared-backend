import {
  In,
  type EntityManager,
  type EntityTarget,
  type FindOptionsWhere,
  type SelectQueryBuilder,
} from 'typeorm';
import { type BranchScopedEntity } from './branch-scoped.entity';
import { repo } from './transaction';

export function branchScopedRepository<T extends BranchScopedEntity>(entity: EntityTarget<T>, alias: string) {
  const scoped = (branchId: string, where: Partial<Record<keyof T, unknown>> = {}) =>
    ({ ...where, branchId }) as FindOptionsWhere<T>;

  const reload = (record: T, manager?: EntityManager): Promise<T> =>
    repo(entity, manager).findOneOrFail({
      where: scoped(record.branchId, { id: record.id } as Partial<Record<keyof T, unknown>>),
    });

  return {
    alias,

    findById(branchId: string, id: string, manager?: EntityManager): Promise<T | null> {
      return repo(entity, manager).findOne({
        where: scoped(branchId, { id } as Partial<Record<keyof T, unknown>>),
      });
    },

    findByIds(branchId: string, ids: string[], manager?: EntityManager): Promise<T[]> {
      if (ids.length === 0) return Promise.resolve([]);
      return repo(entity, manager).find({
        where: scoped(branchId, { id: In(ids) } as Partial<Record<keyof T, unknown>>),
      });
    },

    findOneBy(branchId: string, where: Partial<Record<keyof T, unknown>>, manager?: EntityManager) {
      return repo(entity, manager).findOne({ where: scoped(branchId, where) });
    },

    count(branchId: string, where: Partial<Record<keyof T, unknown>> = {}, manager?: EntityManager) {
      return repo(entity, manager).count({ where: scoped(branchId, where) });
    },

    query(branchId: string, manager?: EntityManager): SelectQueryBuilder<T> {
      return repo(entity, manager)
        .createQueryBuilder(alias)
        .where(`${alias}.branchId = :branchId`, { branchId });
    },

    async create(branchId: string, actorId: string, data: Partial<T>, manager?: EntityManager): Promise<T> {
      const repository = repo(entity, manager);
      const saved = await repository.save(repository.create({ ...data, branchId, createdBy: actorId } as T));
      return reload(saved, manager);
    },

    async save(record: T, manager?: EntityManager): Promise<T> {
      return reload(await repo(entity, manager).save(record), manager);
    },

    async softDelete(record: T, actorId: string, manager?: EntityManager): Promise<void> {
      const repository = repo(entity, manager);
      const where = scoped(record.branchId, { id: record.id } as Partial<Record<keyof T, unknown>>);
      await repository.update(where, { deletedBy: actorId } as never);
      await repository.softDelete(where);
    },
  };
}

export type BranchScopedRepository<T extends BranchScopedEntity> = ReturnType<
  typeof branchScopedRepository<T>
>;
