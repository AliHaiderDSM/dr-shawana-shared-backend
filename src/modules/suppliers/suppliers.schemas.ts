import { z } from 'zod';
import { registry } from '../../lib/openapi';
import { registerCrudDocs } from '../../lib/openapi-crud';
import { listQuerySchema } from '../../lib/pagination';
import { atLeastOneField, optionalText, requiredText } from '../../lib/validation';
import { SUPPLIER_TYPES } from './supplier.entity';

const supplierFields = z.object({
  name: requiredText(1, 150),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\- ]{5,30}$/, 'Use digits, +, - or spaces'),
  address: optionalText(500),
  type: z.enum(SUPPLIER_TYPES),
});

export const createSupplierSchema = registry.register('CreateSupplier', supplierFields);
export const updateSupplierSchema = registry.register('UpdateSupplier', atLeastOneField(supplierFields));

export const supplierListQuerySchema = listQuerySchema(['name', 'createdAt', 'type'], 'name').extend({
  type: z.enum(SUPPLIER_TYPES).optional(),
  branchId: z.uuid().optional(),
});

export const supplierOptionsQuerySchema = z.object({
  type: z.enum(SUPPLIER_TYPES).optional(),
  branchId: z.uuid().optional(),
});

export const supplierSchema = registry.register(
  'Supplier',
  z.object({
    id: z.uuid(),
    branchId: z.uuid(),
    name: z.string(),
    phone: z.string(),
    address: z.string().nullable(),
    type: z.enum(SUPPLIER_TYPES),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateSupplierInput = z.output<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierSchema>;

registerCrudDocs({
  path: '/branch/suppliers',
  tag: 'Suppliers and dispatchers',
  noun: 'supplier',
  entity: supplierSchema,
  create: createSupplierSchema,
  update: updateSupplierSchema,
  listQuery: supplierListQuerySchema,
  options: z.object({ id: z.uuid(), name: z.string(), type: z.enum(SUPPLIER_TYPES) }),
});
