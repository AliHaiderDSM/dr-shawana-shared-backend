import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { type ListQuery } from '../../lib/pagination';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { type AccountSheet } from './account-sheet.entity';
import { accountSheetsRepository, banksRepository } from './accounts.repository';
import {
  type AccountSheetListQuery,
  type CreateAccountSheetInput,
  type CreateBankInput,
  type UpdateAccountSheetInput,
  type UpdateBankInput,
} from './accounts.schemas';
import { type Bank } from './bank.entity';

export const toBankDto = (bank: Bank) => withoutInternals(bank);

export function toAccountSheetDto(sheet: AccountSheet) {
  const { bank, ...rest } = withoutInternals(sheet);
  return { ...rest, bank: bank ? { id: bank.id, name: bank.name } : null };
}

async function getBank(branchId: string, id: string, manager?: EntityManager) {
  const bank = await banksRepository.findById(branchId, id, manager);
  if (!bank) throw AppError.notFound('Bank');
  return bank;
}

async function getSheet(branchId: string, id: string, manager?: EntityManager) {
  const sheet = await accountSheetsRepository.findWithBank(branchId, id, manager);
  if (!sheet) throw AppError.notFound('Account sheet');
  return sheet;
}

async function assertBankNameAvailable(branchId: string, name: string, excludeId?: string) {
  const existing = await banksRepository.findByName(branchId, name);
  if (existing && existing.id !== excludeId) throw AppError.conflict(`Bank "${name}" is already added`);
}

export const banksService = {
  async list(branchId: string, query: ListQuery) {
    const { items, meta } = await banksRepository.list(branchId, query);
    return { items: items.map(toBankDto), meta };
  },

  options: (branchId: string) => banksRepository.options(branchId),

  async get(branchId: string, id: string) {
    return toBankDto(await getBank(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateBankInput) {
    await assertBankNameAvailable(branchId, input.name);
    return toBankDto(await banksRepository.create(branchId, actor.userId, input));
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateBankInput) {
    const bank = await getBank(branchId, id);
    if (input.name) await assertBankNameAvailable(branchId, input.name, id);
    Object.assign(bank, input, { updatedBy: actor.userId });
    return toBankDto(await banksRepository.save(bank));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const bank = await getBank(branchId, id, em);
      if ((await accountSheetsRepository.count(branchId, { bankId: id }, em)) > 0) {
        throw AppError.conflict('Account sheets still use this bank. Remove them first.');
      }
      await banksRepository.softDelete(bank, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'bank', entityId: id, before: toBankDto(bank) },
        em,
      );
    });
  },
};

export const accountSheetsService = {
  async list(branchId: string, query: AccountSheetListQuery) {
    const { items, meta } = await accountSheetsRepository.list(branchId, query);
    return { items: items.map(toAccountSheetDto), meta };
  },

  options: (branchId: string) => accountSheetsRepository.options(branchId),

  async get(branchId: string, id: string) {
    return toAccountSheetDto(await getSheet(branchId, id));
  },

  async requireInBranch(branchId: string, id: string, manager?: EntityManager) {
    return getSheet(branchId, id, manager);
  },

  async create(actor: Actor, branchId: string, input: CreateAccountSheetInput) {
    return withTransaction(async (em) => {
      const bankId = input.type === 'bank' ? (input.bankId ?? null) : null;
      if (bankId) await getBank(branchId, bankId, em);
      const created = await accountSheetsRepository.create(
        branchId,
        actor.userId,
        {
          accountName: input.accountName,
          accountCode: input.accountCode,
          type: input.type,
          bankId,
          openingBalance: (input.openingBalance ?? '0') as never,
          date: input.date ?? today(),
        },
        em,
      );
      const sheet = await getSheet(branchId, created.id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'create',
          entity: 'account_sheet',
          entityId: sheet.id,
          after: toAccountSheetDto(sheet),
        },
        em,
      );
      return toAccountSheetDto(sheet);
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateAccountSheetInput) {
    return withTransaction(async (em) => {
      const sheet = await getSheet(branchId, id, em);
      const before = toAccountSheetDto(sheet);
      Object.assign(sheet, input, { updatedBy: actor.userId });
      await accountSheetsRepository.save(sheet, em);
      const saved = await getSheet(branchId, id, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'account_sheet',
          entityId: id,
          before,
          after: toAccountSheetDto(saved),
        },
        em,
      );
      return toAccountSheetDto(saved);
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const sheet = await getSheet(branchId, id, em);
      await accountSheetsRepository.softDelete(sheet, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'account_sheet',
          entityId: id,
          before: toAccountSheetDto(sheet),
        },
        em,
      );
    });
  },
};
