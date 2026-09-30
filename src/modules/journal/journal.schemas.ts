import { z } from 'zod';
import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageMetaSchema,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import {
  atLeastOneField,
  dateInput,
  moneyInput,
  moneyOutput,
  optionalText,
  requiredText,
} from '../../lib/validation';
import { JOURNAL_SOURCES } from './journal-entry.entity';

export const monthInput = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
  .openapi({ example: '2026-09' });

const lineInput = z.object({
  accountSheetId: z.uuid(),
  description: optionalText(1000),
  debit: moneyInput.default('0'),
  credit: moneyInput.default('0'),
});

const journalFields = {
  date: dateInput,
  narration: requiredText(1, 2000),
  reference: optionalText(150),
  lines: z.array(lineInput).min(2).max(50),
};

export const createJournalEntrySchema = registry.register('CreateJournalEntry', z.object(journalFields));
export const updateJournalEntrySchema = registry.register(
  'UpdateJournalEntry',
  atLeastOneField(
    z.object({
      date: dateInput,
      narration: requiredText(1, 2000),
      reference: z.string().trim().max(150).nullable(),
      lines: z.array(lineInput).min(2).max(50),
    }),
  ),
);

export const journalListQuerySchema = listQuerySchema(['date', 'createdAt', 'entrySeq'], '-entrySeq').extend({
  accountSheetId: z.uuid().optional(),
  source: z.enum(JOURNAL_SOURCES).optional(),
  month: monthInput.optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

export type JournalLineInput = z.output<typeof lineInput>;
export type CreateJournalEntryInput = z.output<typeof createJournalEntrySchema>;
export type UpdateJournalEntryInput = z.output<typeof updateJournalEntrySchema>;
export type JournalListQuery = z.output<typeof journalListQuerySchema>;

const lineSchema = z.object({
  id: z.uuid(),
  accountSheetId: z.uuid().nullable(),
  accountSheet: z.object({ id: z.uuid(), accountName: z.string(), accountCode: z.string() }).nullable(),
  expenseCategoryId: z.uuid().nullable(),
  expenseCategory: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  description: z.string().nullable(),
  debit: moneyOutput,
  credit: moneyOutput,
});

export const journalEntrySchema = registry.register(
  'JournalEntry',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    entryNo: z.string().openapi({ example: 'LHR-JV-000001' }),
    date: z.iso.date(),
    narration: z.string(),
    reference: z.string().nullable(),
    source: z.enum(JOURNAL_SOURCES),
    totalDebit: moneyOutput,
    totalCredit: moneyOutput,
    lines: z.array(lineSchema),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

const docs = securedDocs('Journal (general entries)');
const byId = { params: idParamsSchema, query: branchQuerySchema };
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(journalEntrySchema)) });

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/journal-entries',
  summary: 'List journal entries (posSoft General Entries); meta.totals has the debit and credit sums',
  request: { query: journalListQuerySchema },
  responses: {
    200: {
      description: 'Page',
      ...jsonContent(
        z.object({
          data: z.array(journalEntrySchema),
          meta: pageMetaSchema.extend({ totals: z.object({ debit: moneyOutput, credit: moneyOutput }) }),
        }),
      ),
    },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/journal-entries',
  summary: 'Post a journal entry; total debit must equal total credit (422 otherwise)',
  request: { query: branchQuerySchema, body: jsonContent(createJournalEntrySchema) },
  responses: { 201: one('Created'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/journal-entries/{id}',
  summary: 'Get a journal entry',
  request: byId,
  responses: { 200: one('Entry'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'patch',
  path: '/branch/journal-entries/{id}',
  summary:
    'Edit a manual journal entry ("lines" replaces all lines). Expense entries are edited through the expense.',
  request: { ...byId, body: jsonContent(updateJournalEntrySchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'delete',
  path: '/branch/journal-entries/{id}',
  summary: 'Remove a manual journal entry',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
