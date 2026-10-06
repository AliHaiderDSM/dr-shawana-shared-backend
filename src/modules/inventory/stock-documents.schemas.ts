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
import { serialInput, serialsInput } from './inventory-items.schemas';
import { multipartFiles, securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import {
  atLeastOneField,
  dateInput,
  moneyInput,
  moneyOutput,
  optionalText,
  optionalUuid,
  positiveQuantityInput,
  quantityOutput,
  requiredText,
} from '../../lib/validation';

const itemsOf = <T extends z.ZodRawShape>(shape: T) =>
  z
    .array(z.object({ productId: z.uuid(), qty: positiveQuantityInput, ...shape }))
    .min(1)
    .max(50);

const batchFields = {
  batch: optionalText(100).openapi({
    description: 'Batch number. Same number for the same product adds to that batch.',
  }),
  manufacturingDate: dateInput.nullable().optional(),
  expiryDate: dateInput.nullable().optional(),
  unitCost: moneyInput.nullable().optional().openapi({ description: 'Purchase price per unit' }),
};

interface BatchFieldValues {
  batch?: string | null;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
}

function batchIssues(item: BatchFieldValues) {
  const issues: { path: string; message: string }[] = [];
  if ((item.manufacturingDate || item.expiryDate) && !item.batch) {
    issues.push({ path: 'batch', message: 'Enter the batch number for these dates' });
  }
  if (item.manufacturingDate && item.expiryDate && item.expiryDate < item.manufacturingDate) {
    issues.push({ path: 'expiryDate', message: 'Expiry must be on or after the manufacturing date' });
  }
  return issues;
}

function checkBatchFields(items: BatchFieldValues[], ctx: z.RefinementCtx) {
  items.forEach((item, index) => {
    for (const issue of batchIssues(item)) {
      ctx.addIssue({ code: 'custom', path: [index, issue.path], message: issue.message });
    }
  });
}

export const createStockInSchema = registry.register(
  'CreateStockIn',
  z.object({
    supplierId: optionalUuid,
    date: dateInput,
    note: optionalText(1000),
    items: itemsOf({
      ...batchFields,
      labels: z.enum(['none', 'generate', 'existing']).optional().openapi({
        description:
          'generate: the system numbers a new label for every piece; existing: the packs already carry consecutive labels starting at firstSerial',
      }),
      firstSerial: serialInput.optional(),
    })
      .superRefine(checkBatchFields)
      .superRefine((items, ctx) =>
        items.forEach((item, index) => {
          if (item.labels === 'existing' && !item.firstSerial) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'firstSerial'],
              message: 'Enter the first label number',
            });
          }
        }),
      ),
  }),
);

export const createStockOutSchema = registry.register(
  'CreateStockOut',
  z
    .object({
      dispatcherId: optionalUuid,
      toBranchId: optionalUuid.openapi({
        description:
          'Super Admin stock only: the branch that receives the stock. Its Stock In is created automatically.',
      }),
      date: dateInput,
      note: optionalText(1000),
      items: itemsOf({ destination: optionalText(150), serials: serialsInput.optional() }),
    })
    .superRefine((value, ctx) => {
      if (value.toBranchId) return;
      value.items.forEach((item, index) => {
        if (!item.destination) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'destination'],
            message: 'Where does it go?',
          });
        }
      });
    }),
);

export const updateStockInSchema = registry.register(
  'UpdateStockIn',
  atLeastOneField(
    z.object({
      supplierId: z.uuid().nullable(),
      productId: z.uuid(),
      date: dateInput,
      qty: positiveQuantityInput,
      batch: z.string().trim().max(100).nullable(),
      manufacturingDate: dateInput.nullable(),
      expiryDate: dateInput.nullable(),
      unitCost: moneyInput.nullable(),
      note: z.string().trim().max(1000).nullable(),
    }),
  ).superRefine((value, ctx) => {
    for (const issue of batchIssues(value)) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  }),
);

export const updateStockOutSchema = registry.register(
  'UpdateStockOut',
  atLeastOneField(
    z.object({
      dispatcherId: z.uuid().nullable(),
      productId: z.uuid(),
      date: dateInput,
      qty: positiveQuantityInput,
      destination: requiredText(1, 150),
      note: z.string().trim().max(1000).nullable(),
    }),
  ),
);

const documentFilters = {
  productId: z.uuid().optional(),
  partyId: z.uuid().optional(),
  createdBy: z.uuid().optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  branchId: z.uuid().optional(),
};

export const stockInListQuerySchema = listQuerySchema(['date', 'createdAt'], '-date').extend(documentFilters);
export const stockOutListQuerySchema = listQuerySchema(['date', 'createdAt'], '-date').extend({
  ...documentFilters,
  destination: z.string().trim().max(150).optional(),
});

export const attachmentParamsSchema = z.object({ id: z.uuid(), attachmentId: z.uuid() });

const attachmentSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.iso.datetime(),
});

const labelRangeSchema = z
  .object({ count: z.number().int(), firstSerial: z.string(), lastSerial: z.string() })
  .nullable()
  .openapi({ description: 'Labelled pieces of this entry' });
const documentBase = {
  id: z.uuid(),
  branchId: z.uuid(),
  productId: z.uuid(),
  product: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  date: z.iso.date(),
  qty: quantityOutput,
  note: z.string().nullable(),
  attachments: z.array(attachmentSchema),
  labels: labelRangeSchema,
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
const partySchema = z.object({ id: z.uuid(), name: z.string() }).nullable();

export const stockInSchema = registry.register(
  'StockIn',
  z.object({
    ...documentBase,
    supplierId: z.uuid().nullable(),
    supplier: partySchema,
    batch: z.string().nullable(),
    batchId: z.uuid().nullable(),
    transferOutId: z
      .uuid()
      .nullable()
      .openapi({ description: 'Set when the stock came from the Super Admin stock' }),
    manufacturingDate: z.iso.date().nullable(),
    expiryDate: z.iso.date().nullable(),
    unitCost: moneyOutput.nullable(),
  }),
);
export const stockOutSchema = registry.register(
  'StockOut',
  z.object({
    ...documentBase,
    dispatcherId: z.uuid().nullable(),
    dispatcher: partySchema,
    destination: z.string(),
    toBranchId: z.uuid().nullable(),
    toBranch: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    batches: z
      .array(
        z.object({
          batchNo: z.string(),
          manufacturingDate: z.iso.date().nullable(),
          expiryDate: z.iso.date().nullable(),
          qty: quantityOutput,
        }),
      )
      .openapi({
        description: 'Batches this entry took stock from (FEFO, or the batches of the scanned labels)',
      }),
  }),
);

export type CreateStockInInput = z.output<typeof createStockInSchema>;
export type CreateStockOutInput = z.output<typeof createStockOutSchema>;
export type UpdateStockInInput = z.output<typeof updateStockInSchema>;
export type UpdateStockOutInput = z.output<typeof updateStockOutSchema>;
export type StockDocumentListQuery = z.output<typeof stockOutListQuerySchema>;

function registerDocumentPaths(
  path: string,
  tag: string,
  entity: z.ZodType,
  create: z.ZodType,
  update: z.ZodType,
  list: z.ZodObject,
) {
  const common = securedDocs(tag);
  const byId = { params: idParamsSchema, query: branchQuerySchema };
  const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(entity)) });

  registry.registerPath({
    ...common,
    method: 'get',
    path,
    summary: 'List entries',
    request: { query: list },
    responses: { 200: { description: 'Page', ...jsonContent(pageEnvelope(entity)) }, ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path,
    summary:
      'Create one entry per item. Send JSON, or multipart with a "data" JSON field plus "files" (shared by every item, like posSoft).',
    request: { query: branchQuerySchema, body: multipartFiles(create) },
    responses: {
      201: { description: 'Created', ...jsonContent(dataEnvelope(z.array(entity))) },
      422: { ...errorResponses[409], description: 'Not enough stock' },
      ...errorResponses,
    },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: `${path}/{id}`,
    summary: 'Get an entry',
    request: byId,
    responses: { 200: one('Entry'), ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'patch',
    path: `${path}/{id}`,
    summary: 'Edit an entry (reverses its stock movement and posts a new one)',
    request: { ...byId, body: jsonContent(update) },
    responses: { 200: one('Updated'), ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'delete',
    path: `${path}/{id}`,
    summary: 'Remove an entry (reverses its stock movement)',
    request: byId,
    responses: { 204: { description: 'Removed' }, ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'post',
    path: `${path}/{id}/attachments`,
    summary: 'Attach files (multipart "files", images or PDF, max 10 MB each)',
    request: { ...byId, body: multipartFiles() },
    responses: { 200: one('Updated'), ...errorResponses },
  });
  registry.registerPath({
    ...common,
    method: 'get',
    path: `${path}/{id}/attachments/{attachmentId}/url`,
    summary: 'Short-lived download link for an attachment',
    request: { params: attachmentParamsSchema, query: branchQuerySchema },
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
    method: 'delete',
    path: `${path}/{id}/attachments/{attachmentId}`,
    summary: 'Remove an attachment',
    request: { params: attachmentParamsSchema, query: branchQuerySchema },
    responses: { 204: { description: 'Removed' }, ...errorResponses },
  });
}

registerDocumentPaths(
  '/branch/stock-ins',
  'Stock in',
  stockInSchema,
  createStockInSchema,
  updateStockInSchema,
  stockInListQuerySchema,
);
registerDocumentPaths(
  '/branch/stock-outs',
  'Stock out',
  stockOutSchema,
  createStockOutSchema,
  updateStockOutSchema,
  stockOutListQuerySchema,
);
