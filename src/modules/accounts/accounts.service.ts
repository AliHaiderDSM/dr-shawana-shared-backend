import { type EntityManager } from 'typeorm';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { type AccountSheet } from './account-sheet.entity';
import { accountSheetsRepository, banksRepository } from './accounts.repository';
import {
  type AccountSheetListQuery,
  type CreateAccountSheetInput,
  type UpdateAccountSheetInput,
} from './accounts.schemas';

export function toAccountSheetDto(sheet: AccountSheet) {
  const { bank, ...rest } = withoutInternals(sheet);
  return { ...rest, bank: bank ? { id: bank.id, name: bank.name } : null };
}

async function getSheet(branchId: string, id: string, manager?: EntityManager) {
  const sheet = await accountSheetsRepository.findWithBank(branchId, id, manager);
  if (!sheet) throw AppError.notFound('Account sheet');
  return sheet;
}

async function bankIdFor(actor: Actor, branchId: string, name: string | null | undefined, em: EntityManager) {
  const bankName = name?.trim();
  if (!bankName)
    throw AppError.validation([{ path: 'body.bankName', message: 'A bank account needs a bank' }]);
  const existing = await banksRepository.findByName(branchId, bankName, em);
  if (existing) return existing.id;
  return (await banksRepository.create(branchId, actor.userId, { name: bankName }, em)).id;
}

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
      const bankId = input.type === 'bank' ? await bankIdFor(actor, branchId, input.bankName, em) : null;
      const created = await accountSheetsRepository.create(
        branchId,
        actor.userId,
        {
          accountName: input.accountName,
          accountCode: input.accountCode,
          type: input.type,
          bankId,
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
      const { bankName, ...fields } = input;
      Object.assign(sheet, fields, { updatedBy: actor.userId });
      if (input.type === 'cash') Object.assign(sheet, { bankId: null, bank: null });
      else if (bankName !== undefined || input.type === 'bank') {
        const bankId = await bankIdFor(actor, branchId, bankName ?? sheet.bank?.name, em);
        Object.assign(sheet, { bankId, bank: undefined });
      }
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
