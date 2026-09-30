import { type RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { hasPermission, type Permission } from '../lib/permissions';

export function requirePermission(...anyOf: [Permission, ...Permission[]]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthorized());
    const role = req.auth.role;
    if (anyOf.some((permission) => hasPermission(role, permission))) return next();
    next(AppError.forbidden());
  };
}
