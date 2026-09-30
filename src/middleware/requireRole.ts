import { type RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { type Role } from '../lib/permissions';

export function requireRole(...roles: Role[]): RequestHandler {
  const allowed = new Set<Role>(roles);
  return (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthorized());
    if (req.auth.isSuperAdmin || allowed.has(req.auth.role)) return next();
    next(AppError.forbidden());
  };
}
