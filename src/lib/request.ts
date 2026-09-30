import { type Request } from 'express';
import { requireBranchId } from '../middleware/branchScope';
import { validParams } from '../middleware/validate';
import { idParamsSchema } from './http';

export const branchIdOf = (req: Request): string => requireBranchId(req.branchId);

export const idOf = (req: Request): string => validParams(req, idParamsSchema).id;
