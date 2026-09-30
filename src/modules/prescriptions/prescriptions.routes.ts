import { Router, type Request } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validBody, validQuery } from '../../middleware/validate';
import { doctorsService } from '../doctors/doctors.service';
import {
  catalogQuerySchema,
  createCatalogItemSchema,
  createPrescriptionSchema,
  prescriptionListQuerySchema,
  updateCatalogItemSchema,
  updatePrescriptionSchema,
} from './prescriptions.schemas';
import { catalogService, prescriptionsService } from './prescriptions.service';

export const prescriptionsRouter = Router();

const catalogPath = '/branch/prescription-catalog';
const path = '/branch/prescriptions';
const byId = validate({ params: idParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`prescriptions.${action}`);
const branchAdmin = requireRole('branch_admin');
const viewerOf = (req: Request) => doctorsService.viewer(actorFrom(req), branchIdOf(req));

prescriptionsRouter.use(catalogPath, authenticate, branchScope());
prescriptionsRouter.use(path, authenticate, branchScope());

prescriptionsRouter.get(
  catalogPath,
  can('view'),
  validate({ query: catalogQuerySchema }),
  async (req, res) => {
    sendOk(res, await catalogService.list(branchIdOf(req), validQuery(req, catalogQuerySchema)));
  },
);

prescriptionsRouter.post(
  catalogPath,
  branchAdmin,
  validate({ body: createCatalogItemSchema }),
  async (req, res) => {
    const input = validBody(req, createCatalogItemSchema);
    sendCreated(res, await catalogService.create(actorFrom(req), branchIdOf(req), input));
  },
);

prescriptionsRouter.patch(
  `${catalogPath}/:id`,
  branchAdmin,
  validate({ params: idParamsSchema, body: updateCatalogItemSchema }),
  async (req, res) => {
    const input = validBody(req, updateCatalogItemSchema);
    sendOk(res, await catalogService.update(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

prescriptionsRouter.delete(`${catalogPath}/:id`, branchAdmin, byId, async (req, res) => {
  await catalogService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});

prescriptionsRouter.get(
  path,
  can('view'),
  validate({ query: prescriptionListQuerySchema }),
  async (req, res) => {
    const { items, meta } = await prescriptionsService.list(
      await viewerOf(req),
      validQuery(req, prescriptionListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

prescriptionsRouter.post(
  path,
  can('create'),
  validate({ body: createPrescriptionSchema }),
  async (req, res) => {
    const input = validBody(req, createPrescriptionSchema);
    sendCreated(res, await prescriptionsService.create(actorFrom(req), await viewerOf(req), input));
  },
);

prescriptionsRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await prescriptionsService.get(await viewerOf(req), idOf(req)));
});

prescriptionsRouter.get(`${path}/:id/print`, can('view'), byId, async (req, res) => {
  sendOk(res, await prescriptionsService.print(await viewerOf(req), idOf(req)));
});

prescriptionsRouter.patch(
  `${path}/:id`,
  can('update'),
  validate({ params: idParamsSchema, body: updatePrescriptionSchema }),
  async (req, res) => {
    const input = validBody(req, updatePrescriptionSchema);
    sendOk(res, await prescriptionsService.update(actorFrom(req), await viewerOf(req), idOf(req), input));
  },
);

prescriptionsRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await prescriptionsService.remove(actorFrom(req), await viewerOf(req), idOf(req));
  sendNoContent(res);
});
