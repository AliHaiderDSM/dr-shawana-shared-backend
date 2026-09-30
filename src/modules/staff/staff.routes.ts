import { Router } from 'express';
import { idParamsSchema } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { staffController } from './staff.controller';
import {
  createStaffSchema,
  resetPasswordSchema,
  staffListQuerySchema,
  updateStaffSchema,
} from './staff.schemas';

export const staffRouter = Router();

const byId = validate({ params: idParamsSchema });

staffRouter.use('/branch/staff', authenticate, branchScope());

staffRouter.get(
  '/branch/staff',
  requirePermission('staff.view'),
  validate({ query: staffListQuerySchema }),
  staffController.list,
);
staffRouter.post(
  '/branch/staff',
  requirePermission('staff.create'),
  validate({ body: createStaffSchema }),
  staffController.create,
);
staffRouter.get('/branch/staff/:id', requirePermission('staff.view'), byId, staffController.get);
staffRouter.patch(
  '/branch/staff/:id',
  requirePermission('staff.update'),
  validate({ params: idParamsSchema, body: updateStaffSchema }),
  staffController.update,
);
staffRouter.delete('/branch/staff/:id', requirePermission('staff.delete'), byId, staffController.remove);
staffRouter.post(
  '/branch/staff/:id/reset-password',
  requirePermission('staff.update'),
  validate({ params: idParamsSchema, body: resetPasswordSchema }),
  staffController.resetPassword,
);
staffRouter.post(
  '/branch/staff/:id/activate',
  requirePermission('staff.update'),
  byId,
  staffController.activate,
);
staffRouter.post(
  '/branch/staff/:id/deactivate',
  requirePermission('staff.update'),
  byId,
  staffController.deactivate,
);
