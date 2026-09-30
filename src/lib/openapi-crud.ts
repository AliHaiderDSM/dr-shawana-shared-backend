import { z } from 'zod';
import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageEnvelope,
} from './http';
import { bearerAuth, registry } from './openapi';

interface CrudDocs {
  path: string;
  tag: string;
  noun: string;
  entity: z.ZodType;
  create?: z.ZodType;
  update?: z.ZodType;
  listQuery?: z.ZodObject;
  options?: z.ZodType;
  remove?: string;
  imageUpload?: boolean;
}

const optionSchema = z.object({ id: z.uuid(), name: z.string() });

export const multipartImage = {
  content: {
    'multipart/form-data': { schema: z.object({ image: z.string().openapi({ format: 'binary' }) }) },
  },
};

export const multipartFiles = (payload?: z.ZodType) => ({
  content: {
    'multipart/form-data': {
      schema: z.object({
        ...(payload ? { data: z.string().openapi({ description: 'JSON payload', example: '{}' }) } : {}),
        files: z.array(z.string().openapi({ format: 'binary' })).optional(),
      }),
    },
    ...(payload ? { 'application/json': { schema: payload } } : {}),
  },
});

export function securedDocs(tag: string) {
  return { tags: [tag], security: [{ [bearerAuth.name]: [] }] };
}

export function registerCrudDocs(docs: CrudDocs): void {
  const common = securedDocs(docs.tag);
  const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(docs.entity)) });
  const byId = { params: idParamsSchema, query: branchQuerySchema };
  const item = `${docs.path}/{id}`;

  registry.registerPath({
    ...common,
    method: 'get',
    path: docs.path,
    summary: `List ${docs.noun}s`,
    request: { query: docs.listQuery ?? branchQuerySchema },
    responses: { 200: { description: 'Page', ...jsonContent(pageEnvelope(docs.entity)) }, ...errorResponses },
  });

  registry.registerPath({
    ...common,
    method: 'get',
    path: `${docs.path}/options`,
    summary: `${docs.noun} dropdown options`,
    request: { query: branchQuerySchema },
    responses: {
      200: { description: 'Options', ...jsonContent(dataEnvelope(z.array(docs.options ?? optionSchema))) },
      ...errorResponses,
    },
  });

  registry.registerPath({
    ...common,
    method: 'get',
    path: item,
    summary: `Get a ${docs.noun}`,
    request: byId,
    responses: { 200: one(docs.noun), ...errorResponses },
  });

  if (docs.create) {
    registry.registerPath({
      ...common,
      method: 'post',
      path: docs.path,
      summary: `Create a ${docs.noun}`,
      request: { query: branchQuerySchema, body: jsonContent(docs.create) },
      responses: { 201: one('Created'), ...errorResponses },
    });
  }

  if (docs.update) {
    registry.registerPath({
      ...common,
      method: 'patch',
      path: item,
      summary: `Edit a ${docs.noun}`,
      request: { ...byId, body: jsonContent(docs.update) },
      responses: { 200: one('Updated'), ...errorResponses },
    });
  }

  registry.registerPath({
    ...common,
    method: 'delete',
    path: item,
    summary: docs.remove ?? `Remove a ${docs.noun} (soft delete)`,
    request: byId,
    responses: { 204: { description: 'Removed' }, ...errorResponses },
  });

  if (docs.imageUpload) {
    registry.registerPath({
      ...common,
      method: 'post',
      path: `${item}/image`,
      summary: `Upload the ${docs.noun} image (multipart field "image", jpeg/png/webp, max 5 MB)`,
      request: { ...byId, body: multipartImage },
      responses: { 200: one('Updated'), ...errorResponses },
    });
  }
}
