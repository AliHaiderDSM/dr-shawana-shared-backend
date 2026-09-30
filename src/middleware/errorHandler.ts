import { type ErrorRequestHandler, type RequestHandler } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { fromMulterError } from '../lib/upload';
import { formatZodIssues } from './validate';

interface PgDriverError {
  code?: string;
  detail?: string;
  constraint?: string;
}

const PG_ERROR = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  notNullViolation: '23502',
  checkViolation: '23514',
  invalidTextRepresentation: '22P02',
  numericValueOutOfRange: '22003',
  invalidDatetimeFormat: '22007',
  datetimeFieldOverflow: '22008',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
} as const;

const INVALID_FORMAT_CODES: string[] = [
  PG_ERROR.invalidTextRepresentation,
  PG_ERROR.numericValueOutOfRange,
  PG_ERROR.invalidDatetimeFormat,
  PG_ERROR.datetimeFieldOverflow,
];

const RETRYABLE_CODES: string[] = [PG_ERROR.serializationFailure, PG_ERROR.deadlockDetected];

function fromPostgres(err: QueryFailedError): AppError | null {
  const driver = err.driverError as PgDriverError;
  const constraint = driver.constraint;
  const code = driver.code ?? '';

  if (code === PG_ERROR.uniqueViolation) {
    return AppError.conflict('A record with the same value already exists', { constraint });
  }
  if (code === PG_ERROR.foreignKeyViolation) {
    return driver.detail?.includes('is still referenced')
      ? AppError.conflict('This record is in use by other records and cannot be removed', { constraint })
      : AppError.badRequest('A referenced record does not exist', { constraint });
  }
  if (code === PG_ERROR.notNullViolation)
    return AppError.badRequest('A required value is missing', { constraint });
  if (code === PG_ERROR.checkViolation) return AppError.badRequest('A value is not allowed', { constraint });
  if (INVALID_FORMAT_CODES.includes(code)) return AppError.badRequest('A value has an invalid format');
  if (RETRYABLE_CODES.includes(code)) {
    return AppError.conflict('The record was changed by another request, please retry');
  }
  return null;
}

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return AppError.validation(formatZodIssues(err));
  if (err instanceof EntityNotFoundError) return AppError.notFound();
  if (err instanceof QueryFailedError) return fromPostgres(err);
  const uploadError = fromMulterError(err);
  if (uploadError) return uploadError;
  if (typeof err === 'object' && err !== null && 'type' in err && 'status' in err) {
    const e = err as { status: number; type: string };
    if (e.type === 'entity.parse.failed') return AppError.badRequest('Malformed JSON body');
    if (e.type === 'entity.too.large') return new AppError(413, 'BAD_REQUEST', 'Request body is too large');
  }
  return null;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);

  if (!appError) {
    logger.error({ err, requestId: req.id, method: req.method, url: req.originalUrl }, 'Unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: req.id },
    });
    return;
  }

  if (appError.status >= 500) logger.error({ err, requestId: req.id }, appError.message);

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      requestId: req.id,
    },
  });
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};
