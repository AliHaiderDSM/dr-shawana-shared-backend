import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { listQuerySchema } from '../../lib/pagination';
import { dateInput, optionalText, positiveQuantityInput, quantityOutput } from '../../lib/validation';
import { serialsInput } from '../inventory/inventory-items.schemas';
import { REPLACEMENT_STATUSES } from './sale-replacement.entity';
import { RETURN_REASONS } from './sale-return.entity';

export const DIRECT_REPLACEMENT_REASONS = ['damaged', 'wrong_item', 'other'] as const;

const itemsInput = z
  .array(z.object({ productId: z.uuid(), qty: positiveQuantityInput }))
  .min(1)
  .max(100)
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
    message: 'Each product can appear once',
  });

export const createReplacementSchema = registry.register(
  'CreateSaleReplacement',
  z.object({
    date: dateInput.optional(),
    note: optionalText(2000),
    items: itemsInput,
  }),
);

export const createDirectReplacementSchema = registry.register(
  'CreateDirectSaleReplacement',
  z.object({
    date: dateInput.optional(),
    reason: z.enum(DIRECT_REPLACEMENT_REASONS),
    note: optionalText(2000),
    items: itemsInput,
  }),
);

export const decideReplacementSchema = registry.register(
  'DecideSaleReplacement',
  z.object({ note: optionalText(1000) }),
);

export const sendReplacementSchema = registry.register(
  'SendSaleReplacement',
  z.object({
    date: dateInput.optional(),
    serials: serialsInput.optional().openapi({ description: 'Labels of the pieces sent' }),
  }),
);

export const replacementListQuerySchema = listQuerySchema(
  ['date', 'createdAt', 'replacementNo'],
  '-createdAt',
).extend({
  status: z.enum(REPLACEMENT_STATUSES).optional(),
  kind: z.enum(['with_return', 'without_return']).optional(),
  saleId: z.uuid().optional(),
  saleReturnId: z.uuid().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

export const replacementFileParamsSchema = z.object({ id: z.uuid(), fileId: z.uuid() });

const ref = z.object({ id: z.uuid(), name: z.string() });

export const saleReplacementSchema = registry.register(
  'SaleReplacement',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    replacementSeq: z.number().int().openapi({ description: 'Number of the replacement on its sale' }),
    replacementNo: z
      .string()
      .openapi({ description: 'Sale invoice number and the replacement number, e.g. LHR-000123.1' }),
    saleReturnId: z.uuid().nullable().openapi({ description: 'null: a replacement without a return' }),
    returnNo: z.string().nullable(),
    saleId: z.uuid(),
    sale: z
      .object({
        id: z.uuid(),
        invoiceNo: z.string(),
        date: z.string(),
        saleType: z.string(),
        fulfillmentBranchId: z.uuid().nullable(),
        patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string() }).nullable(),
      })
      .nullable(),
    date: z.string(),
    reason: z.enum(RETURN_REASONS),
    note: z.string().nullable(),
    status: z.enum(REPLACEMENT_STATUSES).openapi({
      description:
        'pending_approval: waiting for the Super Admin; approved: waiting to be sent; rejected: refused by the Super Admin; sent: the new pieces left the stock',
    }),
    decidedBy: z.uuid().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    decisionNote: z.string().nullable(),
    sentOn: z.string().nullable(),
    sentBy: z.uuid().nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        productId: z.uuid(),
        product: ref.extend({ barcode: z.string().nullable() }).nullable(),
        qty: quantityOutput,
      }),
    ),
    files: z.array(
      z.object({
        id: z.uuid(),
        originalName: z.string(),
        contentType: z.string(),
        sizeBytes: z.number().int(),
      }),
    ),
    serials: z.array(z.string()).optional().openapi({ description: 'Labels sent (detail only)' }),
    totalQty: quantityOutput,
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const replaceableSchema = registry.register(
  'SaleReplaceable',
  z.object({
    saleId: z.uuid(),
    invoiceNo: z.string(),
    items: z.array(
      z.object({
        productId: z.uuid(),
        name: z.string(),
        barcode: z.string().nullable(),
        sold: quantityOutput,
        returned: quantityOutput,
        replaced: quantityOutput.openapi({ description: 'Already replaced without a return, still active' }),
        replaceable: quantityOutput,
      }),
    ),
  }),
);

export type CreateReplacementInput = z.output<typeof createReplacementSchema>;
export type CreateDirectReplacementInput = z.output<typeof createDirectReplacementSchema>;
export type SendReplacementInput = z.output<typeof sendReplacementSchema>;
export type ReplacementListQuery = z.output<typeof replacementListQuerySchema>;
