import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, jsonContent, pageEnvelope } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { serialsInput } from './inventory-items.schemas';
import { securedDocs } from '../../lib/openapi-crud';
import { MAX_PAGE_SIZE } from '../../lib/pagination';
import { dateInput, moneyOutput, optionalText, quantityInput, quantityOutput } from '../../lib/validation';

export const BATCH_STATUSES = ['ok', 'expiring', 'expired', 'no_expiry'] as const;
export const WRITE_OFF_REASONS = ['expired', 'damaged', 'lost', 'adjustment'] as const;

export const batchListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  search: z.string().trim().max(100).optional(),
  productId: z.uuid().optional(),
  status: z
    .enum(['active', 'expiring', 'expired'])
    .optional()
    .openapi({ description: 'active: not expired; expiring: expires within 90 days; expired: past expiry' }),
  inStockOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  branchId: z.uuid().optional(),
});

export const batchParamsSchema = z.object({ batchId: z.uuid() });

export const writeOffSchema = registry.register(
  'WriteOff',
  z.object({
    qty: quantityInput.refine((v) => Number(v) > 0, 'Quantity must be more than zero'),
    reason: z.enum(WRITE_OFF_REASONS),
    date: dateInput.optional(),
    note: optionalText(500),
    serials: serialsInput.optional(),
  }),
);

export const writeOffListQuerySchema = z.object({
  reason: z.enum(WRITE_OFF_REASONS).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  search: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
});

export const writeOffRecordSchema = registry.register(
  'WriteOffRecord',
  z.object({
    id: z.uuid(),
    writeOffNo: z.string(),
    date: z.iso.date(),
    reason: z.enum(WRITE_OFF_REASONS),
    note: z.string().nullable(),
    qty: z.string(),
    productId: z.uuid(),
    productName: z.string(),
    unit: z.string(),
    batchId: z.uuid().nullable(),
    batchNo: z.string().nullable(),
    expiryDate: z.iso.date().nullable(),
    branch: z.object({ id: z.uuid(), name: z.string(), code: z.string(), kind: z.string() }),
    createdBy: z.object({ id: z.uuid(), name: z.string(), role: z.string() }).nullable(),
    serials: z.array(z.string()),
    createdAt: z.iso.datetime(),
  }),
);

export type WriteOffListQuery = z.output<typeof writeOffListQuerySchema>;

const batchSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  unit: z.string(),
  batchNo: z.string(),
  manufacturingDate: z.iso.date().nullable(),
  expiryDate: z.iso.date().nullable(),
  supplierId: z.uuid().nullable(),
  supplierName: z.string().nullable(),
  unitCost: moneyOutput.nullable(),
  received: quantityOutput,
  quantity: quantityOutput,
  status: z.enum(BATCH_STATUSES),
  createdAt: z.iso.datetime(),
});

export const productBatchSchema = registry.register('ProductBatch', batchSchema);

export const productBatchDetailSchema = registry.register(
  'ProductBatchDetail',
  batchSchema.extend({
    movements: z.array(
      z.object({
        id: z.uuid(),
        date: z.iso.date(),
        type: z.string(),
        qty: quantityOutput,
        referenceType: z.string(),
        referenceId: z.uuid(),
        reference: z.string().nullable(),
        note: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
);

export const allocatedBatchSchema = registry.register(
  'AllocatedBatch',
  z.object({
    productId: z.uuid(),
    batchId: z.uuid().nullable(),
    batchNo: z.string().nullable(),
    manufacturingDate: z.iso.date().nullable(),
    expiryDate: z.iso.date().nullable(),
    qty: quantityOutput,
  }),
);

export type BatchListQuery = z.output<typeof batchListQuerySchema>;
export type WriteOffInput = z.output<typeof writeOffSchema>;

const common = securedDocs('Inventory');

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/batches',
  summary: 'Product batches with stock on hand and expiry status, earliest expiry first',
  request: { query: batchListQuerySchema },
  responses: {
    200: { description: 'Batches', ...jsonContent(pageEnvelope(productBatchSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/batches/{batchId}',
  summary: 'One batch with every stock movement that touched it',
  request: { params: batchParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Batch', ...jsonContent(dataEnvelope(productBatchDetailSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/inventory/batches/{batchId}/write-off',
  summary: 'Remove expired, damaged or lost stock of one batch (adjustment movement, audited)',
  request: {
    params: batchParamsSchema,
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: writeOffSchema } } },
  },
  responses: {
    200: { description: 'Batch after the write-off', ...jsonContent(dataEnvelope(productBatchDetailSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/write-offs',
  summary:
    'Stock written off as expired, damaged or lost, with its number, batch, labels and who did it. The Super Admin sees every branch without ?branchId=.',
  request: { query: writeOffListQuerySchema },
  responses: {
    200: { description: 'Write-offs', ...jsonContent(dataEnvelope(z.array(writeOffRecordSchema))) },
    ...errorResponses,
  },
});
