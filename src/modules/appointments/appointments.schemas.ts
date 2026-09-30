import { z } from 'zod';
import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageEnvelope,
  pageMetaSchema,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, dateInput, moneyInput, moneyOutput, optionalText } from '../../lib/validation';
import { BHRT_STATUSES } from '../patients/patient.entity';
import { patientFields } from '../patients/patients.schemas';
import {
  APPOINTMENT_MODES,
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  VISIT_TYPES,
} from './appointment.entity';
import { PAYMENT_METHODS } from './appointment-payment.entity';

export const timeInput = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:mm')
  .transform((v) => (v.length === 5 ? `${v}:00` : v))
  .openapi({ example: '10:30' });

const positiveMoney = moneyInput.refine((v) => Number(v) > 0, 'Must be greater than zero');

const senderFields = {
  senderBank: optionalText(150),
  senderAccountTitle: optionalText(150),
  senderAccountNo: optionalText(100),
};

export const paymentInputSchema = registry.register(
  'AppointmentPaymentInput',
  z.object({
    method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney,
    date: dateInput.optional(),
    accountSheetId: z.uuid().openapi({ description: 'The receiving account sheet' }),
    ...senderFields,
    proofIndex: z
      .number()
      .int()
      .min(0)
      .max(9)
      .optional()
      .openapi({ description: 'Index of the screenshot in the "paymentProofs" files (online payments)' }),
  }),
);

const timeRangeValid = (v: { timeFrom?: string; timeTo?: string }) =>
  !v.timeFrom || !v.timeTo || v.timeTo > v.timeFrom;
const timeRangeIssue = { message: 'Time to must be after time from', path: ['timeTo'] };

export const createAppointmentSchema = registry.register(
  'CreateAppointment',
  z
    .object({
      patientId: z.uuid().optional(),
      patient: patientFields.optional().openapi({ description: 'Create the patient inline, as posSoft did' }),
      doctorId: z.uuid(),
      date: dateInput,
      timeFrom: timeInput,
      timeTo: timeInput,
      mode: z.enum(APPOINTMENT_MODES),
      visitType: z.enum(VISIT_TYPES),
      issues: optionalText(20000),
      medicalRecord: z
        .object({ note: optionalText(20000), date: dateInput.optional() })
        .optional()
        .openapi({ description: 'Optional medical record; its files go in "medicalRecordFiles"' }),
      payments: z.array(paymentInputSchema).max(10).default([]),
    })
    .refine((v) => (v.patientId ? 1 : 0) + (v.patient ? 1 : 0) === 1, {
      message: 'Provide either patientId or patient',
      path: ['patientId'],
    })
    .refine(timeRangeValid, timeRangeIssue),
);

export const updateAppointmentSchema = registry.register(
  'UpdateAppointment',
  atLeastOneField(
    z.object({
      patientId: z.uuid(),
      doctorId: z.uuid(),
      date: dateInput,
      timeFrom: timeInput,
      timeTo: timeInput,
      mode: z.enum(APPOINTMENT_MODES),
      visitType: z.enum(VISIT_TYPES),
      issues: z.string().trim().max(20000).nullable(),
    }),
  ).refine(timeRangeValid, timeRangeIssue),
);

export const appointmentStatusSchema = registry.register(
  'AppointmentStatusChange',
  z.object({
    status: z.enum(APPOINTMENT_STATUSES),
    remark: optionalText(20000),
  }),
);

export const updatePaymentSchema = registry.register(
  'UpdateAppointmentPayment',
  atLeastOneField(
    z.object({
      method: z.enum(PAYMENT_METHODS),
      amount: positiveMoney,
      date: dateInput,
      accountSheetId: z.uuid(),
      senderBank: z.string().trim().max(150).nullable(),
      senderAccountTitle: z.string().trim().max(150).nullable(),
      senderAccountNo: z.string().trim().max(100).nullable(),
    }),
  ),
);

export const createPaymentSchema = paymentInputSchema.omit({ proofIndex: true });

const filterFields = {
  doctorId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  mode: z.enum(APPOINTMENT_MODES).optional(),
  bhrtStatus: z.enum(BHRT_STATUSES).optional(),
  branchId: z.uuid().optional(),
};

export const appointmentListQuerySchema = listQuerySchema(
  ['date', 'createdAt', 'appointmentNo'],
  '-date',
).extend({
  ...filterFields,
  from: dateInput.optional(),
  to: dateInput.optional(),
  visitType: z.enum(VISIT_TYPES).optional(),
  createdBy: z.uuid().optional(),
  createdOn: dateInput
    .optional()
    .openapi({ description: 'Booking date (posSoft "appointment date" filter)' }),
});

export const calendarQuerySchema = z
  .object({
    from: dateInput,
    to: dateInput,
    doctorId: z.uuid().optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    branchId: z.uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: '"to" must not be before "from"', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62, {
    message: 'The calendar range can be at most 62 days',
    path: ['to'],
  });

export const paymentReportQuerySchema = listQuerySchema(['date'], '-date').extend({
  ...filterFields,
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  accountSheetId: z.uuid().optional(),
  city: z.string().trim().max(100).optional(),
});

export const attachmentParamsSchema = z.object({ id: z.uuid(), attachmentId: z.uuid() });
export const paymentParamsSchema = z.object({ id: z.uuid(), paymentId: z.uuid() });

const refSchema = z.object({ id: z.uuid(), name: z.string() });
const fileSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const paymentSchema = registry.register(
  'AppointmentPayment',
  z.object({
    id: z.uuid(),
    appointmentId: z.uuid(),
    method: z.enum(PAYMENT_METHODS),
    amount: moneyOutput,
    date: z.iso.date(),
    accountSheetId: z.uuid(),
    accountSheet: z.object({ id: z.uuid(), accountName: z.string(), accountCode: z.string() }).nullable(),
    senderBank: z.string().nullable(),
    senderAccountTitle: z.string().nullable(),
    senderAccountNo: z.string().nullable(),
    hasProof: z.boolean(),
    proofOriginalName: z.string().nullable(),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const appointmentBase = {
  id: z.uuid(),
  appointmentNo: z.number().int().openapi({ description: 'Shown as APP#<number>' }),
  branchId: z.uuid(),
  patientId: z.uuid(),
  patient: z
    .object({ id: z.uuid(), name: z.string(), phone: z.string(), city: z.string(), bhrtStatus: z.string() })
    .nullable(),
  patientCity: z.string().nullable(),
  doctorId: z.uuid(),
  doctor: refSchema.nullable(),
  date: z.iso.date(),
  timeFrom: z.string().openapi({ example: '10:30:00' }),
  timeTo: z.string().openapi({ example: '11:00:00' }),
  mode: z.enum(APPOINTMENT_MODES),
  visitType: z.enum(VISIT_TYPES),
  issues: z.string().nullable(),
  remark: z.string().nullable(),
  status: z.enum(APPOINTMENT_STATUSES),
  source: z.enum(APPOINTMENT_SOURCES),
  receivedAmount: moneyOutput,
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const appointmentSchema = registry.register('Appointment', z.object(appointmentBase));

export const appointmentDetailSchema = registry.register(
  'AppointmentDetail',
  z.object({
    ...appointmentBase,
    payments: z.array(paymentSchema),
    attachments: z.array(fileSchema),
    medicalRecords: z.array(
      z.object({ id: z.uuid(), date: z.iso.date(), note: z.string().nullable(), files: z.array(fileSchema) }),
    ),
  }),
);

export const calendarEntrySchema = registry.register(
  'CalendarEntry',
  z.object({
    id: z.uuid(),
    appointmentNo: z.number().int(),
    date: z.iso.date(),
    timeFrom: z.string(),
    timeTo: z.string(),
    status: z.enum(APPOINTMENT_STATUSES),
    mode: z.enum(APPOINTMENT_MODES),
    visitType: z.enum(VISIT_TYPES),
    patient: refSchema,
    doctor: refSchema,
  }),
);

export const paymentReportRowSchema = registry.register(
  'AppointmentPaymentReportRow',
  z.object({
    appointmentId: z.uuid(),
    appointmentNo: z.number().int(),
    date: z.iso.date(),
    timeFrom: z.string(),
    timeTo: z.string(),
    status: z.enum(APPOINTMENT_STATUSES),
    mode: z.enum(APPOINTMENT_MODES),
    patientCity: z.string().nullable(),
    patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string(), bhrtStatus: z.string() }),
    doctor: refSchema,
    methods: z.array(z.enum(PAYMENT_METHODS)),
    lastPaymentDate: z.iso.date(),
    amount: moneyOutput,
  }),
);

export type CreateAppointmentInput = z.output<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.output<typeof updateAppointmentSchema>;
export type AppointmentStatusInput = z.output<typeof appointmentStatusSchema>;
export type AppointmentListQuery = z.output<typeof appointmentListQuerySchema>;
export type CalendarQuery = z.output<typeof calendarQuerySchema>;
export type PaymentInput = z.output<typeof paymentInputSchema>;
export type UpdatePaymentInput = z.output<typeof updatePaymentSchema>;
export type PaymentReportQuery = z.output<typeof paymentReportQuerySchema>;

const signedUrl = {
  description: 'Signed URL',
  ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
};
const binary = z.string().openapi({ format: 'binary' });
const withData = (payload: z.ZodType, files: Record<string, z.ZodType>) => ({
  content: {
    'application/json': { schema: payload },
    'multipart/form-data': {
      schema: z.object({ data: z.string().openapi({ description: 'JSON payload' }), ...files }),
    },
  },
});

const appointmentDocs = securedDocs('Appointments');
const paymentDocs = securedDocs('Appointment payments');
const item = '/branch/appointments/{id}';
const byIdRequest = { params: idParamsSchema, query: branchQuerySchema };
const detail = (description: string) => ({
  description,
  ...jsonContent(dataEnvelope(appointmentDetailSchema)),
});
const onePayment = (description: string) => ({ description, ...jsonContent(dataEnvelope(paymentSchema)) });
const paymentRequest = { params: paymentParamsSchema, query: branchQuerySchema };

registry.registerPath({
  ...appointmentDocs,
  method: 'get',
  path: '/branch/appointments',
  summary: 'List appointments (doctors see only their own)',
  request: { query: appointmentListQuerySchema },
  responses: {
    200: { description: 'Page', ...jsonContent(pageEnvelope(appointmentSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'get',
  path: '/branch/appointments/calendar',
  summary: 'Appointments between two dates for a calendar (at most 62 days)',
  request: { query: calendarQuerySchema },
  responses: {
    200: { description: 'Entries', ...jsonContent(dataEnvelope(z.array(calendarEntrySchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'post',
  path: '/branch/appointments',
  summary:
    'Book an appointment. Send JSON, or multipart with "data" plus "medicalRecordFiles" and "paymentProofs" (online payments point to a screenshot with proofIndex). 409 when the time overlaps another appointment of the doctor.',
  request: {
    query: branchQuerySchema,
    body: withData(createAppointmentSchema, {
      medicalRecordFiles: z.array(binary).optional(),
      paymentProofs: z.array(binary).optional(),
    }),
  },
  responses: { 201: detail('Booked'), ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'get',
  path: item,
  summary: 'Appointment with payments, remark files and medical records',
  request: byIdRequest,
  responses: { 200: detail('Appointment'), ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'patch',
  path: item,
  summary: 'Edit an appointment (overlap is checked again)',
  request: { ...byIdRequest, body: jsonContent(updateAppointmentSchema) },
  responses: { 200: detail('Updated'), ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'post',
  path: `${item}/status`,
  summary: 'posSoft "Remarks": set the status and remark, optionally with screenshots ("files")',
  request: { ...byIdRequest, body: withData(appointmentStatusSchema, { files: z.array(binary).optional() }) },
  responses: { 200: detail('Updated'), ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'delete',
  path: item,
  summary: 'Remove an appointment and its payments (soft delete)',
  request: byIdRequest,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'get',
  path: `${item}/attachments/{attachmentId}/url`,
  summary: 'Download link for a remark screenshot',
  request: { params: attachmentParamsSchema, query: branchQuerySchema },
  responses: { 200: signedUrl, ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'delete',
  path: `${item}/attachments/{attachmentId}`,
  summary: 'Remove a remark screenshot',
  request: { params: attachmentParamsSchema, query: branchQuerySchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...appointmentDocs,
  method: 'get',
  path: `${item}/medical-records/files/{fileId}/url`,
  summary: 'Download link for a medical record file uploaded with this appointment',
  request: { params: z.object({ id: z.uuid(), fileId: z.uuid() }), query: branchQuerySchema },
  responses: { 200: signedUrl, ...errorResponses },
});

registry.registerPath({
  ...paymentDocs,
  method: 'get',
  path: '/branch/appointment-payments',
  summary:
    'posSoft "Appointment Payment Report": one row per appointment with the total of its matching payments',
  request: { query: paymentReportQuerySchema },
  responses: {
    200: {
      description: 'Page; meta.totalAmount is the total of every matching payment',
      ...jsonContent(
        z.object({
          data: z.array(paymentReportRowSchema),
          meta: pageMetaSchema.extend({ totalAmount: moneyOutput }),
        }),
      ),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...paymentDocs,
  method: 'get',
  path: `${item}/payments`,
  summary: 'Payments of an appointment',
  request: byIdRequest,
  responses: {
    200: { description: 'Payments', ...jsonContent(dataEnvelope(z.array(paymentSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...paymentDocs,
  method: 'post',
  path: `${item}/payments`,
  summary: 'Add a payment. JSON, or multipart with "data" plus one "proof" screenshot (online only)',
  request: { ...byIdRequest, body: withData(createPaymentSchema, { proof: binary.optional() }) },
  responses: { 201: onePayment('Created'), ...errorResponses },
});

registry.registerPath({
  ...paymentDocs,
  method: 'patch',
  path: `${item}/payments/{paymentId}`,
  summary: 'Edit a payment (switching to cash clears the sender details and screenshot)',
  request: { ...paymentRequest, body: jsonContent(updatePaymentSchema) },
  responses: { 200: onePayment('Updated'), ...errorResponses },
});

registry.registerPath({
  ...paymentDocs,
  method: 'post',
  path: `${item}/payments/{paymentId}/proof`,
  summary: 'Upload or replace the screenshot of an online payment (multipart "proof")',
  request: {
    ...paymentRequest,
    body: { content: { 'multipart/form-data': { schema: z.object({ proof: binary }) } } },
  },
  responses: { 200: onePayment('Updated'), ...errorResponses },
});

registry.registerPath({
  ...paymentDocs,
  method: 'get',
  path: `${item}/payments/{paymentId}/proof-url`,
  summary: 'Download link for the payment screenshot',
  request: paymentRequest,
  responses: { 200: signedUrl, ...errorResponses },
});

registry.registerPath({
  ...paymentDocs,
  method: 'delete',
  path: `${item}/payments/{paymentId}`,
  summary: 'Remove a payment (soft delete)',
  request: paymentRequest,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
