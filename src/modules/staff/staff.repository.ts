import { type EntityManager } from 'typeorm';
import { repo } from '../../database/transaction';
import { type Role } from '../../lib/permissions';
import { paginate, type ListQuery } from '../../lib/pagination';
import { StaffProfile, type StaffStatus } from './staff-profile.entity';

export interface StaffListQuery extends ListQuery {
  role?: Role;
  status?: StaffStatus;
}

export const staffRepository = {
  findInBranch(branchId: string, id: string, manager?: EntityManager) {
    return repo(StaffProfile, manager).findOne({ where: { id, branchId } });
  },

  listInBranch(branchId: string, query: StaffListQuery, manager?: EntityManager) {
    const qb = repo(StaffProfile, manager)
      .createQueryBuilder('s')
      .where('s.branchId = :branchId', { branchId });
    if (query.role) qb.andWhere('s.role = :role', { role: query.role });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    return paginate(qb, query, {
      searchColumns: ['s.firstName', 's.lastName', 's.username', 's.email', 's.phone'],
      sortMap: {
        createdAt: 's.createdAt',
        firstName: 's.firstName',
        lastName: 's.lastName',
        username: 's.username',
        role: 's.role',
      },
    });
  },

  countInBranch(branchId: string, manager?: EntityManager) {
    return repo(StaffProfile, manager).count({ where: { branchId } });
  },

  findByIdForAuth(id: string, manager?: EntityManager) {
    return repo(StaffProfile, manager).findOne({ where: { id }, relations: { branch: true } });
  },

  findByLogin(identifier: string, manager?: EntityManager) {
    const value = identifier.trim().toLowerCase();
    return repo(StaffProfile, manager).findOne({
      where: [{ username: value }, { email: value }],
    });
  },

  findConflicts(email: string, username: string, excludeId?: string, manager?: EntityManager) {
    const qb = repo(StaffProfile, manager)
      .createQueryBuilder('s')
      .withDeleted()
      .where('(s.email = :email OR s.username = :username)', { email, username });
    if (excludeId) qb.andWhere('s.id <> :excludeId', { excludeId });
    return qb.getMany();
  },

  insert(data: Partial<StaffProfile>, manager?: EntityManager) {
    const profiles = repo(StaffProfile, manager);
    return profiles.save(profiles.create(data));
  },

  save(profile: StaffProfile, manager?: EntityManager) {
    return repo(StaffProfile, manager).save(profile);
  },

  touchLastLogin(id: string, manager?: EntityManager) {
    return repo(StaffProfile, manager).update({ id }, { lastLoginAt: new Date() });
  },

  async softDelete(profile: StaffProfile, actorId: string, manager?: EntityManager) {
    await repo(StaffProfile, manager).update({ id: profile.id }, { deletedBy: actorId });
    await repo(StaffProfile, manager).softDelete({ id: profile.id });
  },
};
