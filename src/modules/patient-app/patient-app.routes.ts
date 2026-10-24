import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
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
  patientPasswordLoginSchema,
  patientRefreshSchema,
  patientResetPasswordSchema,
  patientSetPasswordSchema,
  patientRequestListQuerySchema,
  updatePatientProfileSchema,
  updatePatientRequestSchema,
  uploadDocumentFieldsSchema,
} from './patient-app.schemas';
import { patientAppService } from './patient-app.service';
import { patientRequestsService } from './patient-requests.service';
import { limiter, loginGuard } from '../../lib/rate-limit';

export const patientAppRouter = Router();

const credentialLimiter = loginGuard('patient-login', (body) => body.phone);
const refreshLimiter = limiter('patient-refresh', {
  windowMs: 15 * 60_000,
  limit: 60,
  byIp: true,
  message: 'Too many attempts. Try again in a few minutes.',
});
const passwordLimiter = limiter('patient-password', {
  windowMs: 15 * 60_000,
  limit: 10,
  failuresOnly: true,
  message: 'Too many wrong passwords. Try again in 15 minutes.',
});
const requestLimiter = limiter('patient-requests', {
  windowMs: 15 * 60_000,
  limit: 30,
  message: 'Too many requests sent. Try again later.',
});
const byId = validate({ params: idParamsSchema });
const patientId = (req: Parameters<typeof patientOf>[0]) => patientOf(req).patientId;

patientAppRouter.post(
  '/patient/auth/login',
  ...credentialLimiter,
  validate({ body: patientLoginSchema }),
  async (req, res) => {
    sendOk(res, await patientAuth.loginWithCode(validBody(req, patientLoginSchema)));
  },
);

patientAppRouter.post(
  '/patient/auth/password-login',
  ...credentialLimiter,
  validate({ body: patientPasswordLoginSchema }),
  async (req, res) => {
    sendOk(res, await patientAuth.loginWithPassword(validBody(req, patientPasswordLoginSchema)));
  },
);

patientAppRouter.post(
  '/patient/auth/reset-password',
  ...credentialLimiter,
  validate({ body: patientResetPasswordSchema }),
  async (req, res) => {
    sendOk(res, await patientAuth.resetPassword(validBody(req, patientResetPasswordSchema)));
  },
);

patientAppRouter.post(
  '/patient/auth/refresh',
  refreshLimiter,
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

patientAppRouter.patch('/patient/me', validate({ body: updatePatientProfileSchema }), async (req, res) => {
  sendOk(res, await patientAppService.updateMe(patientId(req), validBody(req, updatePatientProfileSchema)));
});

patientAppRouter.post(
  '/patient/me/password',
  passwordLimiter,
  validate({ body: patientSetPasswordSchema }),
  async (req, res) => {
    await patientAuth.setPassword(patientId(req), validBody(req, patientSetPasswordSchema));
    sendNoContent(res);
  },
);

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
    const { title, type } = validBody(req, uploadDocumentFieldsSchema);
    sendCreated(
      res,
      await patientAppService.uploadDocuments(patientId(req), title || null, uploadedFiles(req), type),
    );
  },
);

patientAppRouter.delete('/patient/documents/:id', byId, async (req, res) => {
  await patientAppService.removeDocument(patientId(req), idOf(req));
  sendNoContent(res);
});

patientAppRouter.delete(
  '/patient/documents/files/:fileId',
  validate({ params: patientFileParamsSchema }),
  async (req, res) => {
    await patientAppService.removeDocumentFile(
      patientId(req),
      validParams(req, patientFileParamsSchema).fileId,
    );
    sendNoContent(res);
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
