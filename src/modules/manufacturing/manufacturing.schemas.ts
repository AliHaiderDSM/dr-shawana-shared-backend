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
import { registerCrudDocs, securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import {
  atLeastOneField,
  dateInput,
  optionalText,
  optionalUuid,
  positiveQuantityInput,
  quantityInput,
  quantityOutput,
  requiredText,
} from '../../lib/validation';
import { MATERIAL_LOCATIONS } from './material-movement.entity';
import { MATERIAL_PLACES } from './material-receipt.entity';

const branchId = { branchId: z.uuid().optional() };
const uniqueMaterials = <T extends { materialId: string }>(items: T[]) =>
  new Set(items.map((i) => i.materialId)).size === items.length;
const dateRange = { from: dateInput.optional(), to: dateInput.optional(), ...branchId };

const materialCategoryFields = z.object({ name: requiredText(1, 150) });
export const createMaterialCategorySchema = registry.register(
  'CreateMaterialCategory',
  materialCategoryFields,
);
export const updateMaterialCategorySchema = registry.register(
  'UpdateMaterialCategory',
  atLeastOneField(materialCategoryFields),
);
export const materialCategoryListQuerySchema = listQuerySchema(['name', 'createdAt'], 'name').extend(
  branchId,
);
export const materialCategorySchema = registry.register(
  'MaterialCategory',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const receiptFields = z.object({
  date: dateInput,
  quantity: positiveQuantityInput,
  place: z.enum(MATERIAL_PLACES).optional(),
  note: optionalText(1000),
});
export const createReceiptSchema = registry.register('CreateMaterialReceipt', receiptFields);
export const updateReceiptSchema = registry.register('UpdateMaterialReceipt', atLeastOneField(receiptFields));
export const receiptParamsSchema = z.object({ id: z.uuid(), receiptId: z.uuid() });
export const receiptListQuerySchema = listQuerySchema(['date', 'createdAt'], '-date').extend(branchId);

const materialFields = z.object({
  name: requiredText(1, 200),
  categoryId: z.uuid(),
  unit: z.string().trim().min(1).max(30).optional(),
  minimum: quantityInput.optional(),
  bareMinimum: quantityInput.optional(),
});
export const createMaterialSchema = registry.register(
  'CreateMaterial',
  materialFields
    .extend({ initialReceipt: receiptFields.optional() })
    .refine((v) => Number(v.bareMinimum ?? 0) <= Number(v.minimum ?? 0), {
      path: ['bareMinimum'],
      message: 'Bare minimum cannot be above minimum',
    }),
);
export const updateMaterialSchema = registry.register('UpdateMaterial', atLeastOneField(materialFields));
export const materialListQuerySchema = listQuerySchema(['name', 'createdAt'], 'name').extend({
  categoryId: z.uuid().optional(),
  ...branchId,
});

export const materialSchema = registry.register(
  'Material',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    categoryId: z.uuid(),
    category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    unit: z.string(),
    minimum: quantityOutput,
    bareMinimum: quantityOutput,
    storeQuantity: quantityOutput,
    labQuantity: quantityOutput,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const receiptSchema = registry.register(
  'MaterialReceipt',
  z.object({
    id: z.uuid(),
    materialId: z.uuid(),
    date: z.iso.date(),
    quantity: quantityOutput,
    place: z.enum(MATERIAL_PLACES),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

const recipeItems = z
  .array(z.object({ materialId: z.uuid(), qty: positiveQuantityInput.nullable().optional() }))
  .min(1)
  .max(100)
  .refine(uniqueMaterials, 'Each material can appear once');
const recipeFields = z.object({
  productId: z.uuid(),
  date: dateInput.optional(),
  note: optionalText(1000),
  items: recipeItems,
});
export const createRecipeSchema = registry.register('CreateRecipe', recipeFields);
export const updateRecipeSchema = registry.register('UpdateRecipe', atLeastOneField(recipeFields));
export const recipeListQuerySchema = listQuerySchema(['date', 'createdAt'], '-date').extend({
  productId: z.uuid().optional(),
  ...branchId,
});
export const recipeSchema = registry.register(
  'Recipe',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    productId: z.uuid(),
    product: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    date: z.iso.date(),
    note: z.string().nullable(),
    items: z.array(
      z.object({ materialId: z.uuid(), materialName: z.string().nullable(), qty: quantityOutput.nullable() }),
    ),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const batchItems = z
  .array(z.object({ materialId: z.uuid(), qty: positiveQuantityInput }))
  .min(1)
  .max(100)
  .refine(uniqueMaterials, 'Each material can appear once');

export const createLabTransferSchema = registry.register(
  'CreateLabTransfer',
  z.object({ batchNo: requiredText(1, 100), date: dateInput, note: optionalText(1000), items: batchItems }),
);

export const createProductionSchema = registry.register(
  'CreateProduction',
  z
    .object({
      labBatchId: z.uuid(),
      date: dateInput,
      note: optionalText(1000),
      items: batchItems,
      productId: optionalUuid,
      producedQty: positiveQuantityInput.nullable().optional(),
    })
    .refine((v) => Boolean(v.productId) === Boolean(v.producedQty), {
      path: ['producedQty'],
      message: 'Give both the finished product and its quantity, or neither',
    }),
);

export const batchListQuerySchema = listQuerySchema(['date', 'createdAt', 'batchNo'], '-date').extend(
  dateRange,
);

const batchSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  batchNo: z.string(),
  stage: z.enum(['pharmacy_lab', 'finished_product']),
  date: z.iso.date(),
  note: z.string().nullable(),
  labBatchId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  product: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  producedQty: quantityOutput.nullable(),
  totalQty: quantityOutput,
  items: z.array(
    z.object({ materialId: z.uuid(), materialName: z.string().nullable(), qty: quantityOutput }),
  ),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export const labTransferSchema = registry.register('LabTransfer', batchSchema);
export const productionSchema = registry.register('Production', batchSchema);

export const materialReportQuerySchema = z.object({
  ...dateRange,
  materialId: z.uuid().optional(),
  location: z.enum(MATERIAL_LOCATIONS).default('store'),
  level: z.enum(['all', 'minimum', 'bare_minimum']).default('all'),
});

export const finishedGoodsQuerySchema = z.object(dateRange);

export type CreateMaterialCategoryInput = z.output<typeof createMaterialCategorySchema>;
export type UpdateMaterialCategoryInput = z.output<typeof updateMaterialCategorySchema>;
export type CreateMaterialInput = z.output<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.output<typeof updateMaterialSchema>;
export type MaterialListQuery = z.output<typeof materialListQuerySchema>;
export type CreateReceiptInput = z.output<typeof createReceiptSchema>;
export type UpdateReceiptInput = z.output<typeof updateReceiptSchema>;
export type CreateRecipeInput = z.output<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.output<typeof updateRecipeSchema>;
export type RecipeListQuery = z.output<typeof recipeListQuerySchema>;
export type CreateLabTransferInput = z.output<typeof createLabTransferSchema>;
export type CreateProductionInput = z.output<typeof createProductionSchema>;
export type BatchListQuery = z.output<typeof batchListQuerySchema>;
export type MaterialReportQuery = z.output<typeof materialReportQuerySchema>;
export type FinishedGoodsQuery = z.output<typeof finishedGoodsQuerySchema>;

registerCrudDocs({
  path: '/branch/material-categories',
  tag: 'Manufacturing: materials',
  noun: 'material category',
  entity: materialCategorySchema,
  create: createMaterialCategorySchema,
  update: updateMaterialCategorySchema,
  listQuery: materialCategoryListQuerySchema,
  remove: 'Remove a material category that no material uses',
});

registerCrudDocs({
  path: '/branch/materials',
  tag: 'Manufacturing: materials',
  noun: 'material',
  entity: materialSchema,
  create: createMaterialSchema,
  update: updateMaterialSchema,
  listQuery: materialListQuerySchema,
});

registerCrudDocs({
  path: '/branch/recipes',
  tag: 'Manufacturing: recipes',
  noun: 'recipe',
  entity: recipeSchema,
  create: createRecipeSchema,
  update: updateRecipeSchema,
  listQuery: recipeListQuerySchema,
  options: z.object({ id: z.uuid(), productId: z.uuid(), productName: z.string() }),
});

const materialsDocs = securedDocs('Manufacturing: materials');
const receiptById = { params: receiptParamsSchema, query: branchQuerySchema };
registry.registerPath({
  ...materialsDocs,
  method: 'get',
  path: '/branch/materials/{id}/receipts',
  summary: 'Material in entries (posSoft materials_details)',
  request: { params: idParamsSchema, query: receiptListQuerySchema },
  responses: {
    200: { description: 'Receipts', ...jsonContent(pageEnvelope(receiptSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...materialsDocs,
  method: 'post',
  path: '/branch/materials/{id}/receipts',
  summary: 'Add material stock to the store',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(createReceiptSchema) },
  responses: {
    201: { description: 'Created', ...jsonContent(dataEnvelope(receiptSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...materialsDocs,
  method: 'patch',
  path: '/branch/materials/{id}/receipts/{receiptId}',
  summary: 'Correct a material receipt (reverses and re-posts)',
  request: { ...receiptById, body: jsonContent(updateReceiptSchema) },
  responses: {
    200: { description: 'Updated', ...jsonContent(dataEnvelope(receiptSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...materialsDocs,
  method: 'delete',
  path: '/branch/materials/{id}/receipts/{receiptId}',
  summary: 'Remove a material receipt (reverses its movement)',
  request: receiptById,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

function registerBatchDocs(path: string, tag: string, entity: z.ZodType, create: z.ZodType, summary: string) {
  const common = securedDocs(tag);
  const byId = { params: idParamsSchema, query: branchQuerySchema };
  registry.registerPath({
    ...common,
    method: 'get',
    path,
    summary: 'List batches',
    request: { query: batchListQuerySchema },
    responses: { 200: { description: 'Batches', ...jsonContent(pageEnvelope(entity)) }, ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path,
    summary,
    request: { query: branchQuerySchema, body: jsonContent(create) },
    responses: { 201: { description: 'Created', ...jsonContent(dataEnvelope(entity)) }, ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: `${path}/{id}`,
    summary: 'Get a batch',
    request: byId,
    responses: { 200: { description: 'Batch', ...jsonContent(dataEnvelope(entity)) }, ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'delete',
    path: `${path}/{id}`,
    summary: 'Remove a batch (reverses its movements)',
    request: byId,
    responses: { 204: { description: 'Removed' }, ...errorResponses },
  });
}

registerBatchDocs(
  '/branch/lab-transfers',
  'Manufacturing: lab transfers',
  labTransferSchema,
  createLabTransferSchema,
  'Store keeper: Material Out -> Pharmacy Lab (moves material from store to lab)',
);
registry.registerPath({
  ...securedDocs('Manufacturing: lab transfers'),
  method: 'get',
  path: '/branch/lab-transfers/options',
  summary: 'Lab batches for the pharmacy "Finished Product" form',
  request: { query: branchQuerySchema },
  responses: {
    200: {
      description: 'Options',
      ...jsonContent(
        dataEnvelope(z.array(z.object({ id: z.uuid(), batchNo: z.string(), date: z.iso.date() }))),
      ),
    },
    ...errorResponses,
  },
});
registerBatchDocs(
  '/branch/productions',
  'Manufacturing: production',
  productionSchema,
  createProductionSchema,
  'Pharmacy: Material Out -> Finished Product (uses lab material; optional product output adds stock)',
);

const reportsDocs = securedDocs('Manufacturing: reports');
registry.registerPath({
  ...reportsDocs,
  method: 'get',
  path: '/branch/manufacturing/material-report',
  summary: 'Material in / out / closing per location, with minimum and bare-minimum alerts',
  request: { query: materialReportQuerySchema },
  responses: {
    200: {
      description: 'Report',
      ...jsonContent(
        dataEnvelope(
          z.array(
            z.object({
              materialId: z.uuid(),
              name: z.string(),
              categoryName: z.string().nullable(),
              unit: z.string(),
              opening: quantityOutput,
              in: quantityOutput,
              out: quantityOutput,
              closing: quantityOutput,
              minimum: quantityOutput,
              bareMinimum: quantityOutput,
              alert: z.enum(['ok', 'minimum', 'bare_minimum']).nullable(),
            }),
          ),
        ),
      ),
    },
    ...errorResponses,
  },
});
registry.registerPath({
  ...reportsDocs,
  method: 'get',
  path: '/branch/manufacturing/finished-goods',
  summary: 'Finished product batches: material used, finished quantity and loss',
  request: { query: finishedGoodsQuerySchema },
  responses: {
    200: {
      description: 'Finished goods',
      ...jsonContent(
        dataEnvelope(
          z.array(
            z.object({
              batchId: z.uuid(),
              batchNo: z.string(),
              date: z.iso.date(),
              productName: z.string().nullable(),
              materialUsed: quantityOutput,
              finishedQty: quantityOutput,
              sizeGrams: quantityOutput.nullable(),
              lossGrams: quantityOutput.nullable(),
              lossPercent: z.string().nullable(),
            }),
          ),
        ),
      ),
    },
    ...errorResponses,
  },
});
