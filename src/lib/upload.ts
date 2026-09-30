import multer from 'multer';
import { type Request, type RequestHandler } from 'express';
import { AppError } from './errors';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
const MB = 1024 * 1024;

function upload(allowedTypes: string[], maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 10 },
    fileFilter: (_req, file, callback) => {
      if (allowedTypes.includes(file.mimetype)) return callback(null, true);
      callback(AppError.badRequest(`File type ${file.mimetype} is not allowed`));
    },
  });
}

export const imageUpload = (field: string): RequestHandler => upload(IMAGE_TYPES, 5 * MB).single(field);

export const documentsUpload = (field: string, maxCount = 5): RequestHandler =>
  upload(DOCUMENT_TYPES, 10 * MB).array(field, maxCount);

export const documentFieldsUpload = (fields: { name: string; maxCount: number }[]): RequestHandler =>
  upload(DOCUMENT_TYPES, 10 * MB).fields(fields);

export const documentUpload = (field: string): RequestHandler =>
  upload(DOCUMENT_TYPES, 10 * MB).single(field);

export function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw AppError.badRequest('A file is required');
  return req.file;
}

export function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

export function filesOf(req: Request, field: string): Express.Multer.File[] {
  if (!req.files || Array.isArray(req.files)) return [];
  return req.files[field] ?? [];
}

export function fromMulterError(err: unknown): AppError | null {
  if (!(err instanceof multer.MulterError)) return null;
  if (err.code === 'LIMIT_FILE_SIZE') return new AppError(413, 'BAD_REQUEST', 'File is too large');
  return AppError.badRequest(`Upload failed: ${err.message}`);
}

export const jsonDataField: RequestHandler = (req, _res, next) => {
  if (!req.is('multipart/form-data')) return next();
  const raw = (req.body as Record<string, unknown> | undefined)?.data;
  if (typeof raw !== 'string')
    return next(AppError.badRequest('Multipart requests need a "data" JSON field'));
  try {
    req.body = JSON.parse(raw) as unknown;
    next();
  } catch {
    next(AppError.badRequest('The "data" field is not valid JSON'));
  }
};
