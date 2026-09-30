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
import { atLeastOneField, dateInput, optionalText, optionalUuid, requiredText } from '../../lib/validation';
import { PRESCRIPTION_CATEGORIES } from './prescription-catalog-item.entity';
import { TEMPLATE_VERSIONS } from './prescription.entity';

const catalogFields = z.object({
  category: z.enum(PRESCRIPTION_CATEGORIES),
  groupName: requiredText(1, 150),
  name: requiredText(1, 255),
  defaultDose: optionalText(2000),
  defaultInstructions: optionalText(5000),
  productId: optionalUuid,
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

export const createCatalogItemSchema = registry.register('CreatePrescriptionCatalogItem', catalogFields);
export const updateCatalogItemSchema = registry.register(
  'UpdatePrescriptionCatalogItem',
  atLeastOneField(catalogFields),
);
export const catalogQuerySchema = z.object({
  category: z.enum(PRESCRIPTION_CATEGORIES).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  branchId: z.uuid().optional(),
});

const itemInput = z
  .object({
    catalogItemId: z.uuid().optional(),
    category: z.enum(PRESCRIPTION_CATEGORIES).optional(),
    groupName: z.string().trim().min(1).max(150).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    dose: optionalText(2000),
    instructions: optionalText(5000),
    optional: z.boolean().optional(),
  })
  .refine((v) => v.catalogItemId || (v.name && v.category), {
    message: 'Pick a catalog item, or give a name and category',
    path: ['catalogItemId'],
  });

const notesSchema = z.object({
  blood: optionalText(5000),
  imaging: optionalText(5000),
  supplements: optionalText(5000),
  skinCare: optionalText(5000),
  hairCare: optionalText(5000),
});

const prescriptionFields = {
  date: dateInput.optional(),
  diagnosis: requiredText(1, 5000),
  notes: notesSchema.default({}),
  planTreatment: optionalText(50000),
  followupDate: dateInput.nullable().optional(),
  items: z.array(itemInput).max(200).default([]),
};

export const createPrescriptionSchema = registry.register(
  'CreatePrescription',
  z
    .object({
      patientId: z.uuid().optional(),
      doctorId: z.uuid().optional().openapi({ description: 'Required unless the user is a doctor' }),
      consultationId: z.uuid().optional().openapi({ description: 'Patient and doctor are taken from it' }),
      ...prescriptionFields,
    })
    .refine((v) => v.patientId || v.consultationId, {
      message: 'Provide patientId or consultationId',
      path: ['patientId'],
    }),
);

export const updatePrescriptionSchema = registry.register(
  'UpdatePrescription',
  atLeastOneField(
    z.object({
      date: dateInput,
      diagnosis: requiredText(1, 5000),
      notes: notesSchema,
      planTreatment: z.string().trim().max(50000).nullable(),
      followupDate: dateInput.nullable(),
      items: z.array(itemInput).max(200),
    }),
  ),
);

export const prescriptionListQuerySchema = listQuerySchema(
  ['date', 'createdAt', 'prescriptionNo'],
  '-date',
).extend({
  patientId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
  consultationId: z.uuid().optional(),
  templateVersion: z.enum(TEMPLATE_VERSIONS).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
});

export type CreateCatalogItemInput = z.output<typeof createCatalogItemSchema>;
export type UpdateCatalogItemInput = z.output<typeof updateCatalogItemSchema>;
export type CatalogQuery = z.output<typeof catalogQuerySchema>;
export type PrescriptionItemInput = z.output<typeof itemInput>;
export type CreatePrescriptionInput = z.output<typeof createPrescriptionSchema>;
export type UpdatePrescriptionInput = z.output<typeof updatePrescriptionSchema>;
export type PrescriptionListQuery = z.output<typeof prescriptionListQuerySchema>;

const ref = z.object({ id: z.uuid(), name: z.string() });

export const catalogItemSchema = registry.register(
  'PrescriptionCatalogItem',
  z.object({
    id: z.uuid(),
    code: z.string(),
    category: z.enum(PRESCRIPTION_CATEGORIES),
    groupName: z.string(),
    name: z.string(),
    defaultDose: z.string().nullable(),
    defaultInstructions: z.string().nullable(),
    productId: z.uuid().nullable(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  }),
);

const itemSchema = z.object({
  id: z.uuid(),
  catalogItemId: z.uuid().nullable(),
  category: z.enum(PRESCRIPTION_CATEGORIES),
  groupName: z.string(),
  name: z.string(),
  dose: z.string().nullable(),
  instructions: z.string().nullable(),
  optional: z.boolean(),
  sortOrder: z.number().int(),
});

export const prescriptionSchema = registry.register(
  'Prescription',
  z.object({
    id: z.uuid(),
    prescriptionNo: z.number().int().openapi({ description: 'Shown as PRE#<number>' }),
    branchId: z.uuid(),
    patientId: z.uuid(),
    patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string() }).nullable(),
    doctorId: z.uuid(),
    doctor: ref.nullable(),
    consultationId: z.uuid().nullable(),
    date: z.iso.date(),
    diagnosis: z.string(),
    notes: z.record(z.string(), z.string().nullable()),
    planTreatment: z.string().nullable(),
    followupDate: z.iso.date().nullable(),
    templateVersion: z.enum(TEMPLATE_VERSIONS),
    items: z.array(itemSchema),
    createdBy: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const printSchema = registry.register(
  'PrescriptionPrint',
  z.object({
    company: z
      .object({ name: z.string(), phone: z.string().nullable(), logoPath: z.string().nullable() })
      .nullable(),
    doctor: z.object({
      name: z.string(),
      phone: z.string().nullable(),
      details: z.string().nullable(),
      signatureUrl: z.string().nullable(),
    }),
    patient: z.object({
      name: z.string(),
      phone: z.string(),
      age: z.number().nullable(),
      city: z.string(),
      country: z.string().nullable(),
    }),
    prescription: prescriptionSchema.omit({ items: true }),
    sections: z.array(
      z.object({
        category: z.enum(PRESCRIPTION_CATEGORIES),
        note: z.string().nullable(),
        groups: z.array(z.object({ groupName: z.string(), items: z.array(itemSchema) })),
      }),
    ),
  }),
);

const catalogDocs = securedDocs('Prescription catalog');
const docs = securedDocs('Prescriptions');
const byId = { params: idParamsSchema, query: branchQuerySchema };
const one = (description: string, schema: z.ZodType) => ({
  description,
  ...jsonContent(dataEnvelope(schema)),
});

registry.registerPath({
  ...catalogDocs,
  method: 'get',
  path: '/branch/prescription-catalog',
  summary: 'Prescription items of the branch in form order (active only unless includeInactive=true)',
  request: { query: catalogQuerySchema },
  responses: { 200: one('Catalog', z.array(catalogItemSchema)), ...errorResponses },
});
registry.registerPath({
  ...catalogDocs,
  method: 'post',
  path: '/branch/prescription-catalog',
  summary: 'Add a catalog item (Branch Admin)',
  request: { query: branchQuerySchema, body: jsonContent(createCatalogItemSchema) },
  responses: { 201: one('Created', catalogItemSchema), ...errorResponses },
});
registry.registerPath({
  ...catalogDocs,
  method: 'patch',
  path: '/branch/prescription-catalog/{id}',
  summary: 'Edit or deactivate a catalog item (Branch Admin)',
  request: { ...byId, body: jsonContent(updateCatalogItemSchema) },
  responses: { 200: one('Updated', catalogItemSchema), ...errorResponses },
});
registry.registerPath({
  ...catalogDocs,
  method: 'delete',
  path: '/branch/prescription-catalog/{id}',
  summary: 'Remove a catalog item (Branch Admin); old prescriptions keep their copy',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/prescriptions',
  summary: 'List prescriptions (doctors see only their own); search by PRE# or patient',
  request: { query: prescriptionListQuerySchema },
  responses: {
    200: { description: 'Page', ...jsonContent(pageEnvelope(prescriptionSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/prescriptions',
  summary: 'Write a prescription. Catalog items copy their name, dose and instructions unless overridden.',
  request: { query: branchQuerySchema, body: jsonContent(createPrescriptionSchema) },
  responses: { 201: one('Created', prescriptionSchema), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/prescriptions/{id}',
  summary: 'Get a prescription',
  request: byId,
  responses: { 200: one('Prescription', prescriptionSchema), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'patch',
  path: '/branch/prescriptions/{id}',
  summary: 'Edit a prescription; "items" replaces the item list. Audited.',
  request: { ...byId, body: jsonContent(updatePrescriptionSchema) },
  responses: { 200: one('Updated', prescriptionSchema), ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'delete',
  path: '/branch/prescriptions/{id}',
  summary: 'Remove a prescription (soft delete, audited)',
  request: byId,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/prescriptions/{id}/print',
  summary: 'Data for the printed prescription, grouped in posSoft order, with a signed signature URL',
  request: byId,
  responses: { 200: one('Print data', printSchema), ...errorResponses },
});
