import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { paginate, type ListQuery } from '../../lib/pagination';
import { AccountSheet } from './account-sheet.entity';
import { type AccountSheetListQuery } from './accounts.schemas';
import { Bank } from './bank.entity';

const banksBase = branchScopedRepository(Bank, 'bk');
const sheetsBase = branchScopedRepository(AccountSheet, 'a');

export const banksRepository = {
  ...banksBase,

  list(branchId: string, query: ListQuery, manager?: EntityManager) {
    return paginate(banksBase.query(branchId, manager), query, {
      searchColumns: ['bk.name'],
      sortMap: { name: 'bk.name', createdAt: 'bk.createdAt' },
    });
  },

  options(branchId: string, manager?: EntityManager) {
    return banksBase
      .query(branchId, manager)
      .select(['bk.id', 'bk.name'])
      .orderBy('bk.name', 'ASC')
      .getMany();
  },

  findByName(branchId: string, name: string, manager?: EntityManager) {
    return banksBase.query(branchId, manager).andWhere('lower(bk.name) = lower(:name)', { name }).getOne();
  },
};

export const accountSheetsRepository = {
  ...sheetsBase,

  findWithBank(branchId: string, id: string, manager?: EntityManager) {
    return sheetsBase
      .query(branchId, manager)
      .leftJoinAndSelect('a.bank', 'bank')
      .andWhere('a.id = :id', { id })
      .getOne();
  },

  list(branchId: string, query: AccountSheetListQuery, manager?: EntityManager) {
    const qb = sheetsBase.query(branchId, manager).leftJoinAndSelect('a.bank', 'bank');
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

  async options(branchId: string, manager?: EntityManager) {
    const sheets = await sheetsBase
      .query(branchId, manager)
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
