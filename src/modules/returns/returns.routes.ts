import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import {
  createReturnSchema,
  resolveItemSchema,
  returnItemParamsSchema,
  returnListQuerySchema,
  saleParamsSchema,
  setRefundSchema,
} from './returns.schemas';
import { returnsService } from './returns.service';

export const returnsRouter = Router();

const path = '/branch/returns';
const byId = validate({ params: idParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`returns.${action}`);

returnsRouter.use(path, authenticate, branchScope());

returnsRouter.get(path, can('view'), validate({ query: returnListQuerySchema }), async (req, res) => {
  const { items, meta } = await returnsService.list(branchIdOf(req), validQuery(req, returnListQuerySchema));
  sendOk(res, items, meta);
});

returnsRouter.get(
  `${path}/sale/:saleId/returnable`,
  requirePermission('returns.view', 'returns.create'),
  validate({ params: saleParamsSchema }),
  async (req, res) => {
    const { saleId } = validParams(req, saleParamsSchema);
    sendOk(res, await returnsService.returnable(branchIdOf(req), saleId));
  },
);

returnsRouter.post(path, can('create'), validate({ body: createReturnSchema }), async (req, res) => {
  sendCreated(
    res,
    await returnsService.create(actorFrom(req), branchIdOf(req), validBody(req, createReturnSchema)),
  );
});

returnsRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await returnsService.get(branchIdOf(req), idOf(req)));
});

returnsRouter.post(
  `${path}/:id/items/:itemId/resolve`,
  can('update'),
  validate({ params: returnItemParamsSchema, body: resolveItemSchema }),
  async (req, res) => {
    const { id, itemId } = validParams(req, returnItemParamsSchema);
    sendOk(
      res,
      await returnsService.resolveItem(
        actorFrom(req),
        branchIdOf(req),
        id,
        itemId,
        validBody(req, resolveItemSchema),
      ),
    );
  },
);

returnsRouter.put(
  `${path}/:id/refund`,
  requirePermission('returns.update', 'returns.create'),
  validate({ params: idParamsSchema, body: setRefundSchema }),
  async (req, res) => {
    const { refund } = validBody(req, setRefundSchema);
    sendOk(res, await returnsService.setRefund(actorFrom(req), branchIdOf(req), idOf(req), refund));
  },
);

returnsRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await returnsService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});
