import { z } from 'zod';
import { allocatedBatchSchema } from '../inventory/product-batches.schemas';
import { registry } from '../../lib/openapi';
import { serialsInput } from '../inventory/inventory-items.schemas';
import { listQuerySchema } from '../../lib/pagination';
import {
  dateInput,
  moneyInput,
  moneyOutput,
  optionalText,
  positiveQuantityInput,
  quantityOutput,
} from '../../lib/validation';
import { PAYMENT_METHODS } from '../appointments/appointment-payment.entity';
import { RETURN_DISPOSITIONS } from './sale-return-item.entity';
import { RETURN_REASONS, RETURN_STATUSES } from './sale-return.entity';

const positiveMoney = moneyInput.refine((v) => Number(v) > 0, 'Must be greater than zero');

export const refundInputSchema = registry.register(
  'ReturnRefundInput',
  z.object({
    amount: positiveMoney,
    method: z.enum(PAYMENT_METHODS),
    accountSheetId: z.uuid().openapi({ description: 'The account the refund is paid from' }),
    date: dateInput.optional(),
  }),
);

export const createReturnSchema = registry.register(
  'CreateSaleReturn',
  z
    .object({
      saleId: z.uuid(),
      date: dateInput.optional(),
      reason: z.enum(RETURN_REASONS),
      note: optionalText(5000),
      items: z
        .array(
          z.object({ productId: z.uuid(), qty: positiveQuantityInput, serials: serialsInput.optional() }),
        )
        .min(1)
        .max(100),
      refund: refundInputSchema.optional(),
    })
    .refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
      message: 'Each product can appear once',
      path: ['items'],
    }),
);

export const resolveItemSchema = registry.register(
  'ResolveReturnItem',
  z.object({
    disposition: z.enum(
      RETURN_DISPOSITIONS.filter((d) => d !== 'pending') as [
        'quarantined',
        'restocked',
        'damaged',
        'expired',
        'supplier',
      ],
    ),
    note: optionalText(2000),
  }),
);

export const setRefundSchema = registry.register(
  'SetReturnRefund',
  z.object({ refund: z.union([refundInputSchema, z.null()]) }),
);

export const returnItemParamsSchema = z.object({ id: z.uuid(), itemId: z.uuid() });
export const saleParamsSchema = z.object({ saleId: z.uuid() });

export const returnListQuerySchema = listQuerySchema(['date', 'createdAt', 'returnSeq'], '-date').extend({
  status: z.enum(RETURN_STATUSES).optional(),
  reason: z.enum(RETURN_REASONS).optional(),
  disposition: z.enum(RETURN_DISPOSITIONS).optional(),
  productId: z.uuid().optional(),
  saleId: z.uuid().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

const ref = z.object({ id: z.uuid(), name: z.string() });

export const returnItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  product: ref.extend({ barcode: z.string().nullable() }).nullable(),
  qty: quantityOutput,
  disposition: z.enum(RETURN_DISPOSITIONS),
  resolvedAt: z.iso.datetime().nullable(),
  resolvedBy: z.uuid().nullable(),
  resolutionNote: z.string().nullable(),
  serial: z.string().nullable().optional().openapi({ description: 'The returned label (detail only)' }),
});

export const saleReturnSchema = registry.register(
  'SaleReturn',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    returnSeq: z.number().int(),
    returnNo: z.string(),
    saleId: z.uuid(),
    sale: z
      .object({
        id: z.uuid(),
        invoiceNo: z.string(),
        date: z.string(),
        saleType: z.string(),
        patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string() }).nullable(),
      })
      .nullable(),
    date: z.string(),
    reason: z.enum(RETURN_REASONS),
    note: z.string().nullable(),
    status: z.enum(RETURN_STATUSES),
    totalQty: quantityOutput,
    refundAmount: moneyOutput,
    refundMethod: z.enum(PAYMENT_METHODS).nullable(),
    refundAccountSheet: z.object({ id: z.uuid(), accountName: z.string() }).nullable(),
    refundDate: z.string().nullable(),
    items: z.array(returnItemSchema),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    soldBatches: z
      .array(allocatedBatchSchema)
      .optional()
      .openapi({ description: 'Batches the original sale took its stock from (detail only)' }),
    restockedBatches: z
      .array(allocatedBatchSchema)
      .optional()
      .openapi({ description: 'Batches restocked items went back to (detail only)' }),
  }),
);

export const returnableSchema = registry.register(
  'ReturnableSale',
  z.object({
    saleId: z.uuid(),
    invoiceNo: z.string(),
    received: moneyOutput,
    refunded: moneyOutput,
    items: z.array(
      z.object({
        productId: z.uuid(),
        product: ref.extend({ barcode: z.string().nullable() }).nullable(),
        sold: quantityOutput,
        returned: quantityOutput,
        returnable: quantityOutput,
        trackSerials: z.boolean(),
        serials: z.array(z.string()).openapi({ description: 'Labels sold on the sale and not returned yet' }),
      }),
    ),
  }),
);

export type CreateReturnInput = z.output<typeof createReturnSchema>;
export type RefundInput = z.output<typeof refundInputSchema>;
export type ResolveItemInput = z.output<typeof resolveItemSchema>;
export type ReturnListQuery = z.output<typeof returnListQuerySchema>;
