import { Router, type Request, type Response } from 'express';
import { sendOk } from '../../lib/http';
import { branchIdOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validParams, validQuery } from '../../middleware/validate';
import {
  inventoryReportQuerySchema,
  productLedgerQuerySchema,
  productParamsSchema,
  stockBalanceQuerySchema,
} from './inventory.schemas';
import { inventoryService } from './inventory.service';

export const inventoryRouter = Router();

const path = '/branch/inventory';
const canViewStock = requirePermission('stock.view', 'inventoryReport.view');

inventoryRouter.use(path, authenticate, branchScope());

inventoryRouter.get(
  `${path}/stock`,
  canViewStock,
  validate({ query: stockBalanceQuerySchema }),
  async (req: Request, res: Response) => {
    const { items, meta } = await inventoryService.stock(
      branchIdOf(req),
      validQuery(req, stockBalanceQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

inventoryRouter.get(
  `${path}/report`,
  canViewStock,
  validate({ query: inventoryReportQuerySchema }),
  async (req: Request, res: Response) => {
    sendOk(res, await inventoryService.report(branchIdOf(req), validQuery(req, inventoryReportQuerySchema)));
  },
);

inventoryRouter.get(
  `${path}/products/:productId/ledger`,
  canViewStock,
  validate({ params: productParamsSchema, query: productLedgerQuerySchema }),
  async (req: Request, res: Response) => {
    const { productId } = validParams(req, productParamsSchema);
    sendOk(
      res,
      await inventoryService.productLedger(
        branchIdOf(req),
        productId,
        validQuery(req, productLedgerQuerySchema),
      ),
    );
  },
);
