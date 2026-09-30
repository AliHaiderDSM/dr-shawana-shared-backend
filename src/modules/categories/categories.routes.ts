import { Router } from 'express';
import { mountBranchCrud } from '../../lib/crud';
import { imageUpload } from '../../lib/upload';
import { requirePermission } from '../../middleware/requirePermission';
import { categoryImageController } from './categories.controller';
import { categoryListQuerySchema, createCategorySchema, updateCategorySchema } from './categories.schemas';
import { categoriesService } from './categories.service';

export const categoriesRouter = Router();

const path = '/branch/categories';

mountBranchCrud(categoriesRouter, {
  path,
  module: 'categories',
  service: categoriesService,
  schemas: { list: categoryListQuerySchema, create: createCategorySchema, update: updateCategorySchema },
  extraItemRoutes: (byId) =>
    categoriesRouter.post(
      `${path}/:id/image`,
      requirePermission('categories.update'),
      byId,
      imageUpload('image'),
      categoryImageController.upload,
    ),
});
