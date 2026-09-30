import { type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';

const branchIdQuery = z.uuid();

interface BranchScopeOptions {
  allowAllForSuperAdmin?: boolean;
}

export function branchScope(options: BranchScopeOptions = {}): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(AppError.unauthorized());

    const raw = req.query.branchId;
    const requested = typeof raw === 'string' && raw.length > 0 ? raw : undefined;

    if (auth.isSuperAdmin) {
      if (requested === undefined) {
        if (options.allowAllForSuperAdmin) {
          req.branchId = null;
          return next();
        }
        return next(AppError.badRequest('Super Admin must select a branch with ?branchId='));
      }
      const parsed = branchIdQuery.safeParse(requested);
      if (!parsed.success) return next(AppError.badRequest('branchId must be a valid uuid'));
      req.branchId = parsed.data;
      return next();
    }

    if (!auth.branchId) return next(AppError.forbidden('Your account is not assigned to a branch'));
    if (requested !== undefined && requested !== auth.branchId) {
      return next(AppError.forbidden('You can only access your own branch'));
    }
    req.branchId = auth.branchId;
    next();
  };
}

export function requireBranchId(branchId: string | null | undefined): string {
  if (!branchId) throw AppError.badRequest('A branch must be selected for this action');
  return branchId;
}
