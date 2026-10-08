import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { registerCrudDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, dateInput, optionalText, requiredText } from '../../lib/validation';
import { ACCOUNT_TYPES } from './account-sheet.entity';

export const createAccountSheetSchema = registry.register(
  'CreateAccountSheet',
  z
    .object({
      accountName: requiredText(1, 150),
      accountCode: requiredText(1, 100),
      type: z.enum(ACCOUNT_TYPES),
      bankName: optionalText(150).openapi({
        description: 'Bank of a bank account. A new name adds the bank to this branch.',
      }),
      date: dateInput.optional(),
    })
    .refine((v) => v.type === 'cash' || Boolean(v.bankName), {
      path: ['bankName'],
      message: 'A bank account needs a bank',
    }),
);

export const updateAccountSheetSchema = registry.register(
  'UpdateAccountSheet',
  atLeastOneField(
    z.object({
      accountName: requiredText(1, 150),
      accountCode: requiredText(1, 100),
      type: z.enum(ACCOUNT_TYPES),
      bankName: optionalText(150),
      date: dateInput,
    }),
  ),
);

export const accountSheetListQuerySchema = listQuerySchema(
  ['accountName', 'accountCode', 'date', 'createdAt'],
  'accountName',
).extend({
  type: z.enum(ACCOUNT_TYPES).optional(),
  bankId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});

export const accountSheetSchema = registry.register(
  'AccountSheet',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    accountName: z.string(),
    accountCode: z.string(),
    type: z.enum(ACCOUNT_TYPES),
    bankId: z.uuid().nullable(),
    bank: z.object({ id: z.uuid(), name: z.string() }).nullable().optional(),
    date: z.iso.date(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateAccountSheetInput = z.output<typeof createAccountSheetSchema>;
export type UpdateAccountSheetInput = z.output<typeof updateAccountSheetSchema>;
export type AccountSheetListQuery = z.output<typeof accountSheetListQuerySchema>;

registerCrudDocs({
  path: '/branch/account-sheets',
  tag: 'Account sheets',
  noun: 'account sheet',
  entity: accountSheetSchema,
  create: createAccountSheetSchema,
  update: updateAccountSheetSchema,
  listQuery: accountSheetListQuerySchema,
  options: z.object({
    id: z.uuid(),
    accountName: z.string(),
    accountCode: z.string(),
    type: z.enum(ACCOUNT_TYPES),
    bankName: z.string().nullable(),
  }),
});
