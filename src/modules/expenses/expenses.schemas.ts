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
import { registerCrudDocs, securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import {
  atLeastOneField,
  dateInput,
  moneyInput,
  moneyOutput,
  optionalText,
  requiredText,
} from '../../lib/validation';
import { monthInput } from '../journal/journal.schemas';

const categoryFields = z.object({ name: requiredText(1, 150) });
export const createExpenseCategorySchema = registry.register('CreateExpenseCategory', categoryFields);
export const updateExpenseCategorySchema = registry.register(
  'UpdateExpenseCategory',
  atLeastOneField(categoryFields),
);
export const expenseCategoryListQuerySchema = listQuerySchema(['name', 'createdAt'], 'name').extend({
  branchId: z.uuid().optional(),
});

const positiveMoney = moneyInput.refine((v) => Number(v) > 0, 'Must be greater than zero');

export const createExpenseSchema = registry.register(
  'CreateExpense',
  z.object({
    date: dateInput,
    categoryId: z.uuid(),
    amount: positiveMoney,
    accountSheetId: z.uuid().openapi({ description: 'The account the money was paid from' }),
    note: optionalText(2000),
  }),
);

export const updateExpenseSchema = registry.register(
  'UpdateExpense',
  atLeastOneField(
    z.object({
      date: dateInput,
      categoryId: z.uuid(),
      amount: positiveMoney,
      accountSheetId: z.uuid(),
      note: z.string().trim().max(2000).nullable(),
    }),
  ),
);

export const expenseListQuerySchema = listQuerySchema(['date', 'createdAt', 'amount'], '-date').extend({
  categoryId: z.uuid().optional(),
  accountSheetId: z.uuid().optional(),
  month: monthInput.optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

export type CreateExpenseCategoryInput = z.output<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryInput = z.output<typeof updateExpenseCategorySchema>;
export type CreateExpenseInput = z.output<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.output<typeof updateExpenseSchema>;
export type ExpenseListQuery = z.output<typeof expenseListQuerySchema>;

export const expenseCategorySchema = registry.register(
  'ExpenseCategory',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const expenseSchema = registry.register(
  'Expense',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    date: z.iso.date(),
    categoryId: z.uuid(),
    category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    amount: moneyOutput,
    accountSheetId: z.uuid(),
    accountSheet: z.object({ id: z.uuid(), accountName: z.string(), accountCode: z.string() }).nullable(),
    note: z.string().nullable(),
    journalEntryId: z.uuid(),
    hasAttachment: z.boolean(),
    attachmentName: z.string().nullable(),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

registerCrudDocs({
  path: '/branch/expense-categories',
  tag: 'Expenses',
  noun: 'expense category',
  entity: expenseCategorySchema,
  create: createExpenseCategorySchema,
  update: updateExpenseCategorySchema,
  listQuery: expenseCategoryListQuerySchema,
});

const docs = securedDocs('Expenses');
const byId = { params: idParamsSchema, query: branchQuerySchema };
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(expenseSchema)) });
const binary = z.string().openapi({ format: 'binary' });

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/expenses',
  summary: 'List expenses; meta.totalAmount covers every matching expense',
  request: { query: expenseListQuerySchema },
  responses: {
    200: {
      description: 'Page',
      ...jsonContent(
        z.object({ data: z.array(expenseSchema), meta: pageMetaSchema.extend({ totalAmount: moneyOutput }) }),
      ),
    },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/expenses',
  summary:
    'Record an expense; it is posted to the journal (debit the expense category, credit the paying account). JSON, or multipart with "data" plus one "attachment".',
  request: {
    query: branchQuerySchema,
    body: {
      content: {
        'application/json': { schema: createExpenseSchema },
        'multipart/form-data': { schema: z.object({ data: z.string(), attachment: binary.optional() }) },
      },
    },
  },
  responses: { 201: one('Created'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/expenses/{id}',
  summary: 'Get an expense',
  request: byId,
  responses: { 200: one('Expense'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'patch',
  path: '/branch/expenses/{id}',
  summary: 'Edit an expense; its journal entry is updated with it',
  request: { ...byId, body: jsonContent(updateExpenseSchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'delete',
  path: '/branch/expenses/{id}',
  summary: 'Remove an expense and its journal entry',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/expenses/{id}/attachment-url',
  summary: 'Download link for the expense attachment',
  request: byId,
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});
