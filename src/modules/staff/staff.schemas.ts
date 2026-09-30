import { z } from 'zod';
import {
  branchQuerySchema,
  dataEnvelope,
  errorResponses,
  idParamsSchema,
  jsonContent,
  pageEnvelope,
} from '../../lib/http';
import { bearerAuth, registry } from '../../lib/openapi';
import { listQuerySchema } from '../../lib/pagination';
import { BRANCH_ROLES, ROLES } from '../../lib/permissions';
import { GENDERS, STAFF_STATUSES } from './staff-profile.entity';

export const passwordSchema = z.string().min(8).max(72);

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/, 'Use 3-50 letters, digits, dot, dash or underscore');

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const staffDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email().trim().toLowerCase().max(150),
  username: usernameSchema,
  phone: optionalText(30),
  gender: z.enum(GENDERS).nullable().optional(),
  designation: optionalText(100),
});

export const createStaffSchema = registry.register(
  'CreateStaff',
  staffDetailsSchema.extend({ role: z.enum(BRANCH_ROLES), password: passwordSchema }),
);

export const createBranchAdminSchema = registry.register(
  'CreateBranchAdmin',
  staffDetailsSchema.extend({ password: passwordSchema }),
);

export const updateStaffSchema = registry.register(
  'UpdateStaff',
  staffDetailsSchema
    .extend({ role: z.enum(BRANCH_ROLES) })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
);

export const resetPasswordSchema = registry.register('ResetPassword', z.object({ password: passwordSchema }));

export const staffListQuerySchema = listQuerySchema([
  'createdAt',
  'firstName',
  'lastName',
  'username',
  'role',
]).extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(STAFF_STATUSES).optional(),
  branchId: z.uuid().optional(),
});

export const staffSchema = registry.register(
  'Staff',
  z.object({
    id: z.uuid(),
    branchId: z.uuid().nullable(),
    role: z.enum(ROLES),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    username: z.string(),
    phone: z.string().nullable(),
    gender: z.enum(GENDERS).nullable(),
    designation: z.string().nullable(),
    avatarPath: z.string().nullable(),
    status: z.enum(STAFF_STATUSES),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export type CreateStaffInput = z.output<typeof createStaffSchema>;
export type UpdateStaffInput = z.output<typeof updateStaffSchema>;

const common = { tags: ['Branch staff'], security: [{ [bearerAuth.name]: [] }] };

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/staff',
  summary: 'List staff of the branch (super_admin: pass ?branchId=)',
  request: { query: staffListQuerySchema },
  responses: {
    200: { description: 'Staff page', ...jsonContent(pageEnvelope(staffSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/staff',
  summary: 'Create a staff member with a login',
  request: { query: branchQuerySchema, body: jsonContent(createStaffSchema) },
  responses: {
    201: { description: 'Created', ...jsonContent(dataEnvelope(staffSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'get',
  path: '/branch/staff/{id}',
  summary: 'Get a staff member',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: { 200: { description: 'Staff', ...jsonContent(dataEnvelope(staffSchema)) }, ...errorResponses },
});

registry.registerPath({
  ...common,
  method: 'patch',
  path: '/branch/staff/{id}',
  summary: 'Edit a staff member',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(updateStaffSchema) },
  responses: {
    200: { description: 'Updated', ...jsonContent(dataEnvelope(staffSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'delete',
  path: '/branch/staff/{id}',
  summary: 'Remove a staff member (soft delete, login blocked)',
  request: { params: idParamsSchema, query: branchQuerySchema },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

for (const action of ['activate', 'deactivate'] as const) {
  registry.registerPath({
    ...common,
    method: 'post',
    path: `/branch/staff/{id}/${action}`,
    summary: `${action === 'activate' ? 'Activate' : 'Deactivate'} a staff member`,
    request: { params: idParamsSchema, query: branchQuerySchema },
    responses: {
      200: { description: 'Updated', ...jsonContent(dataEnvelope(staffSchema)) },
      ...errorResponses,
    },
  });
}

registry.registerPath({
  ...common,
  method: 'post',
  path: '/branch/staff/{id}/reset-password',
  summary: 'Set a temporary password (user must change it at next login)',
  request: { params: idParamsSchema, query: branchQuerySchema, body: jsonContent(resetPasswordSchema) },
  responses: {
    200: { description: 'Password reset', ...jsonContent(dataEnvelope(staffSchema)) },
    ...errorResponses,
  },
});
