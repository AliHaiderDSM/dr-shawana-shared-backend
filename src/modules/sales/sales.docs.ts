import { z } from 'zod';
import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageMetaSchema,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { moneyOutput, quantityOutput } from '../../lib/validation';
import {
  createSalePaymentSchema,
  createSaleSchema,
  deliverySlipsQuerySchema,
  deliveryStatusSchema,
  saleListQuerySchema,
  salePaymentParamsSchema,
  salePaymentProofParamsSchema,
  saleSchema,
  updateSalePaymentSchema,
  updateSaleSchema,
} from './sales.schemas';

const docs = securedDocs('Sales');
const item = '/branch/sales/{id}';
const byId = { params: idParamsSchema, query: branchQuerySchema };
const paymentRequest = { params: salePaymentParamsSchema, query: branchQuerySchema };
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(saleSchema)) });
const binary = z.string().openapi({ format: 'binary' });
const withData = (payload: z.ZodType, files: Record<string, z.ZodType>) => ({
  content: {
    'application/json': { schema: payload },
    'multipart/form-data': { schema: z.object({ data: z.string(), ...files }) },
  },
});
const moneyTotals = z.object({
  qty: quantityOutput,
  subtotal: moneyOutput,
  discount: moneyOutput,
  total: moneyOutput,
  received: moneyOutput,
  remaining: moneyOutput,
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/sales',
  summary: 'List sales (posSoft View Sale filters); meta.totals covers every matching sale',
  request: { query: saleListQuerySchema },
  responses: {
    200: {
      description: 'Page',
      ...jsonContent(
        z.object({
          data: z.array(saleSchema.omit({ items: true, payments: true })),
          meta: pageMetaSchema.extend({ totals: moneyTotals }),
        }),
      ),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/sales',
  summary:
    'Create a sale in one transaction: prices come from the products (bundles expand into their products at bundle prices), stock is checked and reduced, totals are computed on the server. JSON, or multipart with "data" plus "paymentProofs".',
  request: {
    query: branchQuerySchema,
    body: withData(createSaleSchema, { paymentProofs: z.array(binary).optional() }),
  },
  responses: {
    201: one('Created'),
    422: { ...errorResponses[409], description: 'Not enough stock (details.shortages)' },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: item,
  summary: 'Get a sale with items and payments',
  request: byId,
  responses: { 200: one('Sale'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'patch',
  path: item,
  summary:
    'Edit a sale; new items adjust stock by the difference (sale_edit_adjust). Front Desk can edit only their own sales.',
  request: { ...byId, body: jsonContent(updateSaleSchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: `${item}/delivery`,
  summary: 'Online sales: mark pending, delivered or returned. Returning puts the stock back (sale_return).',
  request: { ...byId, body: jsonContent(deliveryStatusSchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'delete',
  path: item,
  summary: 'Remove a sale; its stock movements are reversed and its payments removed',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: `${item}/bill`,
  summary: 'Data for the printed bill (company and branch header, customer, items, totals, payments)',
  request: byId,
  responses: {
    200: { description: 'Bill', ...jsonContent(dataEnvelope(z.record(z.string(), z.unknown()))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/sales/delivery-slips',
  summary:
    'posSoft delivery report: slips for printing two per page. Filters by customer, sale type, date range (today by default) and invoice-number range.',
  request: { query: deliverySlipsQuerySchema },
  responses: {
    200: { description: 'Slips', ...jsonContent(dataEnvelope(z.record(z.string(), z.unknown()))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: `${item}/payments`,
  summary: 'Add a payment (JSON, or multipart "data" + up to 5 "proof" files); totals are recomputed',
  request: { ...byId, body: withData(createSalePaymentSchema, { proof: z.array(binary).max(5).optional() }) },
  responses: { 201: one('Updated sale'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'patch',
  path: `${item}/payments/{paymentId}`,
  summary: 'Edit a payment; totals are recomputed',
  request: { ...paymentRequest, body: jsonContent(updateSalePaymentSchema) },
  responses: { 200: one('Updated sale'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: `${item}/payments/{paymentId}/proof`,
  summary: 'Add screenshots to an online payment (multipart "proof", up to 5 per payment)',
  request: {
    ...paymentRequest,
    body: { content: { 'multipart/form-data': { schema: z.object({ proof: z.array(binary).max(5) }) } } },
  },
  responses: { 200: one('Updated sale'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: `${item}/payments/{paymentId}/proofs/{proofId}/url`,
  summary: 'Download link for one payment screenshot',
  request: { ...paymentRequest, params: salePaymentProofParamsSchema },
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'delete',
  path: `${item}/payments/{paymentId}/proofs/{proofId}`,
  summary: 'Remove one payment screenshot',
  request: { ...paymentRequest, params: salePaymentProofParamsSchema },
  responses: { 200: one('Updated sale'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: `${item}/payments/{paymentId}/proof-url`,
  summary: 'Download link for the first payment screenshot',
  request: paymentRequest,
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'delete',
  path: `${item}/payments/{paymentId}`,
  summary: 'Remove a payment; totals are recomputed',
  request: paymentRequest,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
