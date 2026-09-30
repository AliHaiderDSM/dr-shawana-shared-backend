import { Router, type Request, type Response } from 'express';
import { type z } from 'zod';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { documentsUpload, jsonDataField, uploadedFiles } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { StockIn } from './stock-in.entity';
import { StockOut } from './stock-out.entity';
import {
  attachmentParamsSchema,
  createStockInSchema,
  createStockOutSchema,
  stockInListQuerySchema,
  stockOutListQuerySchema,
  updateStockInSchema,
  updateStockOutSchema,
} from './stock-documents.schemas';
import { createStockDocumentService } from './stock-documents.service';

export const stockInService = createStockDocumentService({
  kind: 'stock_in',
  entity: StockIn,
  label: 'Stock in entry',
  partyKey: 'supplierId',
  partyRelation: 'supplier',
  partyType: 'supplier',
  sign: 1,
  destinationFilter: false,
});

export const stockOutService = createStockDocumentService({
  kind: 'stock_out',
  entity: StockOut,
  label: 'Stock out entry',
  partyKey: 'dispatcherId',
  partyRelation: 'dispatcher',
  partyType: 'dispatcher',
  sign: -1,
  destinationFilter: true,
});

type StockDocumentService = typeof stockInService;

export const stockDocumentsRouter = Router();

function mountDocumentRoutes(
  path: string,
  service: StockDocumentService,
  schemas: { list: z.ZodType; create: z.ZodType; update: z.ZodType },
) {
  const byId = validate({ params: idParamsSchema });
  const byAttachment = validate({ params: attachmentParamsSchema });
  const attachmentOf = (req: Request) => validParams(req, attachmentParamsSchema);

  stockDocumentsRouter.use(path, authenticate, branchScope());

  stockDocumentsRouter.get(
    path,
    requirePermission('stock.view'),
    validate({ query: schemas.list }),
    async (req: Request, res: Response) => {
      const { items, meta } = await service.list(branchIdOf(req), validQuery(req, schemas.list) as never);
      sendOk(res, items, meta);
    },
  );

  stockDocumentsRouter.post(
    path,
    requirePermission('stock.create'),
    documentsUpload('files'),
    jsonDataField,
    validate({ body: schemas.create }),
    async (req: Request, res: Response) => {
      const input = validBody(req, schemas.create) as never;
      sendCreated(res, await service.create(actorFrom(req), branchIdOf(req), input, uploadedFiles(req)));
    },
  );

  stockDocumentsRouter.get(`${path}/:id`, requirePermission('stock.view'), byId, async (req, res) => {
    sendOk(res, await service.get(branchIdOf(req), idOf(req)));
  });

  stockDocumentsRouter.patch(
    `${path}/:id`,
    requirePermission('stock.update'),
    validate({ params: idParamsSchema, body: schemas.update }),
    async (req: Request, res: Response) => {
      const input = validBody(req, schemas.update) as never;
      sendOk(res, await service.update(actorFrom(req), branchIdOf(req), idOf(req), input));
    },
  );

  stockDocumentsRouter.delete(`${path}/:id`, requirePermission('stock.delete'), byId, async (req, res) => {
    await service.remove(actorFrom(req), branchIdOf(req), idOf(req));
    sendNoContent(res);
  });

  stockDocumentsRouter.post(
    `${path}/:id/attachments`,
    requirePermission('stock.update'),
    byId,
    documentsUpload('files'),
    async (req: Request, res: Response) => {
      sendOk(
        res,
        await service.addAttachments(actorFrom(req), branchIdOf(req), idOf(req), uploadedFiles(req)),
      );
    },
  );

  stockDocumentsRouter.get(
    `${path}/:id/attachments/:attachmentId/url`,
    requirePermission('stock.view'),
    byAttachment,
    async (req: Request, res: Response) => {
      const { id, attachmentId } = attachmentOf(req);
      sendOk(res, await service.attachmentUrl(branchIdOf(req), id, attachmentId));
    },
  );

  stockDocumentsRouter.delete(
    `${path}/:id/attachments/:attachmentId`,
    requirePermission('stock.update'),
    byAttachment,
    async (req: Request, res: Response) => {
      const { id, attachmentId } = attachmentOf(req);
      await service.removeAttachment(actorFrom(req), branchIdOf(req), id, attachmentId);
      sendNoContent(res);
    },
  );
}

mountDocumentRoutes('/branch/stock-ins', stockInService, {
  list: stockInListQuerySchema,
  create: createStockInSchema,
  update: updateStockInSchema,
});

mountDocumentRoutes('/branch/stock-outs', stockOutService as unknown as StockDocumentService, {
  list: stockOutListQuerySchema,
  create: createStockOutSchema,
  update: updateStockOutSchema,
});
