import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validBody, validQuery } from '../../middleware/validate';
import {
  createDiscountRequestSchema,
  decideDiscountRequestSchema,
  discountRequestListQuerySchema,
} from './discount-requests.schemas';
import { discountRequestsService } from './discount-requests.service';

export const discountRequestsRouter = Router();

const path = '/branch/discount-requests';
const byId = validate({ params: idParamsSchema });

discountRequestsRouter.get(
  path,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  requirePermission('sales.view'),
  validate({ query: discountRequestListQuerySchema }),
  async (req, res) => {
    sendOk(
      res,
      await discountRequestsService.list(
        req.branchId ?? null,
        validQuery(req, discountRequestListQuerySchema),
      ),
    );
  },
);

discountRequestsRouter.post(
  path,
  authenticate,
  branchScope(),
  requirePermission('sales.create'),
  validate({ body: createDiscountRequestSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await discountRequestsService.create(
        actorFrom(req),
        branchIdOf(req),
        validBody(req, createDiscountRequestSchema),
      ),
    );
  },
);

discountRequestsRouter.post(
  `${path}/:id/cancel`,
  authenticate,
  branchScope(),
  requirePermission('sales.create'),
  byId,
  async (req, res) => {
    sendOk(res, await discountRequestsService.cancel(actorFrom(req), branchIdOf(req), idOf(req)));
  },
);

discountRequestsRouter.get(
  '/admin/discount-requests/pending-count',
  authenticate,
  requireRole(),
  async (_req, res) => {
    sendOk(res, await discountRequestsService.pendingCount());
  },
);

for (const action of ['approve', 'reject'] as const) {
  discountRequestsRouter.post(
    `/admin/discount-requests/:id/${action}`,
    authenticate,
    requireRole(),
    byId,
    validate({ body: decideDiscountRequestSchema }),
    async (req, res) => {
      sendOk(
        res,
        await discountRequestsService.decide(
          actorFrom(req),
          idOf(req),
          action === 'approve',
          validBody(req, decideDiscountRequestSchema).note,
        ),
      );
    },
  );
}
