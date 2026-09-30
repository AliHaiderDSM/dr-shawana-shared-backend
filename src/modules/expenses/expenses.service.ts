import { type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { withTransaction } from '../../database/transaction';
import { toMoney } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { uploadMany, withUploads } from '../../lib/file-uploads';
import { withoutInternals } from '../../lib/http';
import { applyListQuery, escapeLike, pageMeta, paginate, type ListQuery } from '../../lib/pagination';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { auditService } from '../audit/audit.service';
import { journalService, type PostingLine } from '../journal/journal.service';
import { ExpenseCategory } from './expense-category.entity';
import { Expense } from './expense.entity';
import {
  type CreateExpenseCategoryInput,
  type CreateExpenseInput,
  type ExpenseListQuery,
  type UpdateExpenseCategoryInput,
  type UpdateExpenseInput,
} from './expenses.schemas';

const categories = branchScopedRepository(ExpenseCategory, 'ec');
const expenses = branchScopedRepository(Expense, 'ex');

const toCategoryDto = (c: ExpenseCategory) => withoutInternals(c);

function toExpenseDto(e: Expense) {
  return {
    id: e.id,
    branchId: e.branchId,
    date: e.date,
    categoryId: e.categoryId,
    category: e.category ? { id: e.category.id, name: e.category.name } : null,
    amount: e.amount,
    accountSheetId: e.accountSheetId,
    accountSheet: e.accountSheet
      ? {
          id: e.accountSheet.id,
          accountName: e.accountSheet.accountName,
          accountCode: e.accountSheet.accountCode,
        }
      : null,
    note: e.note,
    journalEntryId: e.journalEntryId,
    hasAttachment: e.attachmentPath !== null,
    attachmentName: e.attachmentName,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
  };
}

async function getCategory(branchId: string, id: string, manager?: EntityManager) {
  const category = await categories.findById(branchId, id, manager);
  if (!category) throw AppError.notFound('Expense category');
  return category;
}

function detailed(branchId: string, manager?: EntityManager) {
  return expenses
    .query(branchId, manager)
    .leftJoinAndSelect('ex.category', 'category')
    .leftJoinAndSelect('ex.accountSheet', 'sheet');
}

async function getExpense(branchId: string, id: string, manager?: EntityManager) {
  const expense = await detailed(branchId, manager).andWhere('ex.id = :id', { id }).getOne();
  if (!expense) throw AppError.notFound('Expense');
  return expense;
}

function posting(expense: Pick<Expense, 'categoryId' | 'accountSheetId' | 'amount' | 'note'>): PostingLine[] {
  return [
    { expenseCategoryId: expense.categoryId, description: expense.note, debit: expense.amount, credit: 0 },
    { accountSheetId: expense.accountSheetId, description: expense.note, debit: 0, credit: expense.amount },
  ];
}

function filtered(qb: SelectQueryBuilder<Expense>, query: ExpenseListQuery) {
  if (query.categoryId) qb.andWhere('ex.categoryId = :categoryId', { categoryId: query.categoryId });
  if (query.accountSheetId) qb.andWhere('ex.accountSheetId = :sheet', { sheet: query.accountSheetId });
  if (query.month) qb.andWhere(`to_char(ex.date, 'YYYY-MM') = :month`, { month: query.month });
  if (query.from) qb.andWhere('ex.date >= :from', { from: query.from });
  if (query.to) qb.andWhere('ex.date <= :to', { to: query.to });
  if (query.search)
    qb.andWhere('(ex.note ILIKE :term OR category.name ILIKE :term)', {
      term: `%${escapeLike(query.search)}%`,
    });
  return qb;
}

export const expenseCategoriesService = {
  async list(branchId: string, query: ListQuery) {
    const { items, meta } = await paginate(categories.query(branchId), query, {
      searchColumns: ['ec.name'],
      sortMap: { name: 'ec.name', createdAt: 'ec.createdAt' },
    });
    return { items: items.map(toCategoryDto), meta };
  },
  async options(branchId: string) {
    return categories.query(branchId).select(['ec.id', 'ec.name']).orderBy('ec.name', 'ASC').getMany();
  },
  async get(branchId: string, id: string) {
    return toCategoryDto(await getCategory(branchId, id));
  },
  async create(actor: Actor, branchId: string, input: CreateExpenseCategoryInput) {
    return toCategoryDto(await categories.create(branchId, actor.userId, input));
  },
  async update(actor: Actor, branchId: string, id: string, input: UpdateExpenseCategoryInput) {
    const category = await getCategory(branchId, id);
    Object.assign(category, input, { updatedBy: actor.userId });
    return toCategoryDto(await categories.save(category));
  },
  async remove(actor: Actor, branchId: string, id: string) {
    const category = await getCategory(branchId, id);
    if ((await expenses.count(branchId, { categoryId: id })) > 0) {
      throw AppError.conflict('Expenses still use this category');
    }
    await categories.softDelete(category, actor.userId);
  },
};

export const expensesService = {
  async list(branchId: string, query: ExpenseListQuery) {
    const total = await filtered(detailed(branchId), query)
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(ex.amount), 0)', 'amount')
      .getRawOne<{ count: string; amount: string }>();
    const rows = await applyListQuery(
      filtered(detailed(branchId), query),
      { ...query, search: undefined },
      {
        sortMap: { date: 'ex.date', createdAt: 'ex.createdAt', amount: 'ex.amount' },
      },
    ).getMany();
    return {
      items: rows.map(toExpenseDto),
      meta: { ...pageMeta(query, Number(total?.count ?? 0)), totalAmount: toMoney(total?.amount ?? 0) },
    };
  },

  async get(branchId: string, id: string) {
    return toExpenseDto(await getExpense(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateExpenseInput, file?: Express.Multer.File) {
    await getCategory(branchId, input.categoryId);
    const uploaded = file ? await uploadMany(BUCKETS.stockFiles, `${branchId}/expenses`, [file]) : [];
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const category = await getCategory(branchId, input.categoryId, em);
        const entry = await journalService.post(
          em,
          actor,
          branchId,
          { date: input.date, narration: `Expense: ${category.name}`, source: 'expense' },
          posting({ ...input, note: input.note ?? null } as never),
        );
        const expense = await expenses.create(
          branchId,
          actor.userId,
          {
            ...input,
            amount: input.amount as never,
            note: input.note ?? null,
            journalEntryId: entry.id,
            attachmentPath: uploaded[0]?.path ?? null,
            attachmentName: uploaded[0]?.originalName ?? null,
          },
          em,
        );
        const dto = toExpenseDto(await getExpense(branchId, expense.id, em));
        await auditService.record(
          { actor, branchId, action: 'create', entity: 'expense', entityId: expense.id, after: dto },
          em,
        );
        return dto;
      }),
    );
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateExpenseInput) {
    return withTransaction(async (em) => {
      const expense = await getExpense(branchId, id, em);
      const before = toExpenseDto(expense);
      if (input.categoryId) await getCategory(branchId, input.categoryId, em);
      Object.assign(expense, input, { updatedBy: actor.userId });
      delete expense.category;
      delete expense.accountSheet;
      const saved = await expenses.save(expense, em);
      const category = await getCategory(branchId, saved.categoryId, em);
      await journalService.repost(
        em,
        actor,
        branchId,
        saved.journalEntryId,
        { date: saved.date, narration: `Expense: ${category.name}` },
        posting(saved),
      );
      const after = toExpenseDto(await getExpense(branchId, id, em));
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'expense', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const expense = await getExpense(branchId, id, em);
      await journalService.discard(em, actor, branchId, expense.journalEntryId);
      await expenses.softDelete(expense, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'expense', entityId: id, before: toExpenseDto(expense) },
        em,
      );
    });
  },

  async attachmentUrl(branchId: string, id: string) {
    const expense = await getExpense(branchId, id);
    if (!expense.attachmentPath) throw AppError.notFound('Attachment');
    return createSignedUrl(BUCKETS.stockFiles, expense.attachmentPath);
  },
};
