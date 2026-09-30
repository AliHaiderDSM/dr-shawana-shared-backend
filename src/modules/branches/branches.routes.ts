import { Router } from 'express';
import { idParamsSchema } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createBranchAdminSchema } from '../staff/staff.schemas';
import { branchesController } from './branches.controller';
import { branchListQuerySchema, createBranchSchema, updateBranchSchema } from './branches.schemas';

export const branchesRouter = Router();

const byId = validate({ params: idParamsSchema });

branchesRouter.use('/admin/branches', authenticate, requireRole('super_admin'));

branchesRouter.get('/admin/branches', validate({ query: branchListQuerySchema }), branchesController.list);
branchesRouter.get('/admin/branches/options', branchesController.options);
branchesRouter.post('/admin/branches', validate({ body: createBranchSchema }), branchesController.create);
branchesRouter.get('/admin/branches/:id', byId, branchesController.get);
branchesRouter.patch(
  '/admin/branches/:id',
  validate({ params: idParamsSchema, body: updateBranchSchema }),
  branchesController.update,
);
branchesRouter.delete('/admin/branches/:id', byId, branchesController.remove);
branchesRouter.post('/admin/branches/:id/activate', byId, branchesController.activate);
branchesRouter.post('/admin/branches/:id/deactivate', byId, branchesController.deactivate);
branchesRouter.post(
  '/admin/branches/:id/admin',
  validate({ params: idParamsSchema, body: createBranchAdminSchema }),
  branchesController.createAdmin,
);
