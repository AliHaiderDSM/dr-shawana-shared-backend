import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, jsonContent, pageEnvelope } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { MAX_PAGE_SIZE } from '../../lib/pagination';
import { dateInput, optionalText, quantityOutput } from '../../lib/validation';
import { ITEM_EVENTS } from './inventory-item-event.entity';
import { ITEM_SOURCES, ITEM_STATUSES } from './inventory-item.entity';

export const serialInput = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^DSM-\d{1,12}$/, 'Use a label number like DSM-000001')
  .openapi({ example: 'DSM-000001' });

export const serialsInput = z
  .array(serialInput)
  .max(5000)
  .openapi({ description: 'Scanned piece labels. Required for products tracked by label.' });

export const inventoryItemListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  sort: z.enum(['serial', '-serial']).optional(),
  search: z.string().trim().max(100).optional(),
  productId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  withoutBatch: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .openapi({ description: 'Only pieces that have no batch' }),
  saleId: z.uuid().optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  source: z.enum(ITEM_SOURCES).optional(),
  sourceId: z.uuid().optional(),
  from: serialInput.optional().openapi({ description: 'First label of a range' }),
  to: serialInput.optional().openapi({ description: 'Last label of a range' }),
  branchId: z.uuid().optional(),
});

export const labelBatchListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  search: z.string().trim().max(100).optional(),
  productId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  status: z
    .enum(ITEM_STATUSES)
    .optional()
    .openapi({ description: 'Only batches that have pieces in this status' }),
  branchId: z.uuid().optional(),
});

export const labelBatchSchema = registry.register(
  'LabelBatch',
  z.object({
    key: z.string(),
    productId: z.uuid(),
    productName: z.string(),
    batchId: z.uuid().nullable(),
    batchNo: z.string().nullable(),
    expiryDate: z.iso.date().nullable(),
    total: z.number().int(),
    inStock: z.number().int(),
    sold: z.number().int(),
    other: z.number().int(),
    firstSerial: z.string(),
    lastSerial: z.string(),
  }),
);

export type LabelBatchListQuery = z.output<typeof labelBatchListQuerySchema>;

export const itemParamsSchema = z.object({ itemId: z.uuid() });
export const serialParamsSchema = z.object({ serial: serialInput });
export const productSerialParamsSchema = z.object({ productId: z.uuid() });

export const registerLabelsSchema = registry.register(
  'RegisterLabels',
  z.object({
    productId: z.uuid(),
    batchId: z.uuid().nullable().optional(),
    firstSerial: serialInput,
    qty: z.coerce.number().int().min(1).max(5000),
    date: dateInput.optional(),
    note: optionalText(500),
  }),
);

const itemSchema = z.object({
  id: z.uuid(),
  serial: z.string(),
  status: z.enum(ITEM_STATUSES),
  productId: z.uuid(),
  productName: z.string(),
  batchId: z.uuid().nullable(),
  batchNo: z.string().nullable(),
  manufacturingDate: z.iso.date().nullable(),
  expiryDate: z.iso.date().nullable(),
  receivedOn: z.iso.date(),
  saleId: z.uuid().nullable(),
  invoiceNo: z.string().nullable(),
  soldOn: z.iso.date().nullable(),
});

export const inventoryItemSchema = registry.register('InventoryItem', itemSchema);

export const inventoryItemDetailSchema = registry.register(
  'InventoryItemDetail',
  itemSchema.extend({
    branchId: z.uuid(),
    branchName: z.string(),
    salePrice: z.string(),
    patientId: z.uuid().nullable(),
    patientName: z.string().nullable(),
    history: z.array(
      z.object({
        id: z.uuid(),
        type: z.enum(ITEM_EVENTS),
        referenceType: z.string().nullable(),
        referenceId: z.uuid().nullable(),
        referenceLabel: z.string().nullable(),
        note: z.string().nullable(),
        branchName: z.string(),
        by: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
);

export const serialSummarySchema = registry.register(
  'SerialSummary',
  z.object({
    productId: z.uuid(),
    trackSerials: z.boolean(),
    byStatus: z.record(z.string(), z.number()),
    unlabelled: z.array(
      z.object({ batchId: z.uuid().nullable(), batchNo: z.string().nullable(), qty: quantityOutput }),
    ),
  }),
);

export const registeredLabelsSchema = registry.register(
  'RegisteredLabels',
  z.object({ count: z.number().int(), firstSerial: z.string(), lastSerial: z.string() }),
);

export type InventoryItemListQuery = z.output<typeof inventoryItemListQuerySchema>;
export type RegisterLabelsInput = z.output<typeof registerLabelsSchema>;

const common = securedDocs('Labelled pieces');

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/items',
  summary: 'Labelled pieces (one row per DSM-xxxxxx label) with product, batch, status and sale',
  request: { query: inventoryItemListQuerySchema },
  responses: {
    200: { description: 'Pieces', ...jsonContent(pageEnvelope(inventoryItemSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/items/batches',
  summary: 'Labelled pieces grouped by product and batch, with counts by status and the label range',
  request: { query: labelBatchListQuerySchema },
  responses: {
    200: { description: 'Batches', ...jsonContent(pageEnvelope(labelBatchSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/items/serial/{serial}',
  summary: 'Find a piece by its scanned label, with its full history',
  request: { params: serialParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Piece', ...jsonContent(dataEnvelope(inventoryItemDetailSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/items/{itemId}',
  summary: 'One piece with its full history',
  request: { params: itemParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Piece', ...jsonContent(dataEnvelope(inventoryItemDetailSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/inventory/items/register',
  summary:
    'Register labels already stuck on stock that is on hand: a run of consecutive numbers from firstSerial. The product becomes tracked by label.',
  request: { query: branchQuerySchema, body: jsonContent(registerLabelsSchema) },
  responses: {
    201: { description: 'Registered', ...jsonContent(dataEnvelope(registeredLabelsSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/products/{productId}/serials',
  summary: 'Pieces of a product by status, and stock still without labels per batch',
  request: { params: productSerialParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Summary', ...jsonContent(dataEnvelope(serialSummarySchema)) },
    ...errorResponses,
  },
});
