import { z } from 'zod';
import { dataEnvelope, errorResponses, jsonContent } from '../../lib/http';
import { bearerAuth, registry } from '../../lib/openapi';
import { ROLES } from '../../lib/permissions';
import { GENDERS } from '../staff/staff-profile.entity';
import { passwordSchema, staffSchema } from '../staff/staff.schemas';

export const loginSchema = registry.register(
  'Login',
  z.object({
    identifier: z.string().trim().min(3).max(150).openapi({ description: 'Username or email' }),
    password: z.string().min(1).max(72),
  }),
);

export const refreshSchema = registry.register(
  'RefreshSession',
  z.object({ refreshToken: z.string().min(10) }),
);

export const changePasswordSchema = registry.register(
  'ChangePassword',
  z
    .object({ currentPassword: z.string().min(1).max(72), newPassword: passwordSchema })
    .refine((v) => v.currentPassword !== v.newPassword, {
      path: ['newPassword'],
      message: 'New password must be different from the current one',
    }),
);

export const updateOwnProfileSchema = registry.register(
  'UpdateOwnProfile',
  z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      phone: z.string().trim().max(30).nullable(),
      gender: z.enum(GENDERS).nullable(),
      designation: z.string().trim().max(100).nullable(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
);

const meBranchSchema = z.object({ id: z.uuid(), name: z.string(), code: z.string(), city: z.string() });

export const meSchema = registry.register(
  'Me',
  z.object({
    profile: staffSchema,
    role: z.enum(ROLES),
    branch: meBranchSchema.nullable(),
    permissions: z.array(z.string()),
  }),
);

export const sessionSchema = registry.register(
  'Session',
  z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    tokenType: z.literal('bearer'),
    expiresIn: z.number().int(),
    expiresAt: z.number().int().nullable(),
    me: meSchema,
  }),
);

export type UpdateOwnProfileInput = z.output<typeof updateOwnProfileSchema>;

const publicRoute = { tags: ['Auth'] };
const securedRoute = { tags: ['Auth'], security: [{ [bearerAuth.name]: [] }] };

registry.registerPath({
  ...publicRoute,
  method: 'post',
  path: '/auth/login',
  summary: 'Staff login with username or email + password',
  request: { body: jsonContent(loginSchema) },
  responses: {
    200: { description: 'Session', ...jsonContent(dataEnvelope(sessionSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...publicRoute,
  method: 'post',
  path: '/auth/refresh',
  summary: 'Exchange a refresh token for a new session',
  request: { body: jsonContent(refreshSchema) },
  responses: {
    200: { description: 'Session', ...jsonContent(dataEnvelope(sessionSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...securedRoute,
  method: 'get',
  path: '/auth/me',
  summary: 'Current staff profile, branch and permissions (for building the menu)',
  responses: { 200: { description: 'Me', ...jsonContent(dataEnvelope(meSchema)) }, ...errorResponses },
});

registry.registerPath({
  ...securedRoute,
  method: 'patch',
  path: '/auth/me',
  summary: 'Update own profile (posSoft profile setting)',
  request: { body: jsonContent(updateOwnProfileSchema) },
  responses: { 200: { description: 'Me', ...jsonContent(dataEnvelope(meSchema)) }, ...errorResponses },
});

registry.registerPath({
  ...securedRoute,
  method: 'post',
  path: '/auth/change-password',
  summary: 'Change own password',
  request: { body: jsonContent(changePasswordSchema) },
  responses: { 204: { description: 'Password changed' }, ...errorResponses },
});
