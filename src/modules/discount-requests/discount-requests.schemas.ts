import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { moneyOutput, optionalText, positiveQuantityInput, quantityOutput } from '../../lib/validation';
import { DISCOUNT_REQUEST_STATUSES } from './discount-request.entity';

const percent = z
  .union([z.number(), z.string().trim()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Use a percentage above 0 and below 100')
  .openapi({ type: 'string', example: '15' });

export const createDiscountRequestSchema = registry.register(
  'CreateDiscountRequest',
  z
    .object({
      productId: z.uuid().optional(),
      bundleId: z.uuid().optional(),
      qty: positiveQuantityInput,
      discountPercent: percent,
      note: optionalText(500),
      patientId: z.uuid().optional().openapi({ description: 'The customer of the sale, when already saved' }),
      customerName: z
        .string()
        .trim()
        .max(200)
        .optional()
        .openapi({ description: 'Name of a new customer that is not saved yet' }),
    })
    .refine((v) => (v.productId ? 1 : 0) + (v.bundleId ? 1 : 0) === 1, {
      message: 'Give either productId or bundleId',
      path: ['productId'],
    }),
);

export const decideDiscountRequestSchema = registry.register(
  'DecideDiscountRequest',
  z.object({ note: optionalText(500) }),
);

export const discountRequestListQuerySchema = z.object({
  status: z.enum(DISCOUNT_REQUEST_STATUSES).optional(),
  ids: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(100).optional()),
  branchId: z.uuid().optional(),
});

const person = z.object({ id: z.uuid(), name: z.string(), role: z.string() }).nullable();

export const discountRequestSchema = registry.register(
  'DiscountRequest',
  z.object({
    id: z.uuid(),
    requestNo: z.string(),
    branch: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
    requestedBy: person,
    productId: z.uuid().nullable(),
    bundleId: z.uuid().nullable(),
    itemName: z.string(),
    qty: quantityOutput,
    unitPrice: moneyOutput,
    discountPercent: z.string(),
    discountAmount: moneyOutput,
    note: z.string().nullable(),
    status: z.enum(DISCOUNT_REQUEST_STATUSES),
    decidedBy: person,
    decidedAt: z.iso.datetime().nullable(),
    decisionNote: z.string().nullable(),
    saleId: z.uuid().nullable(),
    invoiceNo: z.string().nullable(),
    customer: z
      .object({ id: z.uuid().nullable(), name: z.string(), phone: z.string().nullable() })
      .nullable(),
    createdAt: z.iso.datetime(),
  }),
);

export type CreateDiscountRequestInput = z.output<typeof createDiscountRequestSchema>;
export type DiscountRequestListQuery = z.output<typeof discountRequestListQuerySchema>;

const docs = securedDocs('Discount requests');
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(discountRequestSchema)) });

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/discount-requests',
  summary:
    'Special discount requests. Branch staff see their branch; the Super Admin sees every branch without ?branchId=.',
  request: { query: discountRequestListQuerySchema },
  responses: {
    200: { description: 'Requests', ...jsonContent(dataEnvelope(z.array(discountRequestSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/discount-requests',
  summary: 'Ask the Super Admin to allow a discount on one product or bundle of a sale',
  request: {
    query: branchQuerySchema,
    body: { content: { 'application/json': { schema: createDiscountRequestSchema } } },
  },
  responses: { 201: one('Created'), ...errorResponses },
});

for (const action of ['cancel'] as const) {
  registry.registerPath({
    ...docs,
    method: 'post',
    path: `/branch/discount-requests/{id}/${action}`,
    summary: 'Withdraw a request that is not used yet',
    request: { params: idParamsSchema, query: branchQuerySchema },
    responses: { 200: one('Cancelled'), ...errorResponses },
  });
}

for (const action of ['approve', 'reject'] as const) {
  registry.registerPath({
    ...docs,
    method: 'post',
    path: `/admin/discount-requests/{id}/${action}`,
    summary: action === 'approve' ? 'Super Admin allows the discount' : 'Super Admin refuses the discount',
    request: {
      params: idParamsSchema,
      body: { content: { 'application/json': { schema: decideDiscountRequestSchema } } },
    },
    responses: { 200: one(action === 'approve' ? 'Approved' : 'Rejected'), ...errorResponses },
  });
}

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/admin/discount-requests/pending-count',
  summary: 'How many discount requests wait for the Super Admin',
  responses: {
    200: { description: 'Count', ...jsonContent(dataEnvelope(z.object({ pending: z.number().int() }))) },
    ...errorResponses,
  },
});
