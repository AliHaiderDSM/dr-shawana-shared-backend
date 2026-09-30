import { Router, type Request } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { doctorsService } from '../doctors/doctors.service';
import {
  consultationListQuerySchema,
  consultationStatusSchema,
  sectionParamsSchema,
} from './consultations.schemas';
import { consultationsService } from './consultations.service';

export const consultationsRouter = Router();

const path = '/branch/consultations';
const scoped = [authenticate, branchScope()];
const byId = validate({ params: idParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`consultations.${action}`);
const viewerOf = (req: Request) => doctorsService.viewer(actorFrom(req), branchIdOf(req));

consultationsRouter.post(
  '/branch/appointments/:id/consultation',
  ...scoped,
  can('create'),
  byId,
  async (req, res) => {
    const { created, consultation } = await consultationsService.open(
      actorFrom(req),
      await viewerOf(req),
      idOf(req),
    );
    if (created) sendCreated(res, consultation);
    else sendOk(res, consultation);
  },
);

consultationsRouter.get(
  '/branch/appointments/:id/consultation',
  ...scoped,
  can('view'),
  byId,
  async (req, res) => {
    sendOk(res, await consultationsService.forAppointment(await viewerOf(req), idOf(req)));
  },
);

consultationsRouter.get(
  '/branch/patients/:id/mrs-history',
  ...scoped,
  can('view'),
  byId,
  async (req, res) => {
    sendOk(res, await consultationsService.mrsHistory(await viewerOf(req), idOf(req)));
  },
);

consultationsRouter.use(path, ...scoped);

consultationsRouter.get(
  path,
  can('view'),
  validate({ query: consultationListQuerySchema }),
  async (req, res) => {
    const { items, meta } = await consultationsService.list(
      await viewerOf(req),
      validQuery(req, consultationListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

consultationsRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await consultationsService.get(await viewerOf(req), idOf(req)));
});

consultationsRouter.put(
  `${path}/:id/sections/:key`,
  can('update'),
  validate({ params: sectionParamsSchema }),
  async (req, res) => {
    const { id, key } = validParams(req, sectionParamsSchema);
    sendOk(
      res,
      await consultationsService.saveSection(actorFrom(req), await viewerOf(req), id, key, req.body),
    );
  },
);

consultationsRouter.post(
  `${path}/:id/status`,
  can('update'),
  validate({ params: idParamsSchema, body: consultationStatusSchema }),
  async (req, res) => {
    const { status } = validBody(req, consultationStatusSchema);
    sendOk(res, await consultationsService.setStatus(actorFrom(req), await viewerOf(req), idOf(req), status));
  },
);

consultationsRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await consultationsService.remove(actorFrom(req), await viewerOf(req), idOf(req));
  sendNoContent(res);
});

consultationsRouter.get(`${path}/:id/referral-letter`, can('view'), byId, async (req, res) => {
  sendOk(res, await consultationsService.referralLetter(await viewerOf(req), idOf(req)));
});
