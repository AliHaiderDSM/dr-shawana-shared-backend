import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import {
  dataEnvelope,
  errorResponses,
  jsonContent,
  sendCreated,
  sendNoContent,
  sendOk,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { authenticate } from '../../middleware/auth';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { doctorAppService } from './doctor-app.service';

const doctorOnly: RequestHandler = (req, _res, next) =>
  req.auth?.role === 'doctor' ? next() : next(AppError.forbidden('The doctor app is for doctors only'));

const patientParams = z.object({ patientId: z.uuid() });
const fileParams = z.object({ patientId: z.uuid(), fileId: z.uuid() });
const consultationParams = z.object({ consultationId: z.uuid() });
const prescriptionParams = z.object({ prescriptionId: z.uuid() });
const treatmentPlanParams = z.object({ planId: z.uuid() });
const treatmentPlanBody = registry.register(
  'DoctorTreatmentPlan',
  z.object({
    plan: z
      .string()
      .max(50000)
      .nullable()
      .openapi({
        description: 'Plan of treatment as HTML (bold, italic, lists); may be empty when items are ticked',
      }),
    catalogItemIds: z.array(z.uuid()).max(200).openapi({
      description:
        'Ticked medicines and blood tests from GET /doctor/plan-options; the whole list is replaced',
    }),
  }),
);
const patientsQuery = z.object({ search: z.string().trim().max(100).optional() });
const appointmentsQuery = z.object({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .optional()
    .openapi({
      description: 'Every appointment of this month (YYYY-MM), oldest first; when and page are ignored',
    }),
});
const remarksBody = registry.register(
  'DoctorRemarks',
  z.object({
    remarks: z
      .string()
      .max(50000)
      .nullable()
      .openapi({ description: 'Clinical remarks as HTML (bold, italic, lists), the same as the dashboard' }),
  }),
);
const planBody = registry.register(
  'DoctorPlanOfTreatment',
  z.object({
    planTreatment: z
      .string()
      .max(50000)
      .nullable()
      .openapi({ description: 'Plan of treatment as HTML (bold, italic, lists), the same as the dashboard' }),
  }),
);
const pushTokenBody = registry.register(
  'DoctorPushToken',
  z.object({
    token: z.string().trim().min(10).max(255),
    platform: z.enum(['ios', 'android', 'web']).nullable().optional(),
  }),
);
const removeTokenBody = z.object({ token: z.string().trim().min(10).max(255) });
const profileBody = registry.register(
  'DoctorOwnProfile',
  z
    .object({
      displayName: z
        .string()
        .trim()
        .min(1)
        .max(150)
        .openapi({ description: 'Name patients see, e.g. Dr. Shawana' }),
      details: z
        .string()
        .trim()
        .max(5000)
        .nullable()
        .openapi({ description: 'Qualification and speciality' }),
      phone: z.string().trim().max(30).nullable().openapi({ description: 'Also used to log in to the app' }),
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
);

export const doctorAppRouter = Router();
doctorAppRouter.use('/doctor', authenticate, doctorOnly, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

doctorAppRouter.get('/doctor/home', async (req, res) => {
  sendOk(res, await doctorAppService.home(req.auth!.userId));
});

doctorAppRouter.get('/doctor/profile', async (req, res) => {
  sendOk(res, await doctorAppService.profile(req.auth!.userId));
});

doctorAppRouter.put('/doctor/profile', validate({ body: profileBody }), async (req, res) => {
  const body = validBody(req, profileBody);
  sendOk(
    res,
    await doctorAppService.updateProfile(actorFrom(req), req.auth!.userId, {
      ...body,
      details: body.details === '' ? null : body.details,
      phone: body.phone === '' ? null : body.phone,
    }),
  );
});

doctorAppRouter.get('/doctor/appointments', validate({ query: appointmentsQuery }), async (req, res) => {
  const { when, page, month } = validQuery(req, appointmentsQuery);
  sendOk(res, await doctorAppService.appointments(req.auth!.userId, when, page, month));
});

doctorAppRouter.get('/doctor/plan-options', async (req, res) => {
  sendOk(res, await doctorAppService.planOptions(req.auth!.userId));
});

doctorAppRouter.get('/doctor/patients', validate({ query: patientsQuery }), async (req, res) => {
  sendOk(res, await doctorAppService.patients(req.auth!.userId, validQuery(req, patientsQuery).search));
});

doctorAppRouter.get('/doctor/patients/:patientId', validate({ params: patientParams }), async (req, res) => {
  sendOk(
    res,
    await doctorAppService.patientFile(req.auth!.userId, validParams(req, patientParams).patientId),
  );
});

doctorAppRouter.get(
  '/doctor/patients/:patientId/medicines',
  validate({ params: patientParams }),
  async (req, res) => {
    sendOk(
      res,
      await doctorAppService.patientMedicines(req.auth!.userId, validParams(req, patientParams).patientId),
    );
  },
);

doctorAppRouter.post(
  '/doctor/patients/:patientId/chat',
  validate({ params: patientParams }),
  async (req, res) => {
    sendOk(res, await doctorAppService.openChat(req.auth!.userId, validParams(req, patientParams).patientId));
  },
);

doctorAppRouter.get(
  '/doctor/patients/:patientId/files/:fileId/url',
  validate({ params: fileParams }),
  async (req, res) => {
    const { patientId, fileId } = validParams(req, fileParams);
    sendOk(res, await doctorAppService.fileUrl(req.auth!.userId, patientId, fileId));
  },
);

doctorAppRouter.put(
  '/doctor/consultations/:consultationId/remarks',
  validate({ params: consultationParams, body: remarksBody }),
  async (req, res) => {
    sendOk(
      res,
      await doctorAppService.saveRemarks(
        actorFrom(req),
        req.auth!.userId,
        validParams(req, consultationParams).consultationId,
        validBody(req, remarksBody).remarks,
      ),
    );
  },
);

doctorAppRouter.post(
  '/doctor/patients/:patientId/plans',
  validate({ params: patientParams, body: treatmentPlanBody }),
  async (req, res) => {
    sendCreated(
      res,
      await doctorAppService.addPlan(
        actorFrom(req),
        req.auth!.userId,
        validParams(req, patientParams).patientId,
        validBody(req, treatmentPlanBody),
      ),
    );
  },
);

doctorAppRouter.put(
  '/doctor/plans/:planId',
  validate({ params: treatmentPlanParams, body: treatmentPlanBody }),
  async (req, res) => {
    sendOk(
      res,
      await doctorAppService.updatePlan(
        actorFrom(req),
        req.auth!.userId,
        validParams(req, treatmentPlanParams).planId,
        validBody(req, treatmentPlanBody),
      ),
    );
  },
);

doctorAppRouter.put(
  '/doctor/prescriptions/:prescriptionId/plan',
  validate({ params: prescriptionParams, body: planBody }),
  async (req, res) => {
    sendOk(
      res,
      await doctorAppService.savePlan(
        actorFrom(req),
        req.auth!.userId,
        validParams(req, prescriptionParams).prescriptionId,
        validBody(req, planBody).planTreatment,
      ),
    );
  },
);

doctorAppRouter.post('/doctor/push-token', validate({ body: pushTokenBody }), async (req, res) => {
  const { token, platform } = validBody(req, pushTokenBody);
  await doctorAppService.savePushToken(req.auth!.userId, token, platform ?? null);
  sendNoContent(res);
});

doctorAppRouter.post('/doctor/push-token/remove', validate({ body: removeTokenBody }), async (req, res) => {
  await doctorAppService.removePushToken(req.auth!.userId, validBody(req, removeTokenBody).token);
  sendNoContent(res);
});

const docs = securedDocs('Doctor app');
const ok = (description: string) => ({
  200: { description, ...jsonContent(dataEnvelope(z.unknown())) },
  ...errorResponses,
});
const json = (schema: z.ZodType) => ({ body: { content: { 'application/json': { schema } } } });

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/home',
  summary: 'Doctor app home: counts, upcoming schedule and latest chats (every branch)',
  responses: ok('Home'),
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/patients',
  summary: 'Every patient seen by or chatting with this doctor in any branch, unread first',
  request: { query: patientsQuery },
  responses: ok('Patients'),
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/patients/{patientId}',
  summary:
    'Patient file for the doctor: appointments, prescriptions with medicines, clinical remarks and medical records, newest first. Only the doctor’s own patients.',
  request: { params: patientParams },
  responses: ok('Patient file'),
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/patients/{patientId}/medicines',
  summary:
    'Medicines and supplements of one of the doctor’s patients, grouped by prescription, newest first (every doctor and branch)',
  request: { params: patientParams },
  responses: ok('Medicines by prescription'),
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/doctor/patients/{patientId}/chat',
  summary: 'Open (or start) the chat with one of the doctor’s patients; returns the conversation id',
  request: { params: patientParams },
  responses: ok('Conversation'),
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/patients/{patientId}/files/{fileId}/url',
  summary: 'Ten-minute link to a medical record file of the doctor’s patient',
  request: { params: fileParams },
  responses: ok('Signed URL'),
});
registry.registerPath({
  ...docs,
  method: 'put',
  path: '/doctor/consultations/{consultationId}/remarks',
  summary: 'Write the clinical remarks of the doctor’s own consultation (other clinical fields stay)',
  request: { params: consultationParams, ...json(remarksBody) },
  responses: ok('Saved'),
});
registry.registerPath({
  ...docs,
  method: 'put',
  path: '/doctor/prescriptions/{prescriptionId}/plan',
  summary:
    'Write the plan of treatment of the doctor’s own prescription; it shows on the printed prescription and in the patient app',
  request: { params: prescriptionParams, ...json(planBody) },
  responses: ok('Saved'),
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/doctor/patients/{patientId}/plans',
  summary:
    'Add a new plan of treatment for the doctor’s own patient, dated today, not linked to a prescription; it shows in the patient file plans',
  request: { params: patientParams, ...json(treatmentPlanBody) },
  responses: {
    201: { description: 'Added', ...jsonContent(dataEnvelope(z.unknown())) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'put',
  path: '/doctor/plans/{planId}',
  summary: 'Edit a plan of treatment the doctor added',
  request: { params: treatmentPlanParams, ...json(treatmentPlanBody) },
  responses: ok('Saved'),
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/plan-options',
  summary:
    'Active medicines (supplements, medicines, GLP, BHRT) and blood tests of the doctor’s branch that can be ticked on a plan of treatment',
  responses: ok('Medicines and blood tests'),
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/doctor/push-token',
  summary: 'Save the Expo push token of the doctor’s phone (patient messages notify it)',
  request: json(pushTokenBody),
  responses: { 204: { description: 'Saved' }, ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/doctor/push-token/remove',
  summary: 'Forget a push token when the doctor logs out on that phone',
  request: json(removeTokenBody),
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/profile',
  summary: 'Own doctor profile: the name patients see, details, phone and login',
  responses: ok('Profile'),
});
registry.registerPath({
  ...docs,
  method: 'put',
  path: '/doctor/profile',
  summary: 'Update own name, details and phone. The phone is also the app login phone.',
  request: json(profileBody),
  responses: ok('Profile'),
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/doctor/appointments',
  summary:
    'Own appointments in every branch: upcoming (today onwards, soonest first) or past (newest first), 30 a page; or a whole month with ?month=YYYY-MM',
  request: { query: appointmentsQuery },
  responses: ok('Appointments page'),
});
