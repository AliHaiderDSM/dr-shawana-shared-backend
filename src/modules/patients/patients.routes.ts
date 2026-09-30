import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { doctorsService } from '../doctors/doctors.service';
import {
  citySuggestionQuerySchema,
  createPatientSchema,
  medicalFileParamsSchema,
  patientListQuerySchema,
  patientSearchQuerySchema,
  phoneCheckQuerySchema,
  updatePatientSchema,
} from './patients.schemas';
import { patientTimeline } from './patient-timeline';
import { patientsService } from './patients.service';

export const patientsRouter = Router();

const path = '/branch/patients';
const byId = validate({ params: idParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`patients.${action}`);

patientsRouter.get(
  `${path}/:id/timeline`,
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  requirePermission('consultations.view'),
  byId,
  async (req, res) => {
    sendOk(res, await patientTimeline(actorFrom(req), req.branchId ?? null, idOf(req)));
  },
);

patientsRouter.use(path, authenticate, branchScope());

patientsRouter.get(path, can('view'), validate({ query: patientListQuerySchema }), async (req, res) => {
  const { items, meta } = await patientsService.list(
    branchIdOf(req),
    validQuery(req, patientListQuerySchema),
  );
  sendOk(res, items, meta);
});

patientsRouter.get(
  `${path}/options`,
  requirePermission('patients.view', 'appointments.view'),
  validate({ query: patientSearchQuerySchema }),
  async (req, res) => {
    const { search } = validQuery(req, patientSearchQuerySchema);
    sendOk(res, await patientsService.options(branchIdOf(req), search));
  },
);

patientsRouter.get(
  `${path}/check-phone`,
  requirePermission('patients.view', 'appointments.view'),
  validate({ query: phoneCheckQuerySchema }),
  async (req, res) => {
    const { phone, excludeId } = validQuery(req, phoneCheckQuerySchema);
    sendOk(res, await patientsService.checkPhone(phone, excludeId));
  },
);

patientsRouter.get(
  `${path}/cities`,
  requirePermission('patients.view', 'appointments.view'),
  validate({ query: citySuggestionQuerySchema }),
  async (req, res) => {
    sendOk(res, await patientsService.cities(validQuery(req, citySuggestionQuerySchema).search));
  },
);

patientsRouter.post(path, can('create'), validate({ body: createPatientSchema }), async (req, res) => {
  const input = validBody(req, createPatientSchema);
  sendCreated(res, await patientsService.create(actorFrom(req), branchIdOf(req), input));
});

patientsRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await patientsService.get(idOf(req)));
});

patientsRouter.get(`${path}/:id/summary`, can('view'), byId, async (req, res) => {
  const viewer = await doctorsService.viewer(actorFrom(req), branchIdOf(req));
  sendOk(res, await patientsService.summary(viewer, idOf(req)));
});

patientsRouter.get(
  `${path}/:id/medical-records/files/:fileId/url`,
  can('view'),
  validate({ params: medicalFileParamsSchema }),
  async (req, res) => {
    const { id, fileId } = validParams(req, medicalFileParamsSchema);
    const viewer = await doctorsService.viewer(actorFrom(req), branchIdOf(req));
    sendOk(res, await patientsService.medicalFileUrl(viewer, id, fileId));
  },
);

patientsRouter.patch(
  `${path}/:id`,
  can('update'),
  validate({ params: idParamsSchema, body: updatePatientSchema }),
  async (req, res) => {
    const input = validBody(req, updatePatientSchema);
    sendOk(res, await patientsService.update(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

patientsRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await patientsService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});
