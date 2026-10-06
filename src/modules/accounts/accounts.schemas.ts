import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { registerCrudDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, dateInput, optionalUuid, requiredText } from '../../lib/validation';
import { ACCOUNT_TYPES } from './account-sheet.entity';

const bankFields = z.object({ name: requiredText(1, 150) });

export const createBankSchema = registry.register('CreateBank', bankFields);
export const updateBankSchema = registry.register('UpdateBank', atLeastOneField(bankFields));
export const bankListQuerySchema = listQuerySchema(['name', 'createdAt'], 'name').extend({
  branchId: z.uuid().optional(),
});

export const bankSchema = registry.register(
  'Bank',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const createAccountSheetSchema = registry.register(
  'CreateAccountSheet',
  z
    .object({
      accountName: requiredText(1, 150),
      accountCode: requiredText(1, 100),
      type: z.enum(ACCOUNT_TYPES),
      bankId: optionalUuid,
      date: dateInput.optional(),
    })
    .refine((v) => v.type === 'cash' || Boolean(v.bankId), {
      path: ['bankId'],
      message: 'A bank account needs a bank',
    }),
);

export const updateAccountSheetSchema = registry.register(
  'UpdateAccountSheet',
  atLeastOneField(
    z.object({
      accountName: requiredText(1, 150),
      accountCode: requiredText(1, 100),
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

export type CreateBankInput = z.output<typeof createBankSchema>;
export type UpdateBankInput = z.output<typeof updateBankSchema>;
export type CreateAccountSheetInput = z.output<typeof createAccountSheetSchema>;
export type UpdateAccountSheetInput = z.output<typeof updateAccountSheetSchema>;
export type AccountSheetListQuery = z.output<typeof accountSheetListQuerySchema>;

registerCrudDocs({
  path: '/branch/banks',
  tag: 'Banks',
  noun: 'bank',
  entity: bankSchema,
  create: createBankSchema,
  update: updateBankSchema,
  listQuery: bankListQuerySchema,
  remove: 'Remove a bank that no account sheet uses',
});

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
