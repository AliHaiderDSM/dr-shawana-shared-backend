import { type EntityManager, type EntityTarget, type ObjectLiteral, type Repository } from 'typeorm';
import { AppDataSource } from './data-source';

export async function withTransaction<T>(
  work: (manager: EntityManager) => Promise<T>,
  manager?: EntityManager,
): Promise<T> {
  if (manager?.queryRunner?.isTransactionActive) return work(manager);
  return AppDataSource.transaction(work);
}

export function repo<T extends ObjectLiteral>(
  entity: EntityTarget<T>,
  manager?: EntityManager,
): Repository<T> {
  return (manager ?? AppDataSource.manager).getRepository(entity);
}
