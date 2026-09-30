import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { registerCrudDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, requiredText } from '../../lib/validation';

const categoryFields = z.object({ name: requiredText(1, 150) });

export const createCategorySchema = registry.register('CreateCategory', categoryFields);
export const updateCategorySchema = registry.register('UpdateCategory', atLeastOneField(categoryFields));
export const categoryListQuerySchema = listQuerySchema(['name', 'createdAt'], 'name').extend({
  branchId: z.uuid().optional(),
});

export const categorySchema = registry.register(
  'Category',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    imagePath: z.string().nullable(),
    imageUrl: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;

registerCrudDocs({
  path: '/branch/categories',
  tag: 'Categories',
  noun: 'category',
  entity: categorySchema,
  create: createCategorySchema,
  update: updateCategorySchema,
  listQuery: categoryListQuerySchema,
  remove: 'Remove a category that no product uses',
  imageUpload: true,
});
