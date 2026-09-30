import { Router, type Request, type Response } from 'express';
import { type z } from 'zod';
import { actorFrom, type Actor } from '../../lib/actor';
import { mountBranchCrud } from '../../lib/crud';
import { idParamsSchema, sendCreated, sendNoContent, sendOk, type PageMeta } from '../../lib/http';
import { type Module } from '../../lib/permissions';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { labTransfersService, productionsService } from './batches.service';
import { manufacturingReportsService } from './manufacturing-reports.service';
import {
  batchListQuerySchema,
  createLabTransferSchema,
  createMaterialCategorySchema,
  createMaterialSchema,
  createProductionSchema,
  createReceiptSchema,
  createRecipeSchema,
  finishedGoodsQuerySchema,
  materialCategoryListQuerySchema,
  materialListQuerySchema,
  materialReportQuerySchema,
  receiptListQuerySchema,
  receiptParamsSchema,
  recipeListQuerySchema,
  updateMaterialCategorySchema,
  updateMaterialSchema,
  updateReceiptSchema,
  updateRecipeSchema,
} from './manufacturing.schemas';
import { materialCategoriesService, materialsService } from './materials.service';
import { recipesService } from './recipes.service';

export const manufacturingRouter = Router();

mountBranchCrud(manufacturingRouter, {
  path: '/branch/material-categories',
  module: 'materialCategories',
  service: materialCategoriesService,
  schemas: {
    list: materialCategoryListQuerySchema,
    create: createMaterialCategorySchema,
    update: updateMaterialCategorySchema,
  },
});

const materialsPath = '/branch/materials';
const receiptOf = (req: Request) => validParams(req, receiptParamsSchema);

mountBranchCrud(manufacturingRouter, {
  path: materialsPath,
  module: 'materials',
  service: materialsService,
  schemas: { list: materialListQuerySchema, create: createMaterialSchema, update: updateMaterialSchema },
  extraItemRoutes: () => {
    manufacturingRouter.get(
      `${materialsPath}/:id/receipts`,
      requirePermission('materials.view'),
      validate({ params: idParamsSchema, query: receiptListQuerySchema }),
      async (req: Request, res: Response) => {
        const query = validQuery(req, receiptListQuerySchema);
        const { items, meta } = await materialsService.listReceipts(branchIdOf(req), idOf(req), query);
        sendOk(res, items, meta);
      },
    );
    manufacturingRouter.post(
      `${materialsPath}/:id/receipts`,
      requirePermission('materials.create'),
      validate({ params: idParamsSchema, body: createReceiptSchema }),
      async (req: Request, res: Response) => {
        const input = validBody(req, createReceiptSchema);
        sendCreated(
          res,
          await materialsService.addReceipt(actorFrom(req), branchIdOf(req), idOf(req), input),
        );
      },
    );
    manufacturingRouter.patch(
      `${materialsPath}/:id/receipts/:receiptId`,
      requirePermission('materials.update'),
      validate({ params: receiptParamsSchema, body: updateReceiptSchema }),
      async (req: Request, res: Response) => {
        const { id, receiptId } = receiptOf(req);
        const input = validBody(req, updateReceiptSchema);
        sendOk(
          res,
          await materialsService.updateReceipt(actorFrom(req), branchIdOf(req), id, receiptId, input),
        );
      },
    );
    manufacturingRouter.delete(
      `${materialsPath}/:id/receipts/:receiptId`,
      requirePermission('materials.delete'),
      validate({ params: receiptParamsSchema }),
      async (req: Request, res: Response) => {
        const { id, receiptId } = receiptOf(req);
        await materialsService.removeReceipt(actorFrom(req), branchIdOf(req), id, receiptId);
        sendNoContent(res);
      },
    );
  },
});

mountBranchCrud(manufacturingRouter, {
  path: '/branch/recipes',
  module: 'recipes',
  service: recipesService,
  schemas: { list: recipeListQuerySchema, create: createRecipeSchema, update: updateRecipeSchema },
});

interface BatchService {
  list: (
    branchId: string,
    query: z.output<typeof batchListQuerySchema>,
  ) => Promise<{ items: unknown[]; meta: PageMeta }>;
  get: (branchId: string, id: string) => Promise<unknown>;
  create: (actor: Actor, branchId: string, input: never) => Promise<unknown>;
  remove: (actor: Actor, branchId: string, id: string) => Promise<void>;
}

function mountBatchRoutes(
  path: string,
  module: Extract<Module, 'labTransfers' | 'production'>,
  service: BatchService,
  createSchema: typeof createLabTransferSchema | typeof createProductionSchema,
  extra?: () => void,
) {
  const byId = validate({ params: idParamsSchema });
  manufacturingRouter.use(path, authenticate, branchScope());
  extra?.();
  manufacturingRouter.get(
    path,
    requirePermission(`${module}.view`),
    validate({ query: batchListQuerySchema }),
    async (req: Request, res: Response) => {
      const { items, meta } = await service.list(branchIdOf(req), validQuery(req, batchListQuerySchema));
      sendOk(res, items, meta);
    },
  );
  manufacturingRouter.post(
    path,
    requirePermission(`${module}.create`),
    validate({ body: createSchema }),
    async (req: Request, res: Response) => {
      sendCreated(
        res,
        await service.create(actorFrom(req), branchIdOf(req), validBody(req, createSchema) as never),
      );
    },
  );
  manufacturingRouter.get(`${path}/:id`, requirePermission(`${module}.view`), byId, async (req, res) => {
    sendOk(res, await service.get(branchIdOf(req), idOf(req)));
  });
  manufacturingRouter.delete(`${path}/:id`, requirePermission(`${module}.delete`), byId, async (req, res) => {
    await service.remove(actorFrom(req), branchIdOf(req), idOf(req));
    sendNoContent(res);
  });
}

mountBatchRoutes('/branch/lab-transfers', 'labTransfers', labTransfersService, createLabTransferSchema, () =>
  manufacturingRouter.get(
    '/branch/lab-transfers/options',
    requirePermission('labTransfers.view', 'production.view'),
    async (req: Request, res: Response) => sendOk(res, await labTransfersService.options(branchIdOf(req))),
  ),
);

mountBatchRoutes('/branch/productions', 'production', productionsService, createProductionSchema);

const reportsPath = '/branch/manufacturing';
manufacturingRouter.use(reportsPath, authenticate, branchScope());

manufacturingRouter.get(
  `${reportsPath}/material-report`,
  requirePermission('materialReport.view'),
  validate({ query: materialReportQuerySchema }),
  async (req: Request, res: Response) => {
    sendOk(
      res,
      await manufacturingReportsService.materialReport(
        branchIdOf(req),
        validQuery(req, materialReportQuerySchema),
      ),
    );
  },
);

manufacturingRouter.get(
  `${reportsPath}/finished-goods`,
  requirePermission('finishedGoods.view'),
  validate({ query: finishedGoodsQuerySchema }),
  async (req: Request, res: Response) => {
    sendOk(
      res,
      await manufacturingReportsService.finishedGoods(
        branchIdOf(req),
        validQuery(req, finishedGoodsQuerySchema),
      ),
    );
  },
);
