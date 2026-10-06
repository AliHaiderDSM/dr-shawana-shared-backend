import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validParams } from '../../middleware/validate';
import { doctorsService } from '../doctors/doctors.service';
import { tokenFileParamsSchema, tokenParamsSchema } from './patient-links.schemas';
import { patientLinksService } from './patient-links.service';

export const patientLinksRouter = Router();

patientLinksRouter.get(
  '/branch/appointments/:id/patient-link',
  authenticate,
  branchScope(),
  requirePermission('consultations.view'),
  validate({ params: idParamsSchema }),
  async (req, res) => {
    const viewer = await doctorsService.viewer(actorFrom(req), branchIdOf(req));
    sendOk(res, await patientLinksService.create(viewer, idOf(req)));
  },
);

patientLinksRouter.get(
  '/public/patient-history/:token',
  validate({ params: tokenParamsSchema }),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendOk(res, await patientLinksService.history(validParams(req, tokenParamsSchema).token));
  },
);

patientLinksRouter.get(
  '/public/patient-history/:token/files/:fileId',
  validate({ params: tokenFileParamsSchema }),
  async (req, res) => {
    const { token, fileId } = validParams(req, tokenFileParamsSchema);
    res.setHeader('Cache-Control', 'no-store');
    sendOk(res, await patientLinksService.fileUrl(token, fileId));
  },
);
