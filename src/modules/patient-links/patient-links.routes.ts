import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams } from '../../middleware/validate';
import { documentsUpload, jsonDataField, uploadedFiles } from '../../lib/upload';
import { doctorsService } from '../doctors/doctors.service';
import {
  publicRecordSchema,
  tokenFileParamsSchema,
  tokenParamsSchema,
  tokenSectionParamsSchema,
} from './patient-links.schemas';
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
    sendOk(res, await patientLinksService.create(viewer, idOf(req), actorFrom(req).userId));
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

patientLinksRouter.put(
  '/public/patient-history/:token/sections/:key',
  validate({ params: tokenSectionParamsSchema }),
  async (req, res) => {
    const { token, key } = validParams(req, tokenSectionParamsSchema);
    res.setHeader('Cache-Control', 'no-store');
    sendOk(res, await patientLinksService.saveSection(token, key, req.body, req.ip ?? null));
  },
);

patientLinksRouter.post(
  '/public/patient-history/:token/medical-records',
  documentsUpload('files'),
  jsonDataField,
  validate({ params: tokenParamsSchema, body: publicRecordSchema }),
  async (req, res) => {
    const { token } = validParams(req, tokenParamsSchema);
    res.setHeader('Cache-Control', 'no-store');
    sendOk(
      res,
      await patientLinksService.addRecord(
        token,
        validBody(req, publicRecordSchema),
        uploadedFiles(req),
        req.ip ?? null,
      ),
    );
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
