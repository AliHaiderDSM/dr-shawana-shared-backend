import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { actorFrom } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { documentsUpload, uploadedFiles } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { patientsService } from '../patients/patients.service';
import { authenticatePatient, patientAuth, patientOf } from './patient-auth';
import {
  createPatientRequestSchema,
  patientFileParamsSchema,
  patientLoginSchema,
  patientRefreshSchema,
  patientRequestListQuerySchema,
  updatePatientRequestSchema,
  uploadDocumentFieldsSchema,
} from './patient-app.schemas';
import { patientAppService } from './patient-app.service';
import { patientRequestsService } from './patient-requests.service';

export const patientAppRouter = Router();

const limiter = (limit: number, message: string) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: env.NODE_ENV === 'test' ? 1_000 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });

const credentialLimiter = limiter(20, 'Too many attempts. Try again in a few minutes.');
const requestLimiter = limiter(30, 'Too many requests sent. Try again later.');
const byId = validate({ params: idParamsSchema });
const patientId = (req: Parameters<typeof patientOf>[0]) => patientOf(req).patientId;

patientAppRouter.post(
  '/patient/auth/login',
  credentialLimiter,
  validate({ body: patientLoginSchema }),
  async (req, res) => {
    sendOk(res, await patientAuth.loginWithCode(validBody(req, patientLoginSchema)));
  },
);

patientAppRouter.post(
  '/patient/auth/refresh',
  credentialLimiter,
  validate({ body: patientRefreshSchema }),
  async (req, res) => {
    sendOk(res, await patientAuth.refresh(validBody(req, patientRefreshSchema).refreshToken));
  },
);

patientAppRouter.post('/patient/auth/logout', authenticatePatient, async (req, res) => {
  await patientAuth.logout(patientOf(req).sessionId);
  sendNoContent(res);
});

patientAppRouter.use('/patient', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/auth/')) return next();
  authenticatePatient(req, res, next);
});

patientAppRouter.get('/patient/me', async (req, res) => {
  sendOk(res, await patientAppService.me(patientId(req)));
});

patientAppRouter.get('/patient/overview', async (req, res) => {
  sendOk(res, await patientAppService.overview(patientId(req)));
});

patientAppRouter.get('/patient/appointments', async (req, res) => {
  sendOk(res, await patientAppService.appointments(patientId(req)));
});

patientAppRouter.get('/patient/appointments/:id', byId, async (req, res) => {
  sendOk(res, await patientAppService.appointment(patientId(req), idOf(req)));
});

patientAppRouter.get('/patient/history', async (req, res) => {
  sendOk(res, await patientAppService.history(patientId(req)));
});

patientAppRouter.get('/patient/prescriptions', async (req, res) => {
  sendOk(res, await patientAppService.prescriptions(patientId(req)));
});

patientAppRouter.get('/patient/prescriptions/:id', byId, async (req, res) => {
  sendOk(res, await patientAppService.prescription(patientId(req), idOf(req)));
});

patientAppRouter.get('/patient/documents', async (req, res) => {
  sendOk(res, await patientAppService.documents(patientId(req)));
});

patientAppRouter.post(
  '/patient/documents',
  requestLimiter,
  documentsUpload('files'),
  validate({ body: uploadDocumentFieldsSchema }),
  async (req, res) => {
    const { title } = validBody(req, uploadDocumentFieldsSchema);
    sendCreated(
      res,
      await patientAppService.uploadDocuments(patientId(req), title || null, uploadedFiles(req)),
    );
  },
);

patientAppRouter.get(
  '/patient/documents/files/:fileId/url',
  validate({ params: patientFileParamsSchema }),
  async (req, res) => {
    const { fileId } = validParams(req, patientFileParamsSchema);
    sendOk(res, await patientAppService.documentUrl(patientId(req), fileId));
  },
);

patientAppRouter.get('/patient/requests', async (req, res) => {
  sendOk(res, await patientRequestsService.listForPatient(patientId(req)));
});

patientAppRouter.post(
  '/patient/requests',
  requestLimiter,
  validate({ body: createPatientRequestSchema }),
  async (req, res) => {
    sendCreated(
      res,
      await patientRequestsService.create(patientId(req), validBody(req, createPatientRequestSchema)),
    );
  },
);

patientAppRouter.get('/patient/requests/:id', byId, async (req, res) => {
  sendOk(res, await patientRequestsService.getForPatient(patientId(req), idOf(req)));
});

const staffAccess = [authenticate, branchScope()];

patientAppRouter.get(
  '/branch/patients/:id/app-access',
  ...staffAccess,
  requirePermission('patients.view'),
  byId,
  async (req, res) => {
    await patientsService.require(idOf(req));
    sendOk(res, await patientAuth.accessStatus(idOf(req)));
  },
);

patientAppRouter.post(
  '/branch/patients/:id/app-access/code',
  ...staffAccess,
  requirePermission('patients.update'),
  byId,
  async (req, res) => {
    await patientsService.require(idOf(req));
    sendOk(res, await patientAuth.issueCode(idOf(req), branchIdOf(req), actorFrom(req).userId));
  },
);

patientAppRouter.post(
  '/branch/patients/:id/app-access/disable',
  ...staffAccess,
  requirePermission('patients.update'),
  byId,
  async (req, res) => {
    await patientsService.require(idOf(req));
    await patientAuth.disable(idOf(req));
    sendOk(res, await patientAuth.accessStatus(idOf(req)));
  },
);

patientAppRouter.get(
  '/branch/patient-requests',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  requirePermission('patients.view'),
  validate({ query: patientRequestListQuerySchema }),
  async (req, res) => {
    sendOk(
      res,
      await patientRequestsService.list(req.branchId ?? null, validQuery(req, patientRequestListQuerySchema)),
    );
  },
);

patientAppRouter.get(
  '/branch/patient-requests/:id',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  requirePermission('patients.view'),
  byId,
  async (req, res) => {
    sendOk(res, await patientRequestsService.get(req.branchId ?? null, idOf(req)));
  },
);

patientAppRouter.patch(
  '/branch/patient-requests/:id',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  requirePermission('patients.update'),
  validate({ params: idParamsSchema, body: updatePatientRequestSchema }),
  async (req, res) => {
    sendOk(
      res,
      await patientRequestsService.update(
        actorFrom(req),
        req.branchId ?? null,
        idOf(req),
        validBody(req, updatePatientRequestSchema),
      ),
    );
  },
);
