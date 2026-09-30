import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { mountBranchCrud } from '../../lib/crud';
import { idParamsSchema, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { imageUpload, requireFile } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { requireRole } from '../../middleware/requireRole';
import { validate, validQuery } from '../../middleware/validate';
import {
  createDoctorSchema,
  doctorListQuerySchema,
  doctorSlotsQuerySchema,
  updateDoctorSchema,
} from './doctors.schemas';
import { doctorsService } from './doctors.service';

export const doctorsRouter = Router();

const scoped = [authenticate, branchScope()];
const canBook = requirePermission('doctors.view', 'appointments.view');

doctorsRouter.get('/branch/doctors/options', ...scoped, canBook, async (req, res) => {
  sendOk(res, await doctorsService.options(branchIdOf(req)));
});

doctorsRouter.get('/branch/doctors/me', ...scoped, requireRole('doctor'), async (req, res) => {
  sendOk(res, await doctorsService.me(actorFrom(req), branchIdOf(req)));
});

doctorsRouter.get(
  '/branch/doctors/:id/slots',
  ...scoped,
  canBook,
  validate({ params: idParamsSchema, query: doctorSlotsQuerySchema }),
  async (req, res) => {
    const viewer = await doctorsService.viewer(actorFrom(req), branchIdOf(req));
    const { date } = validQuery(req, doctorSlotsQuerySchema);
    sendOk(res, await doctorsService.slots(viewer, idOf(req), date));
  },
);

doctorsRouter.post(
  '/branch/doctors/:id/signature',
  ...scoped,
  requirePermission('doctors.update'),
  validate({ params: idParamsSchema }),
  imageUpload('image'),
  async (req, res) => {
    sendOk(
      res,
      await doctorsService.setSignature(actorFrom(req), branchIdOf(req), idOf(req), requireFile(req)),
    );
  },
);

doctorsRouter.get(
  '/branch/doctors/:id/signature-url',
  ...scoped,
  requirePermission('doctors.view', 'prescriptions.view'),
  validate({ params: idParamsSchema }),
  async (req, res) => {
    sendOk(res, await doctorsService.signatureUrl(branchIdOf(req), idOf(req)));
  },
);

mountBranchCrud(doctorsRouter, {
  path: '/branch/doctors',
  module: 'doctors',
  service: doctorsService,
  schemas: { list: doctorListQuerySchema, create: createDoctorSchema, update: updateDoctorSchema },
});
