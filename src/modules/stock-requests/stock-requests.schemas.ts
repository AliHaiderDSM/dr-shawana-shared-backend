import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import {
  dateInput,
  optionalText,
  positiveQuantityInput,
  quantityInput,
  quantityOutput,
} from '../../lib/validation';
import { STOCK_REQUEST_STATUSES } from './stock-request.entity';

export const createStockRequestSchema = registry.register(
  'CreateStockRequest',
  z.object({
    note: optionalText(1000),
    items: z
      .array(
        z.object({
          productId: z.uuid().openapi({ description: 'A product of the Super Admin stock' }),
          qty: positiveQuantityInput,
          note: optionalText(500),
        }),
      )
      .min(1, 'Add at least one product')
      .max(100),
  }),
);

export const editStockRequestSchema = registry.register(
  'EditStockRequest',
  z.object({
    note: optionalText(500),
    items: z
      .array(z.object({ id: z.uuid(), approvedQty: quantityInput }))
      .max(100)
      .openapi({ description: 'New approved quantity per line. Lines left out keep their quantity.' }),
  }),
);

export const decideStockRequestSchema = registry.register(
  'DecideStockRequest',
  z.object({
    note: optionalText(500),
    items: z
      .array(z.object({ id: z.uuid(), approvedQty: quantityInput }))
      .max(100)
      .optional()
      .openapi({ description: 'Approve less than asked for some lines. Lines left out get what was asked.' }),
  }),
);

export const stockRequestListQuerySchema = z.object({
  status: z.enum(STOCK_REQUEST_STATUSES).optional(),
  branchId: z.uuid().optional(),
});

export const stockRequestCatalogQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
});

export const incomingStockQuerySchema = z.object({
  status: z.enum(['waiting', 'received']).optional(),
  transferNo: z.string().trim().min(1).max(30).optional(),
  branchId: z.uuid().optional(),
});

export const transferParamsSchema = z.object({ transferNo: z.string().trim().min(1).max(30) });

export const receiveStockSchema = registry.register('ReceiveStock', z.object({ date: dateInput.optional() }));

const person = z.object({ id: z.uuid(), name: z.string(), role: z.string() }).nullable();

export const stockRequestSchema = registry.register(
  'StockRequest',
  z.object({
    id: z.uuid(),
    requestNo: z.string(),
    status: z.enum(STOCK_REQUEST_STATUSES),
    note: z.string().nullable(),
    decisionNote: z.string().nullable(),
    decidedAt: z.string().nullable(),
    sentAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
    createdAt: z.string(),
    branch: z.object({ id: z.uuid(), name: z.string(), code: z.string(), kind: z.string() }),
    requestedBy: person,
    decidedBy: person,
    receivedBy: person,
    transferNos: z.array(z.string()),
    transfers: z.array(
      z.object({
        transferNo: z.string(),
        sentAt: z.string(),
        qty: z.string(),
        received: z.boolean(),
        receivedAt: z.string().nullable(),
        sentBy: z.string().nullable(),
        receivedBy: z.string().nullable(),
      }),
    ),
    items: z.array(
      z.object({
        id: z.uuid(),
        productId: z.uuid(),
        productName: z.string(),
        unit: z.string(),
        qty: quantityOutput,
        approvedQty: quantityOutput.nullable(),
        note: z.string().nullable(),
        available: quantityOutput,
        sentQty: quantityOutput,
        receivedQty: quantityOutput,
      }),
    ),
  }),
);

export const incomingStockSchema = registry.register(
  'IncomingStock',
  z.object({
    transferNo: z.string(),
    date: z.iso.date(),
    sentAt: z.string(),
    received: z.boolean(),
    receivedAt: z.string().nullable(),
    receivedBy: person,
    sentBy: person,
    toBranch: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
    request: z.object({ id: z.uuid(), requestNo: z.string() }).nullable(),
    note: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        productId: z.uuid(),
        productName: z.string(),
        unit: z.string(),
        qty: quantityOutput,
        received: z.boolean(),
        labels: z.number().int(),
      }),
    ),
  }),
);

const catalogItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  unit: z.string(),
  batchNo: z.string().nullable(),
  categoryName: z.string().nullable(),
  available: quantityOutput,
});

export type CreateStockRequestInput = z.output<typeof createStockRequestSchema>;
export type DecideStockRequestInput = z.output<typeof decideStockRequestSchema>;
export type EditStockRequestInput = z.output<typeof editStockRequestSchema>;
export type StockRequestListQuery = z.output<typeof stockRequestListQuerySchema>;
export type IncomingStockQuery = Partial<z.output<typeof incomingStockQuerySchema>>;

const docs = securedDocs('Stock requests');
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(stockRequestSchema)) });

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-requests',
  summary: 'Stock requests. A branch sees its own; the Super Admin sees every branch without ?branchId=.',
  request: { query: stockRequestListQuerySchema },
  responses: {
    200: { description: 'Requests', ...jsonContent(dataEnvelope(z.array(stockRequestSchema))) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-requests/catalog',
  summary: 'Products of the Super Admin stock a branch can ask for, with the stock there now',
  request: { query: stockRequestCatalogQuerySchema },
  responses: {
    200: { description: 'Products', ...jsonContent(dataEnvelope(z.array(catalogItemSchema))) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/stock-requests',
  summary: 'Ask the Super Admin for stock: which products and how many',
  request: {
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: createStockRequestSchema } } },
  },
  responses: { 201: one('Created'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-requests/{id}',
  summary: 'One stock request with what was asked, approved, sent and received',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: { 200: one('Request'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/stock-requests/{id}/cancel',
  summary: 'Withdraw a request the Super Admin has not answered',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: { 200: one('Cancelled'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/admin/stock-requests/pending-count',
  summary: 'Requests waiting for the Super Admin, and approved ones still to send',
  responses: {
    200: {
      description: 'Counts',
      ...jsonContent(dataEnvelope(z.object({ pending: z.number().int(), toSend: z.number().int() }))),
    },
    ...errorResponses,
  },
});
for (const action of ['approve', 'reject'] as const) {
  registry.registerPath({
    ...docs,
    method: 'post',
    path: `/admin/stock-requests/{id}/${action}`,
    summary:
      action === 'approve'
        ? 'Super Admin approves (optionally less per product); then sends it with a Stock Out to the branch'
        : 'Super Admin refuses the request',
    request: {
      params: idParamsSchema,
      body: { content: { 'application/json': { schema: decideStockRequestSchema } } },
    },
    responses: { 200: one(action === 'approve' ? 'Approved' : 'Rejected'), ...errorResponses },
  });
}
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/admin/stock-requests/{id}/edit',
  summary:
    'Super Admin changes the approved quantities (and note) of an approved request until it is fully received. A line cannot go below what is already sent.',
  request: {
    params: idParamsSchema,
    body: { content: { 'application/json': { schema: editStockRequestSchema } } },
  },
  responses: { 200: one('Changed'), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/incoming-stock',
  summary:
    'Transfers from the Super Admin stock by transfer number. Stock reaches the branch only after the branch admin receives it.',
  request: { query: incomingStockQuerySchema },
  responses: {
    200: { description: 'Transfers', ...jsonContent(dataEnvelope(z.array(incomingStockSchema))) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/incoming-stock/{transferNo}/receive',
  summary: 'Branch admin checks and receives a transfer: its Stock In is created in the branch',
  request: {
    params: transferParamsSchema,
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: receiveStockSchema } } },
  },
  responses: {
    200: { description: 'Received', ...jsonContent(dataEnvelope(incomingStockSchema.nullable())) },
    ...errorResponses,
  },
});
