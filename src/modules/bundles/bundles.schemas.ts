import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { registerCrudDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import {
  moneyInput,
  moneyOutput,
  positiveQuantityInput,
  quantityOutput,
  requiredText,
} from '../../lib/validation';

const bundleItemInput = z.object({
  productId: z.uuid(),
  qty: positiveQuantityInput.optional(),
  price: moneyInput,
});

const bundleItems = z
  .array(bundleItemInput)
  .min(1)
  .max(100)
  .refine(
    (items) => new Set(items.map((i) => i.productId)).size === items.length,
    'Each product can appear once',
  );

export const createBundleSchema = registry.register(
  'CreateBundle',
  z.object({ name: requiredText(1, 150), items: bundleItems }),
);

export const updateBundleSchema = registry.register(
  'UpdateBundle',
  z
    .object({ name: requiredText(1, 150), items: bundleItems })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
);

export const bundleListQuerySchema = listQuerySchema(['name', 'createdAt', 'totalPrice'], 'name').extend({
  branchId: z.uuid().optional(),
});

export const bundleSchema = registry.register(
  'Bundle',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    totalPrice: moneyOutput,
    imagePath: z.string().nullable(),
    imageUrl: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        productId: z.uuid(),
        productName: z.string().nullable(),
        qty: quantityOutput,
        price: moneyOutput,
      }),
    ),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateBundleInput = z.output<typeof createBundleSchema>;
export type UpdateBundleInput = z.output<typeof updateBundleSchema>;
export type BundleItemInput = z.output<typeof bundleItemInput>;

registerCrudDocs({
  path: '/branch/bundles',
  tag: 'Bundles',
  noun: 'bundle',
  entity: bundleSchema,
  create: createBundleSchema,
  update: updateBundleSchema,
  listQuery: bundleListQuerySchema,
  options: z.object({ id: z.uuid(), name: z.string(), totalPrice: moneyOutput }),
  imageUpload: true,
});
