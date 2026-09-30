import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { multipartImage, registerCrudDocs, securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, dateInput, moneyInput, moneyOutput, optionalText } from '../../lib/validation';
import { passwordSchema, staffDetailsSchema } from '../staff/staff.schemas';
import { APPOINTMENT_STATUSES } from '../appointments/appointment.entity';
import { DOCTOR_STATUSES } from './doctor.entity';

const doctorFields = z.object({
  displayName: z.string().trim().min(1).max(150),
  phone: optionalText(30),
  email: z.email().trim().toLowerCase().max(150).nullable().optional(),
  details: optionalText(5000),
  consultationFee: moneyInput,
  commissionPercent: z
    .union([z.number(), z.string().trim()])
    .transform((v) => String(v))
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, 'Use a percentage from 0 to 100')
    .openapi({ type: 'string', example: '3', description: 'Doctor sale report commission (posSoft: 3%)' }),
  status: z.enum(DOCTOR_STATUSES),
});

export const createDoctorSchema = registry.register(
  'CreateDoctor',
  doctorFields
    .partial()
    .extend({
      staffId: z.uuid().optional().openapi({ description: 'Link an existing doctor-role staff member' }),
      account: staffDetailsSchema
        .extend({ password: passwordSchema })
        .optional()
        .openapi({ description: 'Create the doctor login in the same step, as posSoft did' }),
    })
    .refine((v) => (v.staffId ? 1 : 0) + (v.account ? 1 : 0) === 1, {
      message: 'Provide either staffId or account',
      path: ['staffId'],
    }),
);

export const updateDoctorSchema = registry.register('UpdateDoctor', atLeastOneField(doctorFields));

export const doctorListQuerySchema = listQuerySchema(['displayName', 'createdAt'], 'displayName').extend({
  status: z.enum(DOCTOR_STATUSES).optional(),
  branchId: z.uuid().optional(),
});

export const doctorSlotsQuerySchema = z.object({ date: dateInput, branchId: z.uuid().optional() });

export const doctorSchema = registry.register(
  'Doctor',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    staffId: z.uuid(),
    displayName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    details: z.string().nullable(),
    consultationFee: moneyOutput,
    commissionPercent: z.string(),
    status: z.enum(DOCTOR_STATUSES),
    hasSignature: z.boolean(),
    staff: z.object({ id: z.uuid(), username: z.string(), email: z.string(), status: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const doctorOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  consultationFee: moneyOutput,
});

const slotSchema = z.object({
  appointmentId: z.uuid(),
  appointmentNo: z.number().int(),
  timeFrom: z.string().openapi({ example: '10:00:00' }),
  timeTo: z.string().openapi({ example: '10:30:00' }),
  status: z.enum(APPOINTMENT_STATUSES),
});

export type CreateDoctorInput = z.output<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.output<typeof updateDoctorSchema>;
export type DoctorListQuery = z.output<typeof doctorListQuerySchema>;

registerCrudDocs({
  path: '/branch/doctors',
  tag: 'Doctors',
  noun: 'doctor',
  entity: doctorSchema,
  create: createDoctorSchema,
  update: updateDoctorSchema,
  listQuery: doctorListQuerySchema,
  options: doctorOptionSchema,
});

const common = securedDocs('Doctors');

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/doctors/me',
  summary: 'The doctor profile of the signed-in doctor',
  request: { query: branchQuerySchema },
  responses: {
    200: { description: 'Doctor', ...jsonContent(dataEnvelope(doctorSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/doctors/{id}/slots',
  summary: "The doctor's booked times on a date (posSoft shows these while booking)",
  request: { params: idParamsSchema, query: doctorSlotsQuerySchema },
  responses: {
    200: { description: 'Slots', ...jsonContent(dataEnvelope(z.array(slotSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/doctors/{id}/signature',
  summary: 'Upload the signature image printed on prescriptions (multipart "image", private)',
  request: { params: idParamsSchema, query: branchQuerySchema, body: multipartImage },
  responses: {
    200: { description: 'Updated', ...jsonContent(dataEnvelope(doctorSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/doctors/{id}/signature-url',
  summary: 'Short-lived link to the doctor signature',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});
