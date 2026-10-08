import { z } from 'zod';
import { listQuerySchema } from '../../lib/pagination';
import {
  atLeastOneField,
  dateInput,
  moneyInput,
  moneyOutput,
  optionalText,
  positiveQuantityInput,
  quantityOutput,
} from '../../lib/validation';
import { registry } from '../../lib/openapi';
import { PAYMENT_METHODS } from '../appointments/appointment-payment.entity';
import { patientFields } from '../patients/patients.schemas';
import { ITEM_STATUSES } from '../inventory/inventory-item.entity';
import { serialsInput } from '../inventory/inventory-items.schemas';
import { allocatedBatchSchema } from '../inventory/product-batches.schemas';
import { refundInputSchema } from '../returns/returns.schemas';
import { DELIVERY_STATUSES, PAYMENT_STATUSES, SALE_TYPES } from './sale.entity';

const positiveMoney = moneyInput.refine((v) => Number(v) > 0, 'Must be greater than zero');
const percentInput = z
  .union([z.number(), z.string().trim()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, 'Use a percentage from 0 to 100')
  .openapi({ type: 'string', example: '10' });

export const saleItemInputSchema = z
  .object({
    productId: z.uuid().optional(),
    bundleId: z.uuid().optional(),
    qty: positiveQuantityInput,
    discountPercent: percentInput
      .optional()
      .openapi({ description: 'Discount on this line only, before the sale discount' }),
  })
  .refine((v) => (v.productId ? 1 : 0) + (v.bundleId ? 1 : 0) === 1, {
    message: 'Give either productId or bundleId',
    path: ['productId'],
  });

export const salePaymentInputSchema = registry.register(
  'SalePaymentInput',
  z.object({
    method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney,
    date: dateInput.optional(),
    accountSheetId: z.uuid(),
    senderBank: optionalText(150),
    senderAccountTitle: optionalText(150),
    senderAccountNo: optionalText(100),
    proofIndex: z.number().int().min(0).max(9).optional(),
    proofIndexes: z
      .array(z.number().int().min(0).max(9))
      .max(5)
      .optional()
      .openapi({ description: 'Positions in "paymentProofs" of the screenshots for this payment' }),
  }),
);

const discountFields = {
  autoDiscount: z.boolean().optional().openapi({
    description: 'posSoft "Auto": any unpaid part becomes the discount (the percent is then fixed)',
  }),
  discountPercent: percentInput.optional(),
};

export const createSaleSchema = registry.register(
  'CreateSale',
  z
    .object({
      patientId: z.uuid().optional(),
      patient: patientFields.optional(),
      date: dateInput.optional(),
      saleType: z.enum(SALE_TYPES),
      city: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .openapi({ description: 'Defaults to the branch city' }),
      note: optionalText(2000),
      items: z.array(saleItemInputSchema).min(1).max(100),
      serials: serialsInput.optional(),
      payments: z
        .array(salePaymentInputSchema)
        .min(1, 'Add the payment. A sale is saved only with its payment.')
        .max(10),
      ...discountFields,
    })
    .refine((v) => (v.patientId ? 1 : 0) + (v.patient ? 1 : 0) === 1, {
      message: 'Provide either patientId or patient',
      path: ['patientId'],
    })
    .refine((v) => !(v.autoDiscount && v.discountPercent !== undefined), {
      message: 'Use either autoDiscount or discountPercent',
      path: ['discountPercent'],
    }),
);

export const updateSaleSchema = registry.register(
  'UpdateSale',
  atLeastOneField(
    z.object({
      patientId: z.uuid(),
      date: dateInput,
      saleType: z.enum(SALE_TYPES),
      city: z.string().trim().min(1).max(100),
      note: z.string().trim().max(2000).nullable(),
      items: z.array(saleItemInputSchema).min(1).max(100),
      serials: serialsInput.openapi({
        description: 'Every label on the sale after the edit. Leave out to keep the labels already sold.',
      }),
      discountPercent: percentInput,
    }),
  ),
);

export const deliveryStatusSchema = registry.register(
  'SaleDeliveryStatus',
  z.object({ status: z.enum(['delivered', 'returned']) }),
);

export const dispatchSchema = registry.register(
  'DispatchOrder',
  z.object({
    date: dateInput
      .optional()
      .openapi({ description: 'Dispatch date; stock leaves on this date. Defaults to today.' }),
    serials: serialsInput
      .optional()
      .openapi({ description: 'DSM labels of every labelled piece in the parcel' }),
  }),
);

export const cancelOrderSchema = registry.register(
  'CancelOrder',
  z.object({ refund: z.union([refundInputSchema, z.null()]).optional() }),
);

export const deliveryCalendarQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .openapi({ example: '2026-10' }),
  branchId: z.uuid().optional(),
});

export const deliveriesQuerySchema = z.object({
  date: dateInput.optional(),
  by: z.enum(['order', 'dispatch']).default('order'),
  status: z.enum(DELIVERY_STATUSES).optional(),
  branchId: z.uuid().optional(),
});

export const createSalePaymentSchema = salePaymentInputSchema.omit({ proofIndex: true, proofIndexes: true });
export const updateSalePaymentSchema = registry.register(
  'UpdateSalePayment',
  atLeastOneField(
    z.object({
      method: z.enum(PAYMENT_METHODS),
      amount: positiveMoney,
      date: dateInput,
      accountSheetId: z.uuid(),
      senderBank: z.string().trim().max(150).nullable(),
      senderAccountTitle: z.string().trim().max(150).nullable(),
      senderAccountNo: z.string().trim().max(100).nullable(),
    }),
  ),
);

export const saleListQuerySchema = listQuerySchema(['date', 'createdAt', 'invoiceSeq'], '-invoiceSeq').extend(
  {
    patientId: z.uuid().optional(),
    productId: z.uuid().optional(),
    createdBy: z.uuid().optional(),
    saleType: z.enum(SALE_TYPES).optional(),
    city: z.string().trim().max(100).optional(),
    deliveryStatus: z.enum(DELIVERY_STATUSES).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    completed: z.enum(['true']).optional().openapi({
      description:
        'Only fully paid and approved sales that are handed over: office sales, or online orders dispatched or delivered',
    }),
    due: z
      .enum(['true'])
      .optional()
      .openapi({ description: 'Only sales with money still to receive (unpaid or partly paid)' }),
    method: z.enum(PAYMENT_METHODS).optional(),
    accountSheetId: z.uuid().optional(),
    from: dateInput.optional(),
    to: dateInput.optional(),
    branchId: z.uuid().optional(),
  },
);

export const deliverySlipsQuerySchema = z.object({
  patientId: z.uuid().optional(),
  saleType: z.enum(SALE_TYPES).optional(),
  from: dateInput.optional().openapi({ description: 'Defaults to today, as posSoft' }),
  to: dateInput.optional(),
  invoiceFrom: z.coerce.number().int().positive().optional(),
  invoiceTo: z.coerce.number().int().positive().optional(),
  dateBy: z.enum(['booked', 'dispatched']).optional().openapi({
    description:
      'booked (default): from/to is the sale date. dispatched: from/to is the dispatch date of online orders',
  }),
  branchId: z.uuid().optional(),
});

export const salePaymentParamsSchema = z.object({ id: z.uuid(), paymentId: z.uuid() });
export const salePaymentProofParamsSchema = salePaymentParamsSchema.extend({ proofId: z.uuid() });

export const approvePaymentsSchema = registry.register(
  'ApproveSalePayments',
  z.object({
    paymentIds: z
      .array(z.uuid())
      .max(10)
      .optional()
      .openapi({ description: 'Leave out to approve every payment of the sale that is waiting' }),
  }),
);

export type SaleItemInput = z.output<typeof saleItemInputSchema>;
export type SalePaymentInput = z.output<typeof salePaymentInputSchema>;
export type CreateSaleInput = z.output<typeof createSaleSchema>;
export type UpdateSaleInput = z.output<typeof updateSaleSchema>;
export type UpdateSalePaymentInput = z.output<typeof updateSalePaymentSchema>;
export type SaleListQuery = z.output<typeof saleListQuerySchema>;
export type DeliverySlipsQuery = z.output<typeof deliverySlipsQuerySchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

export const salePaymentSchema = registry.register(
  'SalePayment',
  z.object({
    id: z.uuid(),
    saleId: z.uuid(),
    method: z.enum(PAYMENT_METHODS),
    amount: moneyOutput,
    date: z.iso.date(),
    accountSheetId: z.uuid(),
    accountSheet: z.object({ id: z.uuid(), accountName: z.string(), accountCode: z.string() }).nullable(),
    senderBank: z.string().nullable(),
    senderAccountTitle: z.string().nullable(),
    senderAccountNo: z.string().nullable(),
    approvedAt: z.iso
      .datetime()
      .nullable()
      .openapi({ description: 'Null while the payment waits for approval' }),
    approvedBy: z.uuid().nullable(),
    hasProof: z.boolean(),
    proofOriginalName: z.string().nullable(),
    proofs: z.array(z.object({ id: z.uuid(), originalName: z.string(), contentType: z.string() })),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

export const saleSchema = registry.register(
  'Sale',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    invoiceNo: z.string().openapi({ example: 'LHR-000123' }),
    invoiceSeq: z.number().int(),
    patientId: z.uuid(),
    patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string() }).nullable(),
    patientCity: z.string().nullable(),
    saleType: z.enum(SALE_TYPES),
    city: z.string(),
    date: z.iso.date(),
    totalQty: quantityOutput,
    subtotal: moneyOutput,
    discountPercent: z.string(),
    discountAmount: moneyOutput,
    total: moneyOutput,
    received: moneyOutput,
    remaining: moneyOutput,
    paymentStatus: z.enum(PAYMENT_STATUSES),
    deliveryStatus: z.enum(DELIVERY_STATUSES).nullable(),
    dispatchedOn: z.iso.date().nullable(),
    deliveredOn: z.iso.date().nullable(),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)),
    note: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        productId: z.uuid(),
        product: ref.nullable(),
        bundleId: z.uuid().nullable(),
        bundle: ref.nullable(),
        qty: quantityOutput,
        unitPrice: moneyOutput,
        discountPercent: z.string(),
        discountAmount: moneyOutput,
        lineTotal: moneyOutput,
      }),
    ),
    payments: z.array(salePaymentSchema),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    branch: z
      .object({ id: z.uuid(), code: z.string(), name: z.string() })
      .nullable()
      .optional()
      .openapi({ description: 'The selling branch (list only)' }),
    serials: z
      .array(z.object({ serial: z.string(), productId: z.uuid(), status: z.enum(ITEM_STATUSES) }))
      .optional()
      .openapi({ description: 'Labelled pieces sold on this sale (detail only)' }),
    batches: z.array(allocatedBatchSchema).optional().openapi({
      description: 'Batches the sold stock was taken from (FEFO). Only on GET /branch/sales/{id}.',
    }),
  }),
);

export type DispatchInput = z.output<typeof dispatchSchema>;
export type CancelOrderInput = z.output<typeof cancelOrderSchema>;
export type DeliveriesQuery = z.output<typeof deliveriesQuerySchema>;
