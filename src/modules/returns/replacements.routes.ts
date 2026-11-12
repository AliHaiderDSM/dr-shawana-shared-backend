import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validBody, validQuery } from '../../middleware/validate';
import { replacementListQuerySchema, sendReplacementSchema } from './replacements.schemas';
import { replacementsService } from './replacements.service';

export const replacementsRouter = Router();

const path = '/branch/replacements';
const byId = validate({ params: idParamsSchema });
const sender = requireRole('branch_admin', 'dispatcher');

replacementsRouter.use(path, authenticate, (req, res, next) =>
  branchScope({ allowAllForSuperAdmin: req.method === 'GET' })(req, res, next),
);

replacementsRouter.get(
  path,
  requirePermission('returns.view'),
  validate({ query: replacementListQuerySchema }),
  async (req, res) => {
    const { items, meta } = await replacementsService.list(
      req.branchId ?? null,
      validQuery(req, replacementListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

replacementsRouter.get(`${path}/:id`, requirePermission('returns.view'), byId, async (req, res) => {
  sendOk(res, await replacementsService.get(req.branchId ?? null, idOf(req)));
});

replacementsRouter.post(
  `${path}/:id/send`,
  sender,
  validate({ params: idParamsSchema, body: sendReplacementSchema }),
  async (req, res) => {
    sendOk(
      res,
      await replacementsService.send(
        actorFrom(req),
        branchIdOf(req),
        idOf(req),
        validBody(req, sendReplacementSchema),
      ),
    );
  },
);

replacementsRouter.delete(`${path}/:id`, sender, byId, async (req, res) => {
  await replacementsService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});
