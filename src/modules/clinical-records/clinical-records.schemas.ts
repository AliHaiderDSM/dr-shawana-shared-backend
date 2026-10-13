import { z } from 'zod';
import { branchQuerySchema, dataEnvelope, errorResponses, idParamsSchema, jsonContent } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { multipartFiles, securedDocs } from '../../lib/openapi-crud';
import {
  atLeastOneField,
  dateInput,
  optionalText,
  quantityInput,
  quantityOutput,
} from '../../lib/validation';
import { MEDICAL_RECORD_TYPES } from '../medical-records/medical-record.entity';
import { BHRT_LOG_STATUSES } from './bhrt-status-log.entity';
import { BLOOD_TESTS, type BloodTest } from './blood-work-result.entity';

export const BLOOD_TEST_UNITS: Record<BloodTest, string> = {
  fsh: 'mIU/mL',
  estradiol: 'pg/mL',
  testosterone_free: 'pg/mL',
  testosterone_total: 'ng/dL',
  dhea_s: 'µg/dL',
  vit_d3: 'µg/dL',
  tsh: 'µIU/mL',
  ferritin: 'ng/mL',
  b12: 'pg/mL',
};

const unitInput = z.string().trim().min(1).max(20);

export const addBloodWorkSchema = registry.register(
  'AddBloodWork',
  z.object({
    consultationId: z.uuid().nullable().optional(),
    results: z
      .array(
        z.object({
          test: z.enum(BLOOD_TESTS),
          value: quantityInput,
          testDate: dateInput,
          unit: unitInput.optional(),
        }),
      )
      .min(1)
      .max(BLOOD_TESTS.length * 3),
  }),
);

export const updateBloodWorkSchema = registry.register(
  'UpdateBloodWork',
  atLeastOneField(z.object({ value: quantityInput, testDate: dateInput, unit: unitInput })),
);

export const addBhrtSchema = registry.register(
  'AddBhrtStatus',
  z.object({
    status: z.enum(BHRT_LOG_STATUSES),
    date: dateInput.optional(),
    note: optionalText(20000),
    appointmentId: z.uuid().nullable().optional(),
  }),
);

export const medicalRecordFields = z.object({
  type: z.enum(MEDICAL_RECORD_TYPES).default('medical_record'),
  date: dateInput.optional(),
  note: optionalText(20000),
  appointmentId: z.uuid().nullable().optional(),
});
export const createMedicalRecordSchema = registry.register('CreateMedicalRecord', medicalRecordFields);
export const updateMedicalRecordSchema = registry.register(
  'UpdateMedicalRecord',
  atLeastOneField(
    z.object({
      type: z.enum(MEDICAL_RECORD_TYPES),
      date: dateInput,
      note: z.string().trim().max(20000).nullable(),
    }),
  ),
);
export const medicalRecordListQuerySchema = z.object({
  type: z.enum(MEDICAL_RECORD_TYPES).optional(),
  branchId: z.uuid().optional(),
});

export const resultParamsSchema = z.object({ id: z.uuid(), resultId: z.uuid() });
export const recordParamsSchema = z.object({ id: z.uuid(), recordId: z.uuid() });
export const recordFileParamsSchema = z.object({ id: z.uuid(), recordId: z.uuid(), fileId: z.uuid() });

export type AddBloodWorkInput = z.output<typeof addBloodWorkSchema>;
export type UpdateBloodWorkInput = z.output<typeof updateBloodWorkSchema>;
export type AddBhrtInput = z.output<typeof addBhrtSchema>;
export type CreateMedicalRecordInput = z.output<typeof createMedicalRecordSchema>;
export type UpdateMedicalRecordInput = z.output<typeof updateMedicalRecordSchema>;

const bloodResultSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  consultationId: z.uuid().nullable(),
  test: z.enum(BLOOD_TESTS),
  value: quantityOutput,
  unit: z.string(),
  testDate: z.iso.date(),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

const bloodWorkSchema = registry.register(
  'BloodWork',
  z.object({
    results: z.array(bloodResultSchema),
    dates: z.array(z.iso.date()),
    tests: z.array(
      z.object({
        test: z.enum(BLOOD_TESTS),
        unit: z.string(),
        points: z.array(z.object({ id: z.uuid(), date: z.iso.date(), value: quantityOutput })),
      }),
    ),
  }),
);

const bhrtEntrySchema = registry.register(
  'BhrtStatusEntry',
  z.object({
    id: z.uuid(),
    patientId: z.uuid(),
    appointmentId: z.uuid().nullable(),
    date: z.iso.date(),
    status: z.enum(BHRT_LOG_STATUSES),
    note: z.string().nullable(),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

const fileSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.iso.datetime(),
});

const medicalRecordSchema = registry.register(
  'MedicalRecord',
  z.object({
    id: z.uuid(),
    patientId: z.uuid(),
    appointmentId: z.uuid().nullable(),
    type: z.enum(MEDICAL_RECORD_TYPES),
    date: z.iso.date(),
    note: z.string().nullable(),
    uploadedByPatient: z.boolean(),
    files: z.array(fileSchema),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

const bloodDocs = securedDocs('Blood work');
const bhrtDocs = securedDocs('BHRT');
const recordDocs = securedDocs('Medical records');
const byPatient = { params: idParamsSchema, query: branchQuerySchema };
const ok = (description: string, schema: z.ZodType) => ({
  description,
  ...jsonContent(dataEnvelope(schema)),
});

registry.registerPath({
  ...bloodDocs,
  method: 'get',
  path: '/branch/patients/{id}/blood-work',
  summary: 'Blood work of the patient in this branch, as rows and as chart series',
  request: byPatient,
  responses: { 200: ok('Blood work', bloodWorkSchema), ...errorResponses },
});
registry.registerPath({
  ...bloodDocs,
  method: 'post',
  path: '/branch/patients/{id}/blood-work',
  summary: 'Add blood test results (one row per test; the unit defaults to the posSoft unit)',
  request: { ...byPatient, body: jsonContent(addBloodWorkSchema) },
  responses: { 201: ok('Added', z.array(bloodResultSchema)), ...errorResponses },
});
registry.registerPath({
  ...bloodDocs,
  method: 'patch',
  path: '/branch/patients/{id}/blood-work/{resultId}',
  summary: 'Correct one result',
  request: { params: resultParamsSchema, query: branchQuerySchema, body: jsonContent(updateBloodWorkSchema) },
  responses: { 200: ok('Updated', bloodResultSchema), ...errorResponses },
});
registry.registerPath({
  ...bloodDocs,
  method: 'delete',
  path: '/branch/patients/{id}/blood-work/{resultId}',
  summary: 'Remove one result',
  request: { params: resultParamsSchema, query: branchQuerySchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...bhrtDocs,
  method: 'get',
  path: '/branch/patients/{id}/bhrt',
  summary: 'BHRT status history of the patient in this branch, newest first',
  request: byPatient,
  responses: { 200: ok('History', z.array(bhrtEntrySchema)), ...errorResponses },
});
registry.registerPath({
  ...bhrtDocs,
  method: 'post',
  path: '/branch/patients/{id}/bhrt',
  summary: "Record a BHRT status; the newest entry sets the patient's BHRT status (other → none)",
  request: { ...byPatient, body: jsonContent(addBhrtSchema) },
  responses: { 201: ok('Recorded', bhrtEntrySchema), ...errorResponses },
});

registry.registerPath({
  ...recordDocs,
  method: 'get',
  path: '/branch/patients/{id}/medical-records',
  summary: 'Medical records and imaging files of the patient in this branch',
  request: { params: idParamsSchema, query: medicalRecordListQuerySchema },
  responses: { 200: ok('Records', z.array(medicalRecordSchema)), ...errorResponses },
});
registry.registerPath({
  ...recordDocs,
  method: 'post',
  path: '/branch/patients/{id}/medical-records',
  summary: 'Add a medical record. JSON, or multipart with "data" plus "files" (images/PDF, 10 MB each)',
  request: { ...byPatient, body: multipartFiles(createMedicalRecordSchema) },
  responses: { 201: ok('Added', medicalRecordSchema), ...errorResponses },
});
registry.registerPath({
  ...recordDocs,
  method: 'patch',
  path: '/branch/patients/{id}/medical-records/{recordId}',
  summary: 'Edit a medical record',
  request: {
    params: recordParamsSchema,
    query: branchQuerySchema,
    body: jsonContent(updateMedicalRecordSchema),
  },
  responses: { 200: ok('Updated', medicalRecordSchema), ...errorResponses },
});
registry.registerPath({
  ...recordDocs,
  method: 'delete',
  path: '/branch/patients/{id}/medical-records/{recordId}',
  summary: 'Remove a medical record and its files',
  request: { params: recordParamsSchema, query: branchQuerySchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
registry.registerPath({
  ...recordDocs,
  method: 'post',
  path: '/branch/patients/{id}/medical-records/{recordId}/files',
  summary: 'Attach files to a medical record (multipart "files")',
  request: { params: recordParamsSchema, query: branchQuerySchema, body: multipartFiles() },
  responses: { 200: ok('Updated', medicalRecordSchema), ...errorResponses },
});
registry.registerPath({
  ...recordDocs,
  method: 'delete',
  path: '/branch/patients/{id}/medical-records/{recordId}/files/{fileId}',
  summary: 'Remove one file of a medical record',
  request: { params: recordFileParamsSchema, query: branchQuerySchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

export const summaryParamsSchema = z.object({ id: z.uuid(), summaryId: z.uuid() });
export const summaryFileParamsSchema = summaryParamsSchema.extend({
  index: z.coerce.number().int().min(0).max(9),
});

export const reportSummarySchema = registry.register(
  'LabReportSummary',
  z.object({
    id: z.uuid(),
    testDate: z.iso.date().nullable(),
    fileName: z.string().nullable(),
    files: z
      .array(
        z.object({
          index: z.number().int(),
          name: z.string(),
          contentType: z.string(),
          sizeBytes: z.number().int(),
          recordFileId: z.uuid().nullable(),
          stored: z.boolean(),
        }),
      )
      .openapi({
        description:
          'Reports read for this summary. A saved record file opens by recordFileId; an uploaded one through the summary file link when stored.',
      }),
    valuesFound: z.number().int(),
    model: z.string().nullable(),
    createdAt: z.string(),
    createdBy: z.string().nullable(),
    summary: z.object({
      patient: z.array(z.object({ label: z.string(), value: z.string() })),
      abnormal: z.array(
        z.object({
          test: z.string(),
          value: z.string(),
          unit: z.string(),
          range: z.string(),
          flag: z.string(),
        }),
      ),
      normal: z.array(z.object({ category: z.string(), tests: z.string() })),
      overview: z.string(),
      reviewPoints: z.array(z.string()),
      unreadable: z.array(z.string()),
      documents: z
        .array(z.object({ name: z.string(), date: z.iso.date().nullable(), detail: z.string() }))
        .optional()
        .openapi({ description: 'What each uploaded document holds' }),
    }),
  }),
);

export const readReportSchema = registry.register(
  'ReadBloodReport',
  z.object({
    testDate: z.iso.date().nullable(),
    results: z.array(
      z.object({
        test: z.enum(BLOOD_TESTS),
        value: z.string(),
        unit: z.string(),
        testDate: z.iso
          .date()
          .nullable()
          .openapi({ description: 'Date of the document the value came from' }),
      }),
    ),
    summary: reportSummarySchema
      .nullable()
      .openapi({ description: 'AI summary of the whole report, saved on the patient' }),
  }),
);

export const readReportBodySchema = z.object({
  recordFileIds: z
    .preprocess(
      (value) =>
        value === undefined || value === ''
          ? []
          : Array.isArray(value)
            ? value
            : String(value)
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
      z.array(z.uuid()).max(5),
    )
    .openapi({ description: 'Saved medical record files to read with the uploaded ones' }),
});

registry.registerPath({
  ...securedDocs('Clinical records'),
  method: 'get',
  path: '/branch/patients/{id}/report-summaries',
  summary: 'AI summaries of the lab reports read for this patient, newest first',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Summaries', ...jsonContent(dataEnvelope(z.array(reportSummarySchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...securedDocs('Clinical records'),
  method: 'get',
  path: '/branch/patients/{id}/report-summaries/{summaryId}/files/{index}/url',
  summary: 'Short-lived link to a report uploaded with an AI summary',
  request: { params: summaryFileParamsSchema, query: branchQuerySchema },
  responses: {
    200: {
      description: 'Signed URL',
      ...jsonContent(dataEnvelope(z.object({ url: z.string(), expiresIn: z.number() }))),
    },
    ...errorResponses,
  },
});

registry.registerPath({
  ...securedDocs('Clinical records'),
  method: 'delete',
  path: '/branch/patients/{id}/report-summaries/{summaryId}',
  summary: 'Remove one AI report summary',
  request: { params: summaryParamsSchema, query: branchQuerySchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...securedDocs('Clinical records'),
  method: 'post',
  path: '/branch/patients/{id}/blood-work/read-report',
  summary:
    'Read blood work values with AI from up to 5 reports: uploaded ones (multipart "files": PDFs or images) and saved medical record files ("recordFileIds"). One clinical summary of all of them is saved on the patient with the uploaded files kept beside it. The values are not saved (the caller saves them).',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Values found', ...jsonContent(dataEnvelope(readReportSchema)) },
    ...errorResponses,
  },
});
