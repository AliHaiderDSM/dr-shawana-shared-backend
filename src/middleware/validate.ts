import { type Request, type RequestHandler } from 'express';
import { type z } from 'zod';
import { AppError } from '../lib/errors';

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const details: ReturnType<typeof formatZodIssues> = [];
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        req.valid[part] = result.data;
      } else {
        details.push(...formatZodIssues(result.error).map((d) => ({ ...d, path: `${part}.${d.path}` })));
      }
    }
    if (details.length > 0) return next(AppError.validation(details));
    next();
  };
}

export const validBody = <S extends z.ZodType>(req: Request, _schema: S) => req.valid.body as z.output<S>;
export const validQuery = <S extends z.ZodType>(req: Request, _schema: S) => req.valid.query as z.output<S>;
export const validParams = <S extends z.ZodType>(req: Request, _schema: S) => req.valid.params as z.output<S>;
