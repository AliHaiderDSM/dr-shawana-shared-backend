import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { documentsUpload, jsonDataField, uploadedFiles } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { idempotent } from '../../middleware/idempotency';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import {
  createDirectReplacementSchema,
  decideReplacementSchema,
  replacementFileParamsSchema,
  replacementListQuerySchema,
  sendReplacementSchema,
} from './replacements.schemas';
import { replacementsService } from './replacements.service';

export const replacementsRouter = Router();

const path = '/branch/replacements';
const byId = validate({ params: idParamsSchema });
const requester = requireRole('branch_admin', 'dispatcher');

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

replacementsRouter.get(
  `${path}/:id/files/:fileId/url`,
  requirePermission('returns.view'),
  validate({ params: replacementFileParamsSchema }),
  async (req, res) => {
    const { id, fileId } = validParams(req, replacementFileParamsSchema);
    sendOk(res, await replacementsService.fileUrl(req.branchId ?? null, id, fileId));
  },
);

replacementsRouter.post(
  `${path}/:id/send`,
  requester,
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

replacementsRouter.delete(`${path}/:id`, requester, byId, async (req, res) => {
  await replacementsService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});

replacementsRouter.get(
  '/branch/sales/:id/replaceable',
  authenticate,
  branchScope(),
  requirePermission('returns.view'),
  byId,
  async (req, res) => {
    sendOk(res, await replacementsService.replaceable(branchIdOf(req), idOf(req)));
  },
);

replacementsRouter.post(
  '/branch/sales/:id/replacements',
  authenticate,
  branchScope(),
  requester,
  idempotent('replacement-create'),
  byId,
  documentsUpload('files'),
  jsonDataField,
  validate({ body: createDirectReplacementSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await replacementsService.createForSale(
        actorFrom(req),
        branchIdOf(req),
        idOf(req),
        validBody(req, createDirectReplacementSchema),
        uploadedFiles(req),
      ),
    );
  },
);

for (const action of ['approve', 'reject'] as const) {
  replacementsRouter.post(
    `/admin/replacements/:id/${action}`,
    authenticate,
    requireRole(),
    byId,
    validate({ body: decideReplacementSchema }),
    async (req, res) => {
      sendOk(
        res,
        await replacementsService.decide(
          actorFrom(req),
          idOf(req),
          action === 'approve',
          validBody(req, decideReplacementSchema).note,
        ),
      );
    },
  );
}
