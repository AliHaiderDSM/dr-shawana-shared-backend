import { type Response } from 'express';
import { z } from 'zod';
import './openapi';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function sendOk<T>(res: Response, data: T, meta?: Record<string, unknown> | PageMeta, status = 200) {
  return res.status(status).json(meta === undefined ? { data } : { data, meta });
}

export function sendCreated<T>(res: Response, data: T) {
  return sendOk(res, data, undefined, 201);
}

export function sendNoContent(res: Response) {
  return res.status(204).end();
}

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi('ErrorResponse');

export const pageMetaSchema = z
  .object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .openapi('PageMeta');

export const idParamsSchema = z.object({ id: z.uuid() });

export const branchQuerySchema = z.object({ branchId: z.uuid().optional() });

export const jsonContent = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });

export const errorResponses = {
  400: { description: 'Validation error', ...jsonContent(errorResponseSchema) },
  401: { description: 'Not authenticated', ...jsonContent(errorResponseSchema) },
  403: { description: 'Not allowed', ...jsonContent(errorResponseSchema) },
  404: { description: 'Not found', ...jsonContent(errorResponseSchema) },
  409: { description: 'Conflict', ...jsonContent(errorResponseSchema) },
};

export const dataEnvelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

export const pageEnvelope = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), meta: pageMetaSchema });

export function withoutInternals<T extends { deletedAt?: unknown; deletedBy?: unknown }>(record: T) {
  const { deletedAt: _deletedAt, deletedBy: _deletedBy, ...rest } = record;
  return rest;
}
