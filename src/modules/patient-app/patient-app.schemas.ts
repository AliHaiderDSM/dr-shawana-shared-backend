import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { normalizePhone } from '../patients/phone';
import { PATIENT_REQUEST_CATEGORIES, PATIENT_REQUEST_STATUSES } from './patient-requests.service';

const phoneInput = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .refine((v) => normalizePhone(v) !== null, 'Enter a valid phone number, e.g. 03001234567');
const device = z.string().trim().max(120).nullable().optional();

export const patientLoginSchema = registry.register(
  'PatientLogin',
  z.object({
    phone: phoneInput,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'The code has 6 digits'),
    device,
  }),
);

export const patientRefreshSchema = registry.register(
  'PatientRefresh',
  z.object({ refreshToken: z.string().min(20).max(200) }),
);

export const updatePatientProfileSchema = registry.register(
  'UpdatePatientProfile',
  z
    .object({
      name: z.string().trim().min(1, 'Enter your name').max(150).optional(),
      city: z.string().trim().min(1, 'Enter your city').max(100).optional(),
      country: z.string().trim().max(100).nullable().optional(),
      age: z.number().int().min(1).max(120).nullable().optional(),
      dateOfBirth: z.iso.date().nullable().optional(),
      weightKg: z.number().positive().max(400).nullable().optional(),
      heightCm: z.number().positive().max(260).nullable().optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), 'Change at least one field'),
);

export const createPatientRequestSchema = registry.register(
  'CreatePatientRequest',
  z.object({
    category: z.enum(PATIENT_REQUEST_CATEGORIES),
    subject: z.string().trim().min(3, 'Write a short subject').max(150),
    message: z.string().trim().min(10, 'Write at least 10 characters').max(4000),
  }),
);

export const uploadDocumentFieldsSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export const patientFileParamsSchema = z.object({ fileId: z.uuid() });

export const patientRequestListQuerySchema = z.object({
  status: z.enum([...PATIENT_REQUEST_STATUSES, 'open']).optional(),
  patientId: z.uuid().optional(),
});

export const updatePatientRequestSchema = registry.register(
  'UpdatePatientRequest',
  z.object({
    status: z.enum(PATIENT_REQUEST_STATUSES).optional(),
    reply: z.string().trim().max(4000).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  }),
);

const sessionSchema = registry.register(
  'PatientSession',
  z.object({
    accessToken: z.string(),
    accessTokenExpiresAt: z.string(),
    refreshToken: z.string(),
    refreshTokenExpiresAt: z.string(),
  }),
);

const appAccessSchema = registry.register(
  'PatientAppAccess',
  z.object({
    status: z.enum(['not_invited', 'invited', 'active', 'disabled']),
    activatedAt: z.string().nullable(),
    lastLoginAt: z.string().nullable(),
    codeExpiresAt: z.string().nullable(),
  }),
);

const historyEntry = z.object({
  status: z.enum(PATIENT_REQUEST_STATUSES),
  note: z.string().nullable(),
  byPatient: z.boolean(),
  by: z.string().optional(),
  at: z.string(),
});

const staffRequestSchema = registry.register(
  'PatientRequest',
  z.object({
    id: z.uuid(),
    requestNo: z.string(),
    branch: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
    patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string() }),
    category: z.enum(PATIENT_REQUEST_CATEGORIES),
    subject: z.string(),
    message: z.string(),
    status: z.enum(PATIENT_REQUEST_STATUSES),
    reply: z.string().nullable(),
    repliedAt: z.string().nullable(),
    repliedBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    history: z.array(historyEntry).optional(),
  }),
);

const staffDocs = securedDocs('Patient requests');
const appDocs = { tags: ['Patient app'] };
const patientDocs = { tags: ['Patient app'], security: [{ bearerAuth: [] }] };
const ok = (description: string, schema: z.ZodType = z.unknown()) => ({
  200: { description, ...jsonContent(dataEnvelope(schema)) },
  ...errorResponses,
});
const jsonBody = (schema: z.ZodType) => ({ body: { content: { 'application/json': { schema } } } });

registry.registerPath({
  ...appDocs,
  method: 'post',
  path: '/patient/auth/login',
  summary:
    'Patient login with the phone number and the 6-digit code from the clinic. A code works once, for 24 hours, and stops after 5 wrong tries. The session then stays open while the app is used (60 days from the last use).',
  request: jsonBody(patientLoginSchema),
  responses: ok('Session', sessionSchema),
});
registry.registerPath({
  ...appDocs,
  method: 'post',
  path: '/patient/auth/refresh',
  summary: 'New access token for a refresh token; the refresh token is replaced',
  request: jsonBody(patientRefreshSchema),
  responses: ok('Session', sessionSchema),
});
registry.registerPath({
  ...patientDocs,
  method: 'post',
  path: '/patient/auth/logout',
  summary: 'End this device session',
  responses: { 204: { description: 'Logged out' }, ...errorResponses },
});
registry.registerPath({
  ...patientDocs,
  method: 'patch',
  path: '/patient/me',
  summary:
    'The patient edits name, city, country, age, date of birth, weight (kg) or height (cm) (not the phone). Marks the patient as updated from the app.',
  request: jsonBody(updatePatientProfileSchema),
  responses: ok('Profile'),
});
for (const [path, summary] of [
  ['/patient/me', 'Own profile and clinic contact'],
  ['/patient/overview', 'Home screen: next appointment, latest prescription, recent visits, open requests'],
  ['/patient/appointments', 'Own appointments in every branch, newest first'],
  ['/patient/history', 'Past visits with their prescriptions and document counts'],
  ['/patient/prescriptions', 'Own prescriptions, newest first'],
  ['/patient/documents', 'Own medical records and their files'],
  ['/patient/requests', 'Own requests to clinic management'],
] as const) {
  registry.registerPath({ ...patientDocs, method: 'get', path, summary, responses: ok(summary) });
}
for (const [path, summary] of [
  ['/patient/appointments/{id}', 'One own appointment with its prescriptions and documents'],
  ['/patient/prescriptions/{id}', 'One own prescription with its medicines'],
  ['/patient/requests/{id}', 'One own request with its status history and reply'],
] as const) {
  registry.registerPath({
    ...patientDocs,
    method: 'get',
    path,
    summary,
    request: { params: idParamsSchema },
    responses: ok(summary),
  });
}
registry.registerPath({
  ...patientDocs,
  method: 'post',
  path: '/patient/documents',
  summary:
    'Upload up to 5 reports (multipart "files": PDF, JPG, PNG or WebP, 10 MB each) with an optional "title". They are added to the medical records as uploaded by the patient.',
  responses: { 201: { description: 'Saved', ...jsonContent(dataEnvelope(z.unknown())) }, ...errorResponses },
});
registry.registerPath({
  ...patientDocs,
  method: 'get',
  path: '/patient/documents/files/{fileId}/url',
  summary: 'Two-minute link to one own file',
  request: { params: patientFileParamsSchema },
  responses: ok('Signed URL', z.object({ url: z.string(), expiresIn: z.number() })),
});
registry.registerPath({
  ...patientDocs,
  method: 'post',
  path: '/patient/requests',
  summary: 'Send a request to clinic management; it goes to the branch of the latest appointment',
  request: jsonBody(createPatientRequestSchema),
  responses: {
    201: { description: 'Created', ...jsonContent(dataEnvelope(z.unknown())) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...staffDocs,
  method: 'get',
  path: '/branch/patients/{id}/app-access',
  summary: 'Whether the patient can use the mobile app',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: ok('Access', appAccessSchema),
});
registry.registerPath({
  ...staffDocs,
  method: 'post',
  path: '/branch/patients/{id}/app-access/code',
  summary:
    'Create a 6-digit login code (valid 24 hours, one use) for the patient app. The patient logs in with the phone number and this code. Earlier unused codes stop working. Shown once.',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: ok('Code', z.object({ code: z.string(), expiresAt: z.string() })),
});
registry.registerPath({
  ...staffDocs,
  method: 'post',
  path: '/branch/patients/{id}/app-access/disable',
  summary: 'Turn off app access and sign the patient out everywhere',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: ok('Access', appAccessSchema),
});
registry.registerPath({
  ...staffDocs,
  method: 'get',
  path: '/branch/patient-requests',
  summary:
    'Requests patients sent from the app. Branch staff see their branch; the Super Admin sees every branch without ?branchId=.',
  request: { query: patientRequestListQuerySchema },
  responses: ok('Requests', z.array(staffRequestSchema)),
});
registry.registerPath({
  ...staffDocs,
  method: 'get',
  path: '/branch/patient-requests/{id}',
  summary: 'One patient request with its history',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: ok('Request', staffRequestSchema),
});
registry.registerPath({
  ...staffDocs,
  method: 'patch',
  path: '/branch/patient-requests/{id}',
  summary: 'Change the status and/or reply to the patient',
  request: { params: idParamsSchema, query: branchQuerySchema, ...jsonBody(updatePatientRequestSchema) },
  responses: ok('Request', staffRequestSchema),
});
