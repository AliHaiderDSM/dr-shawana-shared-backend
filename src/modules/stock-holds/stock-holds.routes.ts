import { Router, type Request } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validQuery } from '../../middleware/validate';
import {
  decideStockHoldSchema,
  reportStockHoldSchema,
  stockHoldListQuerySchema,
} from './stock-holds.schemas';
import { stockHoldsService, type HoldViewer } from './stock-holds.service';

export const stockHoldsRouter = Router();

const path = '/branch/stock-holds';
const canView = requirePermission('stock.view', 'inventoryReport.view', 'sales.update');

const viewerOf = (req: Request): HoldViewer => ({
  isSuperAdmin: Boolean(req.auth?.isSuperAdmin),
  role: req.auth!.role,
  branchId: req.auth!.branchId,
});

stockHoldsRouter.get(
  path,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  validate({ query: stockHoldListQuerySchema }),
  async (req, res) => {
    sendOk(res, await stockHoldsService.list(viewerOf(req), validQuery(req, stockHoldListQuerySchema)));
  },
);

stockHoldsRouter.get(
  `${path}/open-count`,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  async (req, res) => {
    sendOk(res, await stockHoldsService.openCount(viewerOf(req)));
  },
);

stockHoldsRouter.post(
  path,
  authenticate,
  branchScope(),
  canView,
  validate({ body: reportStockHoldSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await stockHoldsService.report(actorFrom(req), branchIdOf(req), validBody(req, reportStockHoldSchema)),
    );
  },
);

stockHoldsRouter.post(
  `${path}/:id/decide`,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  canView,
  validate({ params: idParamsSchema, body: decideStockHoldSchema }),
  async (req, res) => {
    sendOk(
      res,
      await stockHoldsService.decide(actorFrom(req), idOf(req), validBody(req, decideStockHoldSchema)),
    );
  },
);
