import { Router } from 'express';
import { mountBranchCrud } from '../../lib/crud';
import {
  createSupplierSchema,
  supplierListQuerySchema,
  supplierOptionsQuerySchema,
  updateSupplierSchema,
} from './suppliers.schemas';
import { suppliersService } from './suppliers.service';

export const suppliersRouter = Router();

mountBranchCrud(suppliersRouter, {
  path: '/branch/suppliers',
  module: 'suppliers',
  service: suppliersService,
  schemas: {
    list: supplierListQuerySchema,
    create: createSupplierSchema,
    update: updateSupplierSchema,
    options: supplierOptionsQuerySchema,
  },
});
