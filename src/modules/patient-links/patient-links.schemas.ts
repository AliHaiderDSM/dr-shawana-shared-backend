import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';

export const tokenParamsSchema = z.object({ token: z.string().min(10).max(2000) });
export const tokenFileParamsSchema = tokenParamsSchema.extend({ fileId: z.uuid() });
export const tokenSectionParamsSchema = tokenParamsSchema.extend({
  key: z.enum(['basic_info', 'medical_history', 'additional_symptoms']),
});
export const publicRecordSchema = z.object({
  type: z.enum(['medical_record', 'imaging']).default('medical_record'),
  note: z.string().trim().max(5000).nullable().optional(),
});

export const patientLinkSchema = registry.register(
  'PatientLink',
  z.object({ token: z.string(), expiresAt: z.iso.datetime() }),
);

export const publicPatientHistorySchema = registry.register(
  'PublicPatientHistory',
  z.object({
    clinic: z
      .object({ name: z.string(), phone: z.string().nullable(), address: z.string().nullable() })
      .nullable(),
    patient: z.object({ name: z.string(), city: z.string() }),
    phone: z.string().optional(),
    form: z
      .object({
        appointmentNo: z.number().int(),
        date: z.iso.date(),
        defaults: z
          .record(z.string(), z.unknown())
          .openapi({ description: 'Patient name, age, city and country to prefill the basic information' }),
        sections: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()),
      })
      .nullable()
      .optional()
      .openapi({ description: 'The intake form of the linked appointment; null for history-only links' }),
    resources: z.array(z.string()).optional().openapi({
      description:
        'Educational resources ticked Yes: glpDietPlan, generalDietPlan, liverDetox, skinCareRoutine, hairCareRoutine',
    }),
    expiresAt: z.iso.datetime(),
    appointments: z.array(
      z.object({
        appointmentNo: z.number().int(),
        date: z.iso.date(),
        timeFrom: z.string(),
        timeTo: z.string(),
        doctor: z.string().nullable(),
        mode: z.string(),
        status: z.string(),
      }),
    ),
    prescriptions: z.array(
      z.object({
        id: z.uuid(),
        prescriptionNo: z.number().int(),
        date: z.iso.date(),
        doctor: z.string().nullable(),
        diagnosis: z.string(),
        planTreatment: z.string().nullable(),
        followupDate: z.iso.date().nullable(),
        items: z.array(
          z.object({
            category: z.string(),
            name: z.string(),
            dose: z.string().nullable(),
            instructions: z.string().nullable(),
          }),
        ),
      }),
    ),
    bloodWork: z.array(
      z.object({ test: z.string(), value: z.string(), unit: z.string(), testDate: z.iso.date() }),
    ),
    bhrt: z.array(z.object({ date: z.iso.date(), status: z.string(), note: z.string().nullable() })),
    medicalRecords: z.array(
      z.object({
        id: z.uuid(),
        type: z.string(),
        date: z.iso.date(),
        note: z.string().nullable(),
        files: z.array(z.object({ id: z.uuid(), originalName: z.string(), contentType: z.string() })),
      }),
    ),
  }),
);

registry.registerPath({
  ...securedDocs('Appointments'),
  method: 'get',
  path: '/branch/appointments/{id}/patient-link',
  summary: 'posSoft "Copy Link": a signed link to the patient history that works without login for 30 days',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Link token', ...jsonContent(dataEnvelope(patientLinkSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  tags: ['Public'],
  method: 'get',
  path: '/public/patient-history/{token}',
  summary: 'Patient history for a signed link. No login.',
  request: { params: tokenParamsSchema },
  responses: {
    200: { description: 'History', ...jsonContent(dataEnvelope(publicPatientHistorySchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  tags: ['Public'],
  method: 'get',
  path: '/public/patient-history/{token}/files/{fileId}',
  summary: 'Short-lived download link for a medical record file of the linked patient. No login.',
  request: { params: tokenFileParamsSchema },
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  tags: ['Public'],
  method: 'put',
  path: '/public/patient-history/{token}/sections/{key}',
  summary:
    'The patient fills an intake section of the linked appointment (basic info, diagnosed with, other symptoms). No login.',
  request: { params: tokenSectionParamsSchema, body: jsonContent(z.record(z.string(), z.unknown())) },
  responses: {
    200: {
      description: 'Saved',
      ...jsonContent(
        dataEnvelope(z.object({ key: z.string(), data: z.record(z.string(), z.unknown()).nullable() })),
      ),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  tags: ['Public'],
  method: 'post',
  path: '/public/patient-history/{token}/medical-records',
  summary: 'The patient uploads medical records or imaging (multipart "data" + "files"). No login.',
  request: { params: tokenParamsSchema },
  responses: {
    200: { description: 'Uploaded', ...jsonContent(dataEnvelope(z.object({ id: z.uuid() }))) },
    ...errorResponses,
  },
});
