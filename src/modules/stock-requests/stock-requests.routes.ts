import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import {
  createStockRequestSchema,
  decideStockRequestSchema,
  editStockRequestSchema,
  incomingStockQuerySchema,
  receiveStockSchema,
  stockRequestCatalogQuerySchema,
  stockRequestListQuerySchema,
  transferParamsSchema,
} from './stock-requests.schemas';
import { stockRequestsService } from './stock-requests.service';

export const stockRequestsRouter = Router();

const path = '/branch/stock-requests';
const canView = requirePermission('stock.view', 'inventoryReport.view');
const canAsk = requirePermission('stock.create', 'stock.update');
const byId = validate({ params: idParamsSchema });

stockRequestsRouter.get(
  path,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  validate({ query: stockRequestListQuerySchema }),
  async (req, res) => {
    sendOk(
      res,
      await stockRequestsService.list(req.branchId ?? null, validQuery(req, stockRequestListQuerySchema)),
    );
  },
);

stockRequestsRouter.get(
  `${path}/catalog`,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  validate({ query: stockRequestCatalogQuerySchema }),
  async (req, res) => {
    sendOk(res, await stockRequestsService.catalog(validQuery(req, stockRequestCatalogQuerySchema).search));
  },
);

stockRequestsRouter.post(
  path,
  authenticate,
  branchScope(),
  canAsk,
  validate({ body: createStockRequestSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await stockRequestsService.create(
        actorFrom(req),
        branchIdOf(req),
        validBody(req, createStockRequestSchema),
      ),
    );
  },
);

stockRequestsRouter.get(
  `${path}/:id`,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  byId,
  async (req, res) => {
    sendOk(res, await stockRequestsService.get(req.branchId ?? null, idOf(req)));
  },
);

stockRequestsRouter.post(
  `${path}/:id/cancel`,
  authenticate,
  branchScope(),
  canAsk,
  byId,
  async (req, res) => {
    sendOk(res, await stockRequestsService.cancel(actorFrom(req), branchIdOf(req), idOf(req)));
  },
);

stockRequestsRouter.get(
  '/admin/stock-requests/pending-count',
  authenticate,
  requireRole(),
  async (_req, res) => {
    sendOk(res, await stockRequestsService.pendingCount());
  },
);

for (const action of ['approve', 'reject'] as const) {
  stockRequestsRouter.post(
    `/admin/stock-requests/:id/${action}`,
    authenticate,
    requireRole(),
    byId,
    validate({ body: decideStockRequestSchema }),
    async (req, res) => {
      sendOk(
        res,
        await stockRequestsService.decide(
          actorFrom(req),
          idOf(req),
          action === 'approve',
          validBody(req, decideStockRequestSchema),
        ),
      );
    },
  );
}

stockRequestsRouter.post(
  '/admin/stock-requests/:id/edit',
  authenticate,
  requireRole(),
  byId,
  validate({ body: editStockRequestSchema }),
  async (req, res) => {
    sendOk(
      res,
      await stockRequestsService.edit(actorFrom(req), idOf(req), validBody(req, editStockRequestSchema)),
    );
  },
);

stockRequestsRouter.get(
  '/branch/incoming-stock',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  validate({ query: incomingStockQuerySchema }),
  async (req, res) => {
    sendOk(
      res,
      await stockRequestsService.incoming(req.branchId ?? null, validQuery(req, incomingStockQuerySchema)),
    );
  },
);

stockRequestsRouter.post(
  '/branch/incoming-stock/:transferNo/receive',
  authenticate,
  branchScope(),
  requireRole('branch_admin'),
  validate({ params: transferParamsSchema, body: receiveStockSchema }),
  async (req, res) => {
    sendOk(
      res,
      await stockRequestsService.receive(
        actorFrom(req),
        branchIdOf(req),
        validParams(req, transferParamsSchema).transferNo,
        validBody(req, receiveStockSchema).date,
      ),
    );
  },
);
