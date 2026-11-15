import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { optionalText, requiredText } from '../../lib/validation';

export const STOCK_HOLD_REASONS = ['damaged', 'expired', 'label_issue', 'other', 'missing'] as const;
export type StockHoldReason = (typeof STOCK_HOLD_REASONS)[number];

export const REPORT_REASONS = ['damaged', 'label_issue', 'other'] as const;
export const RECEIVE_ISSUE_REASONS = ['missing', 'damaged'] as const;

export const STOCK_HOLD_STATUSES = [
  'open',
  'released',
  'written_off',
  'supplier_returned',
  'sent_back',
] as const;
export type StockHoldStatus = (typeof STOCK_HOLD_STATUSES)[number];

export const STOCK_HOLD_DECISIONS = ['release', 'write_off', 'supplier_return', 'send_back'] as const;
export type StockHoldDecision = (typeof STOCK_HOLD_DECISIONS)[number];

export const reportStockHoldSchema = registry.register(
  'ReportStockHold',
  z
    .object({
      serials: z
        .array(requiredText(1, 30))
        .min(1, 'Scan at least one label')
        .max(50)
        .openapi({ example: ['DSM-000123', 'DSM-000124'] }),
      reason: z.enum(REPORT_REASONS),
      note: optionalText(500),
      saleId: z.uuid().optional().openapi({ description: 'The online order being dispatched' }),
      stockRequestId: z.uuid().optional().openapi({ description: 'The stock request being sent' }),
    })
    .refine((v) => !(v.saleId && v.stockRequestId), {
      message: 'Give either saleId or stockRequestId',
      path: ['saleId'],
    }),
);

export const decideStockHoldSchema = registry.register(
  'DecideStockHold',
  z.object({
    decision: z.enum(STOCK_HOLD_DECISIONS),
    note: requiredText(1, 500),
  }),
);

export const stockHoldListQuerySchema = z.object({
  status: z.enum(STOCK_HOLD_STATUSES).optional(),
  reason: z.enum(STOCK_HOLD_REASONS).optional(),
  productId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  saleId: z.uuid().optional(),
  stockRequestId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
});

const person = z.object({ id: z.uuid(), name: z.string(), role: z.string() }).nullable();

export const stockHoldSchema = registry.register(
  'StockHold',
  z.object({
    id: z.uuid(),
    holdNo: z.string(),
    status: z.enum(STOCK_HOLD_STATUSES),
    reason: z.enum(STOCK_HOLD_REASONS),
    note: z.string().nullable(),
    serial: z.string(),
    itemStatus: z.string(),
    product: z.object({ id: z.uuid(), name: z.string() }),
    batchNo: z.string().nullable(),
    expiryDate: z.string().nullable(),
    branch: z.object({ id: z.uuid(), name: z.string(), code: z.string(), kind: z.string() }),
    sale: z.object({ id: z.uuid(), invoiceNo: z.string() }).nullable(),
    stockRequest: z.object({ id: z.uuid(), requestNo: z.string(), branchName: z.string() }).nullable(),
    reportedBy: person,
    decidedBy: person,
    decidedAt: z.string().nullable(),
    decisionNote: z.string().nullable(),
    writeOffNo: z.string().nullable(),
    transferNo: z.string().nullable(),
    canDecide: z.boolean(),
    canSendBack: z.boolean(),
    createdAt: z.string(),
  }),
);

export type ReportStockHoldInput = z.output<typeof reportStockHoldSchema>;
export type DecideStockHoldInput = z.output<typeof decideStockHoldSchema>;
export type StockHoldListQuery = z.output<typeof stockHoldListQuerySchema>;

const docs = securedDocs('Under observation');
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(stockHoldSchema)) });

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-holds',
  summary:
    'Labelled pieces under observation. The Super Admin and the Warehouse Keeper see every one, Dispatch Department staff see their own, other branches see the ones held on their stock requests.',
  request: { query: stockHoldListQuerySchema },
  responses: {
    200: { description: 'Pieces', ...jsonContent(dataEnvelope(z.array(stockHoldSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/stock-holds',
  summary:
    'Put one or more labelled pieces under observation while dispatching an order or sending a stock request (expired stock is never sent, so it is not a reason here). They can no longer be sold or sent until decided.',
  request: {
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: reportStockHoldSchema } } },
  },
  responses: {
    201: { description: 'Under observation', ...jsonContent(dataEnvelope(z.array(stockHoldSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/stock-holds/{id}/decide',
  summary:
    'Super Admin or Warehouse Keeper (any piece) or the Dispatch Department admin (its own pieces) decides: release back to stock, write off, send back to the supplier, or (a piece a branch held while receiving) send back to the Super Admin stock',
  request: {
    params: idParamsSchema,
    body: { content: { 'application/json': { schema: decideStockHoldSchema } } },
  },
  responses: { 200: one('Decided'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/stock-holds/open-count',
  summary: 'How many pieces are under observation for the viewer',
  responses: {
    200: { description: 'Count', ...jsonContent(dataEnvelope(z.object({ open: z.number().int() }))) },
    ...errorResponses,
  },
});
