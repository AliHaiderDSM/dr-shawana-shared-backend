import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { listQuerySchema } from '../../lib/pagination';
import { dateInput, optionalText, positiveQuantityInput, quantityOutput } from '../../lib/validation';
import { serialsInput } from '../inventory/inventory-items.schemas';
import { REPLACEMENT_STATUSES } from './sale-replacement.entity';

export const createReplacementSchema = registry.register(
  'CreateSaleReplacement',
  z
    .object({
      date: dateInput.optional(),
      note: optionalText(2000),
      items: z
        .array(z.object({ productId: z.uuid(), qty: positiveQuantityInput }))
        .min(1)
        .max(100),
      serials: serialsInput.optional().openapi({
        description:
          'Office sale: labels of the new pieces handed over now. Online sale: leave out, the Dispatch Department scans them when it sends the replacement.',
      }),
    })
    .refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
      message: 'Each product can appear once',
      path: ['items'],
    }),
);

export const sendReplacementSchema = registry.register(
  'SendSaleReplacement',
  z.object({
    date: dateInput.optional(),
    serials: serialsInput.optional().openapi({ description: 'Labels of the pieces sent' }),
  }),
);

export const replacementListQuerySchema = listQuerySchema(
  ['date', 'createdAt', 'replacementSeq'],
  '-date',
).extend({
  status: z.enum(REPLACEMENT_STATUSES).optional(),
  saleId: z.uuid().optional(),
  saleReturnId: z.uuid().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

export const returnParamsSchema = z.object({ id: z.uuid() });

const ref = z.object({ id: z.uuid(), name: z.string() });

export const saleReplacementSchema = registry.register(
  'SaleReplacement',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    replacementSeq: z.number().int(),
    replacementNo: z.string().openapi({ description: 'e.g. LHR-REP-000001' }),
    saleReturnId: z.uuid(),
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
    note: z.string().nullable(),
    status: z.enum(REPLACEMENT_STATUSES).openapi({
      description:
        'pending: online, waiting for the Dispatch Department; sent: the new pieces left the stock',
    }),
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
    serials: z.array(z.string()).optional().openapi({ description: 'Labels sent (detail only)' }),
    totalQty: quantityOutput,
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateReplacementInput = z.output<typeof createReplacementSchema>;
export type SendReplacementInput = z.output<typeof sendReplacementSchema>;
export type ReplacementListQuery = z.output<typeof replacementListQuerySchema>;
