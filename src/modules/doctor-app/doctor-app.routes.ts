import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { dataEnvelope, errorResponses, jsonContent, sendNoContent, sendOk } from '../../lib/http';
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
const patientsQuery = z.object({ search: z.string().trim().max(100).optional() });
const appointmentsQuery = z.object({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
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
  const { when, page } = validQuery(req, appointmentsQuery);
  sendOk(res, await doctorAppService.appointments(req.auth!.userId, when, page));
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
    'Own appointments in every branch: upcoming (today onwards, soonest first) or past (newest first), 30 a page',
  request: { query: appointmentsQuery },
  responses: ok('Appointments page'),
});
