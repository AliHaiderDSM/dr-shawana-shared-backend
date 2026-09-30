import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toMoney, type DecimalInput } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { applyListQuery, escapeLike, pageMeta } from '../../lib/pagination';
import { accountSheetsRepository } from '../accounts/accounts.repository';
import { auditService } from '../audit/audit.service';
import { Branch } from '../branches/branch.entity';
import { nextSequence } from '../sequences/sequences';
import { JournalEntry, type JournalSource } from './journal-entry.entity';
import { JournalLine } from './journal-line.entity';
import {
  type CreateJournalEntryInput,
  type JournalLineInput,
  type JournalListQuery,
  type UpdateJournalEntryInput,
} from './journal.schemas';

const entries = branchScopedRepository(JournalEntry, 'je');
const lines = branchScopedRepository(JournalLine, 'jl');

export interface PostingLine {
  accountSheetId?: string | null;
  expenseCategoryId?: string | null;
  description?: string | null;
  debit: DecimalInput;
  credit: DecimalInput;
}

export function toJournalDto(entry: JournalEntry) {
  const live = (entry.lines ?? []).filter((l) => !l.deletedAt);
  return {
    id: entry.id,
    branchId: entry.branchId,
    entryNo: entry.entryNo,
    date: entry.date,
    narration: entry.narration,
    reference: entry.reference,
    source: entry.source,
    totalDebit: toMoney(live.reduce((s, l) => s.plus(l.debit), new Decimal(0))),
    totalCredit: toMoney(live.reduce((s, l) => s.plus(l.credit), new Decimal(0))),
    lines: live.map((l) => ({
      id: l.id,
      accountSheetId: l.accountSheetId,
      accountSheet: l.accountSheet
        ? {
            id: l.accountSheet.id,
            accountName: l.accountSheet.accountName,
            accountCode: l.accountSheet.accountCode,
          }
        : null,
      expenseCategoryId: l.expenseCategoryId,
      expenseCategory: l.expenseCategory ? { id: l.expenseCategory.id, name: l.expenseCategory.name } : null,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
    })),
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
  };
}

function detailed(branchId: string, manager?: EntityManager) {
  return entries
    .query(branchId, manager)
    .leftJoinAndSelect('je.lines', 'line', 'line.deletedAt IS NULL')
    .leftJoinAndSelect('line.accountSheet', 'sheet')
    .leftJoinAndSelect('line.expenseCategory', 'category');
}

async function getEntry(branchId: string, id: string, manager?: EntityManager) {
  const entry = await detailed(branchId, manager).andWhere('je.id = :id', { id }).getOne();
  if (!entry) throw AppError.notFound('Journal entry');
  return entry;
}

function assertBalanced(posting: PostingLine[]) {
  for (const [index, line] of posting.entries()) {
    const debit = new Decimal(line.debit);
    const credit = new Decimal(line.credit);
    if (debit.isZero() && credit.isZero()) {
      throw AppError.unprocessable(`Line ${index + 1} needs a debit or a credit amount`);
    }
  }
  const debit = posting.reduce((s, l) => s.plus(l.debit), new Decimal(0));
  const credit = posting.reduce((s, l) => s.plus(l.credit), new Decimal(0));
  if (!debit.equals(credit)) {
    throw AppError.unprocessable('Total debit must equal total credit', {
      debit: toMoney(debit).toFixed(2),
      credit: toMoney(credit).toFixed(2),
    });
  }
}

async function assertSheets(branchId: string, posting: PostingLine[], manager: EntityManager) {
  const ids = [...new Set(posting.map((l) => l.accountSheetId).filter((id): id is string => Boolean(id)))];
  const found = await accountSheetsRepository.findByIds(branchId, ids, manager);
  if (found.length !== ids.length) throw AppError.badRequest('An account sheet was not found in this branch');
}

async function insertLines(
  manager: EntityManager,
  actorId: string,
  branchId: string,
  journalEntryId: string,
  posting: PostingLine[],
) {
  for (const line of posting) {
    await lines.create(
      branchId,
      actorId,
      {
        journalEntryId,
        accountSheetId: line.accountSheetId ?? null,
        expenseCategoryId: line.expenseCategoryId ?? null,
        description: line.description ?? null,
        debit: toMoney(line.debit),
        credit: toMoney(line.credit),
      },
      manager,
    );
  }
}

const fromInput = (input: JournalLineInput[]): PostingLine[] => input.map((l) => ({ ...l }));

export const journalService = {
  async post(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    header: { date: string; narration: string; reference?: string | null; source: JournalSource },
    posting: PostingLine[],
  ) {
    assertBalanced(posting);
    await assertSheets(branchId, posting, manager);
    const branch = await repo(Branch, manager).findOneByOrFail({ id: branchId });
    const seq = await nextSequence(manager, branchId, 'journal');
    const entry = await entries.create(
      branchId,
      actor.userId,
      {
        entrySeq: seq,
        entryNo: `${branch.code}-JV-${String(seq).padStart(6, '0')}`,
        date: header.date,
        narration: header.narration,
        reference: header.reference ?? null,
        source: header.source,
      },
      manager,
    );
    await insertLines(manager, actor.userId, branchId, entry.id, posting);
    return entry;
  },

  async repost(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    id: string,
    header: Partial<{ date: string; narration: string; reference: string | null }>,
    posting?: PostingLine[],
  ) {
    const entry = await getEntry(branchId, id, manager);
    if (posting) {
      assertBalanced(posting);
      await assertSheets(branchId, posting, manager);
      for (const old of entry.lines ?? []) await lines.softDelete(old, actor.userId, manager);
      await insertLines(manager, actor.userId, branchId, id, posting);
    }
    Object.assign(entry, header, { updatedBy: actor.userId });
    delete entry.lines;
    await entries.save(entry, manager);
  },

  async discard(manager: EntityManager, actor: Actor, branchId: string, id: string) {
    const entry = await getEntry(branchId, id, manager);
    for (const line of entry.lines ?? []) await lines.softDelete(line, actor.userId, manager);
    await entries.softDelete(entry, actor.userId, manager);
  },

  async list(branchId: string, query: JournalListQuery) {
    const filter = <T extends ReturnType<typeof entries.query>>(qb: T) => {
      if (query.source) qb.andWhere('je.source = :source', { source: query.source });
      if (query.month) qb.andWhere(`to_char(je.date, 'YYYY-MM') = :month`, { month: query.month });
      if (query.from) qb.andWhere('je.date >= :from', { from: query.from });
      if (query.to) qb.andWhere('je.date <= :to', { to: query.to });
      if (query.accountSheetId) {
        qb.andWhere(
          'EXISTS (SELECT 1 FROM journal_lines x WHERE x.journal_entry_id = je.id AND x.account_sheet_id = :sheet AND x.deleted_at IS NULL)',
          { sheet: query.accountSheetId },
        );
      }
      if (query.search) {
        qb.andWhere('(je.narration ILIKE :term OR je.entryNo ILIKE :term)', {
          term: `%${escapeLike(query.search)}%`,
        });
      }
      return qb;
    };
    const totals = await filter(entries.query(branchId))
      .leftJoin('je.lines', 'line', 'line.deletedAt IS NULL')
      .select('COUNT(DISTINCT je.id)', 'count')
      .addSelect('COALESCE(SUM(line.debit), 0)', 'debit')
      .addSelect('COALESCE(SUM(line.credit), 0)', 'credit')
      .getRawOne<{ count: string; debit: string; credit: string }>();
    const ids = await applyListQuery(
      filter(entries.query(branchId)),
      { ...query, search: undefined },
      {
        sortMap: { date: 'je.date', createdAt: 'je.createdAt', entrySeq: 'je.entrySeq' },
      },
    ).getMany();
    const rows = ids.length
      ? await detailed(branchId)
          .andWhere('je.id IN (:...ids)', { ids: ids.map((i) => i.id) })
          .getMany()
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      items: ids.map((i) => toJournalDto(byId.get(i.id) as JournalEntry)),
      meta: {
        ...pageMeta(query, Number(totals?.count ?? 0)),
        totals: { debit: toMoney(totals?.debit ?? 0), credit: toMoney(totals?.credit ?? 0) },
      },
    };
  },

  async get(branchId: string, id: string) {
    return toJournalDto(await getEntry(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateJournalEntryInput) {
    return withTransaction(async (em) => {
      const entry = await this.post(
        em,
        actor,
        branchId,
        { ...input, source: 'manual' },
        fromInput(input.lines),
      );
      const dto = toJournalDto(await getEntry(branchId, entry.id, em));
      await auditService.record(
        { actor, branchId, action: 'create', entity: 'journal_entry', entityId: entry.id, after: dto },
        em,
      );
      return dto;
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateJournalEntryInput) {
    return withTransaction(async (em) => {
      const entry = await getEntry(branchId, id, em);
      if (entry.source !== 'manual') throw AppError.conflict('Edit this entry through its expense');
      const before = toJournalDto(entry);
      const { lines: newLines, ...header } = input;
      await this.repost(em, actor, branchId, id, header, newLines ? fromInput(newLines) : undefined);
      const after = toJournalDto(await getEntry(branchId, id, em));
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'journal_entry', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const entry = await getEntry(branchId, id, em);
      if (entry.source !== 'manual') throw AppError.conflict('Remove this entry through its expense');
      await this.discard(em, actor, branchId, id);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'journal_entry',
          entityId: id,
          before: toJournalDto(entry),
        },
        em,
      );
    });
  },
};
