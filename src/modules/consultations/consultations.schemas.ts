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
import { dateInput } from '../../lib/validation';
import { SECTION_KEYS } from './consultation-section.entity';
import { CONSULTATION_STATUSES } from './consultation.entity';
import { SECTION_SCHEMAS } from './section-schemas';

export const consultationListQuerySchema = listQuerySchema(['date', 'createdAt'], '-date').extend({
  patientId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
  status: z.enum(CONSULTATION_STATUSES).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

export const sectionParamsSchema = z.object({ id: z.uuid(), key: z.enum(SECTION_KEYS) });
export const consultationStatusSchema = registry.register(
  'ConsultationStatusChange',
  z.object({ status: z.enum(CONSULTATION_STATUSES) }),
);

export type ConsultationListQuery = z.output<typeof consultationListQuerySchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

const mrsScoresSchema = z.object({
  somatic: z.number(),
  psychological: z.number(),
  urogenital: z.number(),
  total: z.number(),
  percentage: z.number(),
  severity: z.enum(['none', 'mild', 'moderate', 'severe']),
});

const sectionViewSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    scores: mrsScoresSchema.optional(),
    updatedBy: z.uuid().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .nullable();

const consultationSummarySchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  status: z.enum(CONSULTATION_STATUSES),
  appointmentId: z.uuid(),
  appointment: z
    .object({
      id: z.uuid(),
      appointmentNo: z.number().int(),
      date: z.iso.date(),
      timeFrom: z.string(),
      visitType: z.string(),
      mode: z.string(),
      status: z.string(),
    })
    .nullable(),
  patientId: z.uuid(),
  patient: z
    .object({
      id: z.uuid(),
      name: z.string(),
      phone: z.string(),
      age: z.number().nullable(),
      city: z.string(),
      bhrtStatus: z.string(),
    })
    .nullable(),
  doctorId: z.uuid(),
  doctor: ref.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const consultationSchema = registry.register(
  'Consultation',
  consultationSummarySchema.extend({
    availableSections: z.array(z.enum(SECTION_KEYS)),
    sections: z.object(Object.fromEntries(SECTION_KEYS.map((k) => [k, sectionViewSchema]))),
  }),
);

for (const [key, schema] of Object.entries(SECTION_SCHEMAS)) {
  registry.register(`Section_${key}`, schema as z.ZodType);
}

const common = securedDocs('Consultations');
const byId = { params: idParamsSchema, query: branchQuerySchema };
const detail = (description: string) => ({ description, ...jsonContent(dataEnvelope(consultationSchema)) });

registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/appointments/{id}/consultation',
  summary:
    'Open the consultation (posSoft "Remarks") of an appointment; returns the existing one if already open',
  request: byId,
  responses: { 200: detail('Existing'), 201: detail('Opened'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/appointments/{id}/consultation',
  summary: 'The consultation of an appointment',
  request: byId,
  responses: { 200: detail('Consultation'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/consultations',
  summary: 'List consultations (doctors see only their own)',
  request: { query: consultationListQuerySchema },
  responses: {
    200: { description: 'Page', ...jsonContent(pageEnvelope(consultationSummarySchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/consultations/{id}',
  summary: 'Consultation with every section; availableSections lists the tabs to show',
  request: byId,
  responses: { 200: detail('Consultation'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'put',
  path: '/branch/consultations/{id}/sections/{key}',
  summary:
    'Save one section (replaces it). The body is the section schema Section_<key> in docs/CLINICAL_FIELDS.md. basic_info also updates the patient name, age, city and country; referral updates the date of birth.',
  request: {
    params: sectionParamsSchema,
    query: branchQuerySchema,
    body: jsonContent(z.record(z.string(), z.unknown())),
  },
  responses: {
    200: {
      description: 'Saved',
      ...jsonContent(
        dataEnvelope(
          z.object({
            key: z.enum(SECTION_KEYS),
            section: sectionViewSchema,
            availableSections: z.array(z.enum(SECTION_KEYS)),
          }),
        ),
      ),
    },
    422: { ...errorResponses[409], description: 'Section not available for this consultation' },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/consultations/{id}/status',
  summary: 'Mark a consultation open or completed',
  request: { ...byId, body: jsonContent(consultationStatusSchema) },
  responses: { 200: detail('Updated'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'delete',
  path: '/branch/consultations/{id}',
  summary: 'Remove a consultation and its sections (soft delete)',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/consultations/{id}/referral-letter',
  summary: 'Data for the "Referred to Specialist" letter',
  request: byId,
  responses: {
    200: {
      description: 'Letter data',
      ...jsonContent(
        dataEnvelope(
          z.object({
            company: z
              .object({
                name: z.string(),
                phone: z.string().nullable(),
                email: z.string().nullable(),
                logoPath: z.string().nullable(),
              })
              .nullable(),
            referral: z.record(z.string(), z.unknown()),
            patient: z.object({ name: z.string(), phone: z.string(), dateOfBirth: z.iso.date().nullable() }),
            doctor: ref.nullable(),
          }),
        ),
      ),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/patients/{id}/mrs-history',
  summary: 'MRS scores of the patient over time (this branch)',
  request: byId,
  responses: {
    200: {
      description: 'History',
      ...jsonContent(
        dataEnvelope(
          z.array(z.object({ consultationId: z.uuid(), date: z.iso.date(), scores: mrsScoresSchema })),
        ),
      ),
    },
    ...errorResponses,
  },
});

export const consultationHistorySchema = registry.register(
  'ConsultationHistory',
  z.object({
    visits: z.array(
      z.object({
        id: z.uuid(),
        appointmentNo: z.number().int(),
        date: z.iso.date(),
        visitType: z.string(),
        status: z.string(),
        issues: z.string().nullable(),
        remark: z.string().nullable(),
        doctor: z.string().nullable(),
      }),
    ),
    prescriptions: z.array(
      z.object({
        id: z.uuid(),
        prescriptionNo: z.number().int(),
        date: z.iso.date(),
        doctor: z.string().nullable(),
        thisVisit: z.boolean(),
        previous: z.boolean(),
      }),
    ),
    previousSymptoms: z
      .object({
        appointmentNo: z.number().int(),
        date: z.iso.date(),
        symptoms: z.array(z.string()),
        severity: z.record(z.string(), z.number()),
      })
      .nullable(),
  }),
);

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/consultations/{id}/history',
  summary:
    'The patient’s other appointments with their issues and remarks, every prescription (previous or new), and the additional symptoms of the last earlier visit',
  request: byId,
  responses: {
    200: { description: 'History', ...jsonContent(dataEnvelope(consultationHistorySchema)) },
    ...errorResponses,
  },
});
