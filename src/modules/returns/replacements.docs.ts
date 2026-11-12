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
  createReplacementSchema,
  replacementListQuerySchema,
  saleReplacementSchema,
  sendReplacementSchema,
} from './replacements.schemas';

const docs = securedDocs('Returns');
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(saleReplacementSchema)) });
const byId = { params: idParamsSchema, query: branchQuerySchema };

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/returns/{id}/replacements',
  summary:
    'Branch Admin or dispatcher sends the same products again, free, for a damaged or expired return (up to the returned quantity). Office sale: the stock leaves now with its labels. Online sale: it waits for the Dispatch Department. Not a sale: no payment, no revenue.',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(createReplacementSchema) },
  responses: { 201: one('Created'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/replacements',
  summary: 'Replacements of the branch, and those the Dispatch Department has to send',
  request: { query: replacementListQuerySchema },
  responses: {
    200: { description: 'Page', ...jsonContent(pageEnvelope(saleReplacementSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/replacements/{id}',
  summary: 'Get a replacement with the labels sent',
  request: byId,
  responses: { 200: one('Replacement'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/replacements/{id}/send',
  summary: 'Dispatch Department sends a waiting online replacement: scans the labels and the stock leaves',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(sendReplacementSchema) },
  responses: { 200: one('Sent'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'delete',
  path: '/branch/replacements/{id}',
  summary: 'Delete a replacement that is still waiting to be sent',
  request: byId,
  responses: { 204: { description: 'Deleted' }, ...errorResponses },
});
