import { z } from 'zod';
import { dataEnvelope, errorResponses, idParamsSchema, jsonContent, pageEnvelope } from '../../lib/http';
import { bearerAuth, registry } from '../../lib/openapi';
import { listQuerySchema } from '../../lib/pagination';
import { createBranchAdminSchema, staffSchema } from '../staff/staff.schemas';
import { BRANCH_KINDS, BRANCH_STATUSES } from './branch.entity';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const branchFields = z.object({
  name: z.string().trim().min(2).max(150),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Use 2-10 letters or digits, e.g. LHR'),
  city: z.string().trim().min(2).max(100),
  address: optionalText(500),
  phone: optionalText(30),
  email: z.email().trim().toLowerCase().max(150).nullable().optional(),
  logoPath: optionalText(500),
});

export const createBranchSchema = registry.register('CreateBranch', branchFields);

export const updateBranchSchema = registry.register(
  'UpdateBranch',
  branchFields.partial().refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
);

export const branchListQuerySchema = listQuerySchema(['createdAt', 'name', 'code', 'city'], 'name').extend({
  status: z.enum(BRANCH_STATUSES).optional(),
});

export const branchSchema = registry.register(
  'Branch',
  z.object({
    id: z.uuid(),
    name: z.string(),
    code: z.string(),
    city: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    logoPath: z.string().nullable(),
    kind: z
      .enum(BRANCH_KINDS)
      .openapi({
        description: 'warehouse: the Super Admin stock (Super Admin only); branch: a selling branch',
      }),
    status: z.enum(BRANCH_STATUSES),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

const branchOptionSchema = branchSchema.pick({
  id: true,
  name: true,
  code: true,
  city: true,
  status: true,
  kind: true,
});

export type CreateBranchInput = z.output<typeof createBranchSchema>;
export type UpdateBranchInput = z.output<typeof updateBranchSchema>;

const common = { tags: ['Super Admin: branches'], security: [{ [bearerAuth.name]: [] }] };
const one = (description: string) => ({ description, ...jsonContent(dataEnvelope(branchSchema)) });

registry.registerPath({
  ...common,
  method: 'get',
  path: '/admin/branches',
  summary: 'List branches',
  request: { query: branchListQuerySchema },
  responses: {
    200: { description: 'Branches', ...jsonContent(pageEnvelope(branchSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/admin/branches/options',
  summary: 'Branch dropdown options',
  responses: {
    200: { description: 'Options', ...jsonContent(dataEnvelope(z.array(branchOptionSchema))) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'post',
  path: '/admin/branches',
  summary: 'Create a branch',
  request: { body: jsonContent(createBranchSchema) },
  responses: { 201: one('Created'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/admin/branches/{id}',
  summary: 'Get a branch',
  request: { params: idParamsSchema },
  responses: { 200: one('Branch'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'patch',
  path: '/admin/branches/{id}',
  summary: 'Edit a branch',
  request: { params: idParamsSchema, body: jsonContent(updateBranchSchema) },
  responses: { 200: one('Updated'), ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'delete',
  path: '/admin/branches/{id}',
  summary: 'Remove a branch that has no staff (soft delete)',
  request: { params: idParamsSchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

for (const action of ['activate', 'deactivate'] as const) {
  registry.registerPath({
    ...common,
    method: 'post',
    path: `/admin/branches/{id}/${action}`,
    summary: `${action === 'activate' ? 'Activate' : 'Deactivate'} a branch`,
    request: { params: idParamsSchema },
    responses: { 200: one('Updated'), ...errorResponses },
  });
}

registry.registerPath({
  ...common,
  method: 'post',
  path: '/admin/branches/{id}/admin',
  summary: 'Create the Branch Admin login of a branch',
  request: { params: idParamsSchema, body: jsonContent(createBranchAdminSchema) },
  responses: {
    201: { description: 'Created', ...jsonContent(dataEnvelope(staffSchema)) },
    ...errorResponses,
  },
});
