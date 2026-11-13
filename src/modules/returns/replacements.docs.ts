import { z } from 'zod';
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
  createDirectReplacementSchema,
  createReplacementSchema,
  decideReplacementSchema,
  replaceableSchema,
  replacementFileParamsSchema,
  replacementListQuerySchema,
  saleReplacementSchema,
  sendReplacementSchema,
} from './replacements.schemas';

const docs = securedDocs('Returns');
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(saleReplacementSchema)) });
const byId = { params: idParamsSchema, query: branchQuerySchema };
const withFiles = (payload: z.ZodType) => ({
  content: {
    'application/json': { schema: payload },
    'multipart/form-data': {
      schema: z.object({
        data: z.string().openapi({ description: 'JSON payload' }),
        files: z
          .array(z.string().openapi({ format: 'binary' }))
          .optional()
          .openapi({
            description: 'Optional photos or PDFs as proof (up to 5)',
          }),
      }),
    },
  },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/returns/{id}/replacements',
  summary:
    'Branch Admin or dispatcher asks to send the returned products again, free (up to the returned quantity). It waits for the Super Admin. Numbered on the sale: <invoice>.1, .2',
  request: { params: idParamsSchema, query: branchQuerySchema, body: withFiles(createReplacementSchema) },
  responses: { 201: one('Created'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/sales/{id}/replacements',
  summary:
    'Branch Admin or dispatcher asks to replace products of a sale without a return (up to sold minus returned minus already replaced). It waits for the Super Admin.',
  request: {
    params: idParamsSchema,
    query: branchQuerySchema,
    body: withFiles(createDirectReplacementSchema),
  },
  responses: { 201: one('Created'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/sales/{id}/replaceable',
  summary: 'Products of a sale that can still be replaced without a return',
  request: byId,
  responses: {
    200: { description: 'Replaceable', ...jsonContent(dataEnvelope(replaceableSchema)) },
    ...errorResponses,
  },
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
  method: 'get',
  path: '/branch/replacements/{id}/files/{fileId}/url',
  summary: 'Short-lived link to a proof file',
  request: { params: replacementFileParamsSchema, query: branchQuerySchema },
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});

for (const action of ['approve', 'reject'] as const) {
  registry.registerPath({
    ...docs,
    method: 'post',
    path: `/admin/replacements/{id}/${action}`,
    summary:
      action === 'approve'
        ? 'Super Admin approves a replacement; then it can be sent'
        : 'Super Admin rejects a replacement; a note is required',
    request: { params: idParamsSchema, body: jsonContent(decideReplacementSchema) },
    responses: { 200: one(action === 'approve' ? 'Approved' : 'Rejected'), ...errorResponses },
  });
}

registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/replacements/{id}/send',
  summary:
    'Send an approved replacement: the stock branch scans the labels and the stock leaves (office: the selling branch; online: the Dispatch Department)',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(sendReplacementSchema) },
  responses: { 200: one('Sent'), ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'delete',
  path: '/branch/replacements/{id}',
  summary: 'Delete a replacement that is still waiting for approval',
  request: byId,
  responses: { 204: { description: 'Deleted' }, ...errorResponses },
});
