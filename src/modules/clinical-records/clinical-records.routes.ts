import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { documentsUpload, jsonDataField, uploadedFiles } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import {
  addBhrtSchema,
  addBloodWorkSchema,
  createMedicalRecordSchema,
  medicalRecordListQuerySchema,
  recordFileParamsSchema,
  recordParamsSchema,
  resultParamsSchema,
  updateBloodWorkSchema,
  updateMedicalRecordSchema,
} from './clinical-records.schemas';
import { bhrtService, bloodWorkService, medicalRecordsService } from './clinical-records.service';

export const clinicalRecordsRouter = Router();

const base = '/branch/patients/:id';
const scoped = [authenticate, branchScope()];
const byPatient = validate({ params: idParamsSchema });
const canView = requirePermission('consultations.view');
const canCreate = requirePermission('consultations.create');
const canUpdate = requirePermission('consultations.update');

clinicalRecordsRouter.get(`${base}/blood-work`, ...scoped, canView, byPatient, async (req, res) => {
  sendOk(res, await bloodWorkService.list(branchIdOf(req), idOf(req)));
});

clinicalRecordsRouter.post(
  `${base}/blood-work`,
  ...scoped,
  canCreate,
  validate({ params: idParamsSchema, body: addBloodWorkSchema }),
  async (req, res) => {
    const input = validBody(req, addBloodWorkSchema);
    sendCreated(res, await bloodWorkService.add(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

clinicalRecordsRouter.patch(
  `${base}/blood-work/:resultId`,
  ...scoped,
  canUpdate,
  validate({ params: resultParamsSchema, body: updateBloodWorkSchema }),
  async (req, res) => {
    const { id, resultId } = validParams(req, resultParamsSchema);
    const input = validBody(req, updateBloodWorkSchema);
    sendOk(res, await bloodWorkService.update(actorFrom(req), branchIdOf(req), id, resultId, input));
  },
);

clinicalRecordsRouter.delete(
  `${base}/blood-work/:resultId`,
  ...scoped,
  canUpdate,
  validate({ params: resultParamsSchema }),
  async (req, res) => {
    const { id, resultId } = validParams(req, resultParamsSchema);
    await bloodWorkService.remove(actorFrom(req), branchIdOf(req), id, resultId);
    sendNoContent(res);
  },
);

clinicalRecordsRouter.get(`${base}/bhrt`, ...scoped, canView, byPatient, async (req, res) => {
  sendOk(res, await bhrtService.list(branchIdOf(req), idOf(req)));
});

clinicalRecordsRouter.post(
  `${base}/bhrt`,
  ...scoped,
  canCreate,
  validate({ params: idParamsSchema, body: addBhrtSchema }),
  async (req, res) => {
    const input = validBody(req, addBhrtSchema);
    sendCreated(res, await bhrtService.add(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

clinicalRecordsRouter.get(
  `${base}/medical-records`,
  ...scoped,
  canView,
  validate({ params: idParamsSchema, query: medicalRecordListQuerySchema }),
  async (req, res) => {
    const { type } = validQuery(req, medicalRecordListQuerySchema);
    sendOk(res, await medicalRecordsService.list(branchIdOf(req), idOf(req), type));
  },
);

clinicalRecordsRouter.post(
  `${base}/medical-records`,
  ...scoped,
  canCreate,
  byPatient,
  documentsUpload('files'),
  jsonDataField,
  validate({ body: createMedicalRecordSchema }),
  async (req, res) => {
    const input = validBody(req, createMedicalRecordSchema);
    sendCreated(
      res,
      await medicalRecordsService.create(
        actorFrom(req),
        branchIdOf(req),
        idOf(req),
        input,
        uploadedFiles(req),
      ),
    );
  },
);

clinicalRecordsRouter.patch(
  `${base}/medical-records/:recordId`,
  ...scoped,
  canUpdate,
  validate({ params: recordParamsSchema, body: updateMedicalRecordSchema }),
  async (req, res) => {
    const { id, recordId } = validParams(req, recordParamsSchema);
    const input = validBody(req, updateMedicalRecordSchema);
    sendOk(res, await medicalRecordsService.update(actorFrom(req), branchIdOf(req), id, recordId, input));
  },
);

clinicalRecordsRouter.delete(
  `${base}/medical-records/:recordId`,
  ...scoped,
  canUpdate,
  validate({ params: recordParamsSchema }),
  async (req, res) => {
    const { id, recordId } = validParams(req, recordParamsSchema);
    await medicalRecordsService.remove(actorFrom(req), branchIdOf(req), id, recordId);
    sendNoContent(res);
  },
);

clinicalRecordsRouter.post(
  `${base}/medical-records/:recordId/files`,
  ...scoped,
  canUpdate,
  validate({ params: recordParamsSchema }),
  documentsUpload('files'),
  async (req, res) => {
    const { id, recordId } = validParams(req, recordParamsSchema);
    sendOk(
      res,
      await medicalRecordsService.addFiles(actorFrom(req), branchIdOf(req), id, recordId, uploadedFiles(req)),
    );
  },
);

clinicalRecordsRouter.delete(
  `${base}/medical-records/:recordId/files/:fileId`,
  ...scoped,
  canUpdate,
  validate({ params: recordFileParamsSchema }),
  async (req, res) => {
    const { id, recordId, fileId } = validParams(req, recordFileParamsSchema);
    await medicalRecordsService.removeFile(actorFrom(req), branchIdOf(req), id, recordId, fileId);
    sendNoContent(res);
  },
);
