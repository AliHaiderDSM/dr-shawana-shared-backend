import { z } from 'zod';
import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageEnvelope,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, dateInput, moneyOutput, optionalText, requiredText } from '../../lib/validation';
import { BHRT_STATUSES } from './patient.entity';
import { normalizePhone } from './phone';

export const phoneInput = z
  .string()
  .trim()
  .max(30)
  .refine((v) => normalizePhone(v) !== null, 'Enter a valid phone number, e.g. 923001234567')
  .openapi({ example: '923001234567' });

const ageInput = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d{1,3}$/),
  ])
  .transform((v) => Number(v))
  .pipe(z.number().int().min(0).max(150))
  .openapi({ type: 'integer', example: 42 });

export const patientFields = z.object({
  name: requiredText(1, 150),
  phone: phoneInput,
  city: requiredText(1, 100),
  age: ageInput.nullable().optional(),
  dateOfBirth: dateInput.nullable().optional(),
  country: optionalText(100),
  address: optionalText(2000),
});

export const createPatientSchema = registry.register('CreatePatient', patientFields);
export const updatePatientSchema = registry.register('UpdatePatient', atLeastOneField(patientFields));

export const patientListQuerySchema = listQuerySchema(['createdAt', 'name', 'city']).extend({
  city: z.string().trim().max(100).optional(),
  bhrtStatus: z.enum(BHRT_STATUSES).optional(),
  branchId: z.uuid().optional(),
});

export const patientSearchQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  branchId: z.uuid().optional(),
});

export const phoneCheckQuerySchema = z.object({
  phone: z.string().trim().min(1).max(30),
  excludeId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});

export const citySuggestionQuerySchema = z.object({
  search: z.string().trim().min(1).max(100),
  branchId: z.uuid().optional(),
});

export const patientSchema = registry.register(
  'Patient',
  z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    phoneNormalized: z.string(),
    city: z.string(),
    age: z.number().int().nullable(),
    dateOfBirth: z.iso.date().nullable(),
    country: z.string().nullable(),
    address: z.string().nullable(),
    bhrtStatus: z.enum(BHRT_STATUSES),
    createdInBranchId: z.uuid().nullable(),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const patientOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  city: z.string(),
});

const phoneCheckSchema = z.object({
  exists: z.boolean(),
  patient: patientOptionSchema.nullable(),
});

const summaryAppointmentSchema = z.object({
  id: z.uuid(),
  appointmentNo: z.number().int(),
  date: z.iso.date(),
  timeFrom: z.string(),
  timeTo: z.string(),
  status: z.string(),
  mode: z.string(),
  visitType: z.string(),
  doctor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  receivedAmount: moneyOutput,
});

export const patientSummarySchema = registry.register(
  'PatientSummary',
  z.object({
    patient: patientSchema,
    appointments: z.object({
      total: z.number().int(),
      booked: z.number().int(),
      completed: z.number().int(),
      cancelled: z.number().int(),
      lastVisit: z.iso.date().nullable(),
      nextAppointment: summaryAppointmentSchema.nullable(),
      recent: z.array(summaryAppointmentSchema),
    }),
    payments: z.object({ totalReceived: moneyOutput }),
    medicalRecords: z.array(
      z.object({
        id: z.uuid(),
        date: z.iso.date(),
        note: z.string().nullable(),
        appointmentId: z.uuid().nullable(),
        files: z.array(z.object({ id: z.uuid(), originalName: z.string(), contentType: z.string() })),
      }),
    ),
  }),
);

export type CreatePatientInput = z.output<typeof createPatientSchema>;
export type UpdatePatientInput = z.output<typeof updatePatientSchema>;
export type PatientListQuery = z.output<typeof patientListQuerySchema>;

export const medicalFileParamsSchema = z.object({ id: z.uuid(), fileId: z.uuid() });

const common = securedDocs('Patients');
const byId = { params: idParamsSchema, query: branchQuerySchema };
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(patientSchema)) });

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients',
  summary:
    'List patients. Without "search": patients created in or visiting this branch. With "search": every patient matching name, phone or city.',
  request: { query: patientListQuerySchema },
  responses: { 200: { description: 'Page', ...jsonContent(pageEnvelope(patientSchema)) }, ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/options',
  summary: 'Patient dropdown (name + phone), at most 50 matches',
  request: { query: patientSearchQuerySchema },
  responses: {
    200: { description: 'Options', ...jsonContent(dataEnvelope(z.array(patientOptionSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/check-phone',
  summary: 'posSoft duplicate check: is a patient with the same last 9 phone digits already added?',
  request: { query: phoneCheckQuerySchema },
  responses: {
    200: { description: 'Result', ...jsonContent(dataEnvelope(phoneCheckSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/cities',
  summary: 'City suggestions from existing patients',
  request: { query: citySuggestionQuerySchema },
  responses: {
    200: { description: 'Cities', ...jsonContent(dataEnvelope(z.array(z.string()))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/patients',
  summary: 'Create a patient (409 if the phone is already added)',
  request: { query: branchQuerySchema, body: jsonContent(createPatientSchema) },
  responses: { 201: one('Created'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/{id}',
  summary: 'Get a patient profile',
  request: byId,
  responses: { 200: one('Patient'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/{id}/summary',
  summary: "Patient profile with this branch's appointments, payments and medical records",
  request: byId,
  responses: {
    200: { description: 'Summary', ...jsonContent(dataEnvelope(patientSummarySchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/{id}/medical-records/files/{fileId}/url',
  summary: 'Short-lived download link for a medical record file of this branch',
  request: { params: medicalFileParamsSchema, query: branchQuerySchema },
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'patch',
  path: '/branch/patients/{id}',
  summary: 'Edit a patient',
  request: { ...byId, body: jsonContent(updatePatientSchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'delete',
  path: '/branch/patients/{id}',
  summary: 'Remove a patient (soft delete; blocked while they have appointments)',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/{id}/timeline',
  summary:
    'Patient history: consultations with their sections, prescriptions, blood work, BHRT and medical records of this branch (super_admin without branchId: every branch)',
  request: byId,
  responses: {
    200: { description: 'Timeline', ...jsonContent(dataEnvelope(z.record(z.string(), z.unknown()))) },
    ...errorResponses,
  },
});
