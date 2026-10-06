import { Router, type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { sendCreated, sendOk } from '../../lib/http';
import { branchIdOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import {
  expiryAlertsQuerySchema,
  inventoryReportQuerySchema,
  productLedgerQuerySchema,
  productParamsSchema,
  stockBalanceQuerySchema,
} from './inventory.schemas';
import {
  inventoryItemListQuerySchema,
  itemParamsSchema,
  labelBatchListQuerySchema,
  productSerialParamsSchema,
  registerLabelsSchema,
  serialParamsSchema,
} from './inventory-items.schemas';
import { inventoryItemsService } from './inventory-items.service';
import { inventoryService } from './inventory.service';
import { batchListQuerySchema, batchParamsSchema, writeOffSchema } from './product-batches.schemas';
import { productBatchesService } from './product-batches.service';

export const inventoryRouter = Router();

const path = '/branch/inventory';
const canViewStock = requirePermission('stock.view', 'inventoryReport.view');

inventoryRouter.use(path, authenticate, (req, res, next) =>
  branchScope({
    allowAllForSuperAdmin: req.path === '/expiry-alerts' || req.path.startsWith('/items/serial/'),
  })(req, res, next),
);

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
  `${path}/expiry-alerts`,
  canViewStock,
  validate({ query: expiryAlertsQuerySchema }),
  async (req: Request, res: Response) => {
    sendOk(
      res,
      await inventoryService.expiryAlerts(req.branchId ?? null, validQuery(req, expiryAlertsQuerySchema)),
    );
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

inventoryRouter.get(
  `${path}/batches`,
  canViewStock,
  validate({ query: batchListQuerySchema }),
  async (req: Request, res: Response) => {
    const { items, meta } = await productBatchesService.list(
      branchIdOf(req),
      validQuery(req, batchListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

inventoryRouter.get(
  `${path}/batches/:batchId`,
  canViewStock,
  validate({ params: batchParamsSchema }),
  async (req: Request, res: Response) => {
    const { batchId } = validParams(req, batchParamsSchema);
    sendOk(res, await productBatchesService.get(branchIdOf(req), batchId));
  },
);

inventoryRouter.post(
  `${path}/batches/:batchId/write-off`,
  requirePermission('stock.update'),
  validate({ params: batchParamsSchema, body: writeOffSchema }),
  async (req: Request, res: Response) => {
    const { batchId } = validParams(req, batchParamsSchema);
    sendOk(
      res,
      await productBatchesService.writeOff(
        actorFrom(req),
        branchIdOf(req),
        batchId,
        validBody(req, writeOffSchema),
      ),
    );
  },
);

const canFindPieces = requirePermission(
  'stock.view',
  'inventoryReport.view',
  'sales.create',
  'returns.create',
);

inventoryRouter.get(
  `${path}/items`,
  canFindPieces,
  validate({ query: inventoryItemListQuerySchema }),
  async (req: Request, res: Response) => {
    const { items, meta } = await inventoryItemsService.list(
      branchIdOf(req),
      validQuery(req, inventoryItemListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

inventoryRouter.get(
  `${path}/items/batches`,
  canFindPieces,
  validate({ query: labelBatchListQuerySchema }),
  async (req: Request, res: Response) => {
    const { items, meta } = await inventoryItemsService.batches(
      branchIdOf(req),
      validQuery(req, labelBatchListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

inventoryRouter.post(
  `${path}/items/register`,
  requirePermission('stock.create'),
  validate({ body: registerLabelsSchema }),
  async (req: Request, res: Response) => {
    sendCreated(
      res,
      await inventoryItemsService.registerExisting(
        actorFrom(req),
        branchIdOf(req),
        validBody(req, registerLabelsSchema),
      ),
    );
  },
);

inventoryRouter.get(
  `${path}/items/serial/:serial`,
  canFindPieces,
  validate({ params: serialParamsSchema }),
  async (req: Request, res: Response) => {
    const { serial } = validParams(req, serialParamsSchema);
    const everywhere = req.query.scope === 'all' && actorFrom(req).role === 'super_admin';
    sendOk(res, await inventoryItemsService.get(everywhere ? null : branchIdOf(req), { serial }));
  },
);

inventoryRouter.get(
  `${path}/items/:itemId`,
  canFindPieces,
  validate({ params: itemParamsSchema }),
  async (req: Request, res: Response) => {
    const { itemId } = validParams(req, itemParamsSchema);
    sendOk(res, await inventoryItemsService.get(branchIdOf(req), { id: itemId }));
  },
);

inventoryRouter.get(
  `${path}/products/:productId/serials`,
  canViewStock,
  validate({ params: productSerialParamsSchema }),
  async (req: Request, res: Response) => {
    const { productId } = validParams(req, productSerialParamsSchema);
    sendOk(res, await inventoryItemsService.summary(branchIdOf(req), productId));
  },
);
