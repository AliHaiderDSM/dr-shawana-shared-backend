import { In, type EntityManager } from 'typeorm';
import { repo } from '../../database/transaction';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { paginate } from '../../lib/pagination';
import { AccountSheet } from './account-sheet.entity';
import { type AccountSheetListQuery } from './accounts.schemas';
import { Bank } from './bank.entity';

const banksBase = branchScopedRepository(Bank, 'bk');
const sheetsBase = branchScopedRepository(AccountSheet, 'a');

export const banksRepository = {
  ...banksBase,

  findByName(branchId: string, name: string, manager?: EntityManager) {
    return banksBase.query(branchId, manager).andWhere('lower(bk.name) = lower(:name)', { name }).getOne();
  },

  findAnyByName(name: string, manager?: EntityManager) {
    return repo(Bank, manager)
      .createQueryBuilder('bk')
      .where('lower(bk.name) = lower(:name)', { name })
      .orderBy('bk.createdAt', 'ASC')
      .getOne();
  },
};

const shared = (manager?: EntityManager) => repo(AccountSheet, manager).createQueryBuilder('a');

export const accountSheetsRepository = {
  ...sheetsBase,

  findById(_branchId: string, id: string, manager?: EntityManager) {
    return shared(manager).andWhere('a.id = :id', { id }).getOne();
  },

  findByIds(_branchId: string, ids: string[], manager?: EntityManager) {
    if (ids.length === 0) return Promise.resolve([]);
    return shared(manager)
      .andWhere({ id: In(ids) })
      .getMany();
  },

  findWithBank(_branchId: string, id: string, manager?: EntityManager) {
    return shared(manager).leftJoinAndSelect('a.bank', 'bank').andWhere('a.id = :id', { id }).getOne();
  },

  list(_branchId: string, query: AccountSheetListQuery, manager?: EntityManager) {
    const qb = shared(manager).leftJoinAndSelect('a.bank', 'bank');
    if (query.type) qb.andWhere('a.type = :type', { type: query.type });
    if (query.bankId) qb.andWhere('a.bankId = :bankId', { bankId: query.bankId });
    return paginate(qb, query, {
      searchColumns: ['a.accountName', 'a.accountCode', 'bank.name'],
      sortMap: {
        accountName: 'a.accountName',
        accountCode: 'a.accountCode',
        date: 'a.date',
        createdAt: 'a.createdAt',
      },
    });
  },

  async options(_branchId: string, manager?: EntityManager) {
    const sheets = await shared(manager)
      .leftJoinAndSelect('a.bank', 'bank')
      .orderBy('bank.name', 'ASC', 'NULLS FIRST')
      .addOrderBy('a.accountName', 'ASC')
      .getMany();
    return sheets.map((s) => ({
      id: s.id,
      accountName: s.accountName,
      accountCode: s.accountCode,
      type: s.type,
      bankName: s.bank?.name ?? null,
    }));
  },
};
