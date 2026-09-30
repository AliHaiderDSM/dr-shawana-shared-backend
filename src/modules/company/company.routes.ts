import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { companyController } from './company.controller';
import { updateCompanyInfoSchema } from './company.schemas';

export const companyRouter = Router();

companyRouter.use('/admin/company-info', authenticate, requireRole('super_admin'));

companyRouter.get('/admin/company-info', companyController.get);
companyRouter.put(
  '/admin/company-info',
  validate({ body: updateCompanyInfoSchema }),
  companyController.update,
);
