import { z } from 'zod';
import {
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  branchQuerySchema,
  jsonContent,
  pageEnvelope,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { registerCrudDocs, securedDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import {
  atLeastOneField,
  dateInput,
  moneyInput,
  moneyOutput,
  optionalText,
  optionalUuid,
  positiveQuantityInput,
  quantityInput,
  quantityOutput,
  requiredText,
} from '../../lib/validation';
import { PRODUCT_STATUSES } from './product.entity';

const purchaseFields = z.object({
  supplierId: optionalUuid,
  date: dateInput,
  quantity: positiveQuantityInput,
  unitPrice: moneyInput,
  note: optionalText(1000),
});

export const barcodeInput = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[!-~]+$/, 'Use the printed barcode characters only')
  .openapi({ example: '8964000123456' });

export const barcodeParamsSchema = z.object({ code: barcodeInput });

const productFields = z.object({
  name: requiredText(1, 200),
  categoryId: z.uuid(),
  sku: z.string().trim().min(1).max(60).nullable().optional(),
  barcode: barcodeInput.nullable().optional(),
  batchNo: optionalText(100).openapi({ description: 'posSoft "Gram" / batch label' }),
  sizeGrams: quantityInput
    .nullable()
    .optional()
    .openapi({ description: 'Pack size in grams, used for production loss' }),
  unit: z.string().trim().min(1).max(30).optional(),
  lowStockThreshold: quantityInput.optional(),
  salePrice: moneyInput.optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
});

export const createPurchaseSchema = registry.register('CreatePurchaseEntry', purchaseFields);
export const updatePurchaseSchema = registry.register('UpdatePurchaseEntry', atLeastOneField(purchaseFields));

export const createProductSchema = registry.register(
  'CreateProduct',
  productFields.extend({ initialPurchase: purchaseFields.optional() }),
);
export const updateProductSchema = registry.register('UpdateProduct', atLeastOneField(productFields));

export const productListQuerySchema = listQuerySchema(['name', 'createdAt', 'salePrice'], 'name').extend({
  categoryId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  branchId: z.uuid().optional(),
});

export const purchaseParamsSchema = z.object({ id: z.uuid(), entryId: z.uuid() });

export const purchaseSchema = registry.register(
  'PurchaseEntry',
  z.object({
    id: z.uuid(),
    productId: z.uuid(),
    supplierId: z.uuid().nullable(),
    supplier: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    date: z.iso.date(),
    quantity: quantityOutput,
    unitPrice: moneyOutput,
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

export const productSchema = registry.register(
  'Product',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    categoryId: z.uuid(),
    category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    sku: z.string().nullable(),
    barcode: z.string().nullable(),
    batchNo: z.string().nullable(),
    sizeGrams: quantityOutput.nullable(),
    unit: z.string(),
    lowStockThreshold: quantityOutput,
    salePrice: moneyOutput,
    status: z.enum(PRODUCT_STATUSES),
    trackSerials: z
      .boolean()
      .openapi({ description: 'Every piece carries a DSM label; sales, stock out and returns scan them' }),
    imagePath: z.string().nullable(),
    imageUrl: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateProductInput = z.output<typeof createProductSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
export type CreatePurchaseInput = z.output<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.output<typeof updatePurchaseSchema>;
export type ProductListQuery = z.output<typeof productListQuerySchema>;

registerCrudDocs({
  path: '/branch/products',
  tag: 'Products',
  noun: 'product',
  entity: productSchema,
  create: createProductSchema,
  update: updateProductSchema,
  listQuery: productListQuerySchema,
  options: z.object({
    id: z.uuid(),
    name: z.string(),
    salePrice: moneyOutput,
    batchNo: z.string().nullable(),
    barcode: z.string().nullable(),
  }),
  imageUpload: true,
});

const common = securedDocs('Products');
const onePurchase = (description: string) => ({ description, ...jsonContent(dataEnvelope(purchaseSchema)) });
const purchaseById = { params: purchaseParamsSchema, query: branchQuerySchema };

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/products/barcode/{code}',
  summary: 'Find the product with this scanned barcode (404 when none)',
  request: { params: barcodeParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Product', ...jsonContent(dataEnvelope(productSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/products/{id}/purchases',
  summary: 'Purchase / price entries of a product (newest first)',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: {
    200: { description: 'Entries', ...jsonContent(pageEnvelope(purchaseSchema)) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/products/{id}/purchases',
  summary: 'Add stock: a purchase entry (adds stock, sets the sale price to this price)',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(createPurchaseSchema) },
  responses: { 201: onePurchase('Created'), ...errorResponses },
});
registry.registerPath({
  ...common,
  method: 'patch',
  path: '/branch/products/{id}/purchases/{entryId}',
  summary: 'Correct a purchase entry (reverses and re-posts its stock movement)',
  request: { ...purchaseById, body: jsonContent(updatePurchaseSchema) },
  responses: { 200: onePurchase('Updated'), ...errorResponses },
});
registry.registerPath({
  ...common,
  method: 'delete',
  path: '/branch/products/{id}/purchases/{entryId}',
  summary: 'Remove a purchase entry (reverses its stock movement)',
  request: purchaseById,
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
