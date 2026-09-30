import { Router } from 'express';
import { mountBranchCrud } from '../../lib/crud';
import { idParamsSchema } from '../../lib/http';
import { imageUpload } from '../../lib/upload';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { productExtrasController, purchaseListQuerySchema } from './products.controller';
import {
  createProductSchema,
  createPurchaseSchema,
  productListQuerySchema,
  purchaseParamsSchema,
  updateProductSchema,
  updatePurchaseSchema,
} from './products.schemas';
import { productsService } from './products.service';

export const productsRouter = Router();

const path = '/branch/products';

mountBranchCrud(productsRouter, {
  path,
  module: 'products',
  service: productsService,
  schemas: { list: productListQuerySchema, create: createProductSchema, update: updateProductSchema },
  extraItemRoutes: (byId) => {
    productsRouter.post(
      `${path}/:id/image`,
      requirePermission('products.update'),
      byId,
      imageUpload('image'),
      productExtrasController.uploadImage,
    );
    productsRouter.get(
      `${path}/:id/purchases`,
      requirePermission('products.view'),
      validate({ params: idParamsSchema, query: purchaseListQuerySchema }),
      productExtrasController.listPurchases,
    );
    productsRouter.post(
      `${path}/:id/purchases`,
      requirePermission('products.create'),
      validate({ params: idParamsSchema, body: createPurchaseSchema }),
      productExtrasController.addPurchase,
    );
    productsRouter.patch(
      `${path}/:id/purchases/:entryId`,
      requirePermission('products.update'),
      validate({ params: purchaseParamsSchema, body: updatePurchaseSchema }),
      productExtrasController.updatePurchase,
    );
    productsRouter.delete(
      `${path}/:id/purchases/:entryId`,
      requirePermission('products.delete'),
      validate({ params: purchaseParamsSchema }),
      productExtrasController.removePurchase,
    );
  },
});
