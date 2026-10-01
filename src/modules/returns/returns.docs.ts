import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageEnvelope,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import {
  createReturnSchema,
  resolveItemSchema,
  returnableSchema,
  returnItemParamsSchema,
  returnListQuerySchema,
  saleParamsSchema,
  saleReturnSchema,
  setRefundSchema,
} from './returns.schemas';

const docs = securedDocs('Returns');
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(saleReturnSchema)) });
const byId = { params: idParamsSchema, query: branchQuerySchema };

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/returns',
  summary: 'List sale returns',
  request: { query: returnListQuerySchema },
  responses: {
    200: { description: 'Page', ...jsonContent(pageEnvelope(saleReturnSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/returns/sale/{saleId}/returnable',
  summary: 'Sold, already returned and still returnable quantity per product of a sale',
  request: { params: saleParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Returnable lines', ...jsonContent(dataEnvelope(returnableSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/returns',
  summary:
    'Receive returned products into the returns section (pending inspection; stock is not changed yet). Optional refund.',
  request: { query: branchQuerySchema, body: jsonContent(createReturnSchema) },
  responses: { 201: one('Created'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/returns/{id}',
  summary: 'Get a return',
  request: byId,
  responses: { 200: one('Return'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/returns/{id}/items/{itemId}/resolve',
  summary:
    'Inspection result of one item: restocked (back into sellable stock), damaged (written off) or supplier (sent back)',
  request: {
    params: returnItemParamsSchema,
    query: branchQuerySchema,
    body: jsonContent(resolveItemSchema),
  },
  responses: { 200: one('Updated'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'put',
  path: '/branch/returns/{id}/refund',
  summary: 'Set or clear the refund of a return; refunds reduce the account balance',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(setRefundSchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'delete',
  path: '/branch/returns/{id}',
  summary: 'Delete a return that has no inspected items',
  request: byId,
  responses: { 204: { description: 'Deleted' }, ...errorResponses },
});
