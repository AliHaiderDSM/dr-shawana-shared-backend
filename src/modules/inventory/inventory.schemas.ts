import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, jsonContent, pageEnvelope } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { MAX_PAGE_SIZE } from '../../lib/pagination';
import { dateInput, quantityOutput } from '../../lib/validation';
import { STOCK_MOVEMENT_TYPES } from './stock-movement.entity';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const stockBalanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  lowStockOnly: booleanQuery.optional(),
  productId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});

export const expiryAlertsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  branchId: z.uuid().optional(),
});

const dateRange = {
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
};

export const inventoryReportQuerySchema = z
  .object({
    ...dateRange,
    categoryId: z.uuid().optional(),
    productId: z.uuid().optional(),
    supplierId: z
      .uuid()
      .optional()
      .openapi({ description: 'Only stock in and purchases from this supplier' }),
    dispatcherId: z.uuid().optional().openapi({ description: 'Only stock out through this dispatcher' }),
    toBranchId: z.uuid().optional().openapi({
      description:
        'Super Admin Stock: only transfers to this branch, plus its sales and stock left (posSoft Stock To)',
    }),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: '"to" must be on or after "from"',
  });

export const productLedgerQuerySchema = z
  .object(dateRange)
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: '"to" must be on or after "from"',
  });

export const productParamsSchema = z.object({ productId: z.uuid() });

export const stockBalanceSchema = registry.register(
  'StockBalance',
  z.object({
    productId: z.uuid(),
    name: z.string(),
    batchNo: z.string().nullable(),
    categoryId: z.uuid(),
    categoryName: z.string().nullable(),
    unit: z.string(),
    quantity: quantityOutput,
    expiredQuantity: quantityOutput.openapi({
      description: 'Part of quantity in batches past their expiry date',
    }),
    reservedQuantity: quantityOutput.openapi({
      description: 'Booked by online orders that are still waiting for dispatch; still on the shelf',
    }),
    lowStockThreshold: quantityOutput,
    isLowStock: z.boolean(),
  }),
);

const reportRow = z.object({
  productId: z.uuid(),
  name: z.string(),
  categoryName: z.string().nullable(),
  opening: quantityOutput,
  purchased: quantityOutput,
  stockIn: quantityOutput,
  manufactured: quantityOutput,
  stockOut: quantityOutput,
  sold: quantityOutput,
  returned: quantityOutput,
  adjusted: quantityOutput,
  closing: quantityOutput,
  branchSold: quantityOutput.openapi({
    description: 'Sold at the toBranchId branch, or at every branch for the Super Admin stock',
  }),
  inBranch: quantityOutput.openapi({
    description: 'Left at the toBranchId branch (or every branch) on the last day',
  }),
  branchReturned: quantityOutput.openapi({
    description: 'Returned by customers back into stock at the toBranchId branch (or every branch)',
  }),
});

const branchShare = z.object({
  branchId: z.uuid(),
  branchName: z.string(),
  sent: quantityOutput,
  sold: quantityOutput,
  returned: quantityOutput,
  inBranch: quantityOutput,
});

export const inventoryReportSchema = registry.register(
  'InventoryReport',
  z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    perBranch: z.boolean().openapi({ description: 'Rows carry a per-branch breakdown (Super Admin stock)' }),
    rows: z.array(reportRow.extend({ branches: z.array(branchShare) })),
    totals: reportRow.omit({ productId: true, name: true, categoryName: true }),
  }),
);

export const productLedgerSchema = registry.register(
  'ProductLedger',
  z.object({
    productId: z.uuid(),
    from: z.iso.date().nullable(),
    to: z.iso.date().nullable(),
    opening: quantityOutput,
    closing: quantityOutput,
    totalIn: quantityOutput,
    totalOut: quantityOutput,
    movements: z.array(
      z.object({
        id: z.uuid(),
        date: z.iso.date(),
        type: z.enum(STOCK_MOVEMENT_TYPES),
        in: quantityOutput,
        out: quantityOutput,
        balance: quantityOutput,
        referenceType: z.string(),
        referenceId: z.uuid(),
        isReversal: z.boolean(),
        batchNo: z.string().nullable(),
        manufacturingDate: z.iso.date().nullable(),
        expiryDate: z.iso.date().nullable(),
        detail: z.string().nullable().openapi({
          description: 'Where it came from or went: supplier, branch, invoice and customer, return',
        }),
        note: z.string().nullable(),
      }),
    ),
  }),
);

export type StockBalanceQuery = z.output<typeof stockBalanceQuerySchema>;
export type ExpiryAlertsQuery = z.output<typeof expiryAlertsQuerySchema>;

export const expiryAlertSchema = registry.register(
  'ExpiryAlert',
  z.object({
    batchId: z.uuid(),
    branchId: z.uuid(),
    branchName: z.string(),
    branchKind: z.enum(['branch', 'warehouse']),
    productId: z.uuid(),
    productName: z.string(),
    unit: z.string(),
    batchNo: z.string(),
    expiryDate: z.iso.date(),
    daysLeft: z.number().int(),
    quantity: quantityOutput,
  }),
);
export type InventoryReportQuery = z.output<typeof inventoryReportQuerySchema>;
export type ProductLedgerQuery = z.output<typeof productLedgerQuerySchema>;

const common = securedDocs('Inventory');

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/stock',
  summary: 'Current stock per product from the ledger, with the low-stock flag',
  request: { query: stockBalanceQuerySchema },
  responses: {
    200: { description: 'Balances', ...jsonContent(pageEnvelope(stockBalanceSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/expiry-alerts',
  summary:
    'Batches in stock that expire within the next days (default 90) or have expired. Super Admin without branchId gets every branch and the Super Admin stock.',
  request: { query: expiryAlertsQuerySchema },
  responses: {
    200: { description: 'Alerts, soonest first', ...jsonContent(dataEnvelope(z.array(expiryAlertSchema))) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/report',
  summary: 'Opening, in, out, sold, returned and closing per product for a date range (default: this month)',
  request: { query: inventoryReportQuerySchema },
  responses: {
    200: { description: 'Report', ...jsonContent(dataEnvelope(inventoryReportSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/inventory/products/{productId}/ledger',
  summary: 'Dated in/out ledger of one product with running balance',
  request: {
    params: productParamsSchema,
    query: branchQuerySchema.extend({ from: dateInput.optional(), to: dateInput.optional() }),
  },
  responses: {
    200: { description: 'Ledger', ...jsonContent(dataEnvelope(productLedgerSchema)) },
    ...errorResponses,
  },
});
