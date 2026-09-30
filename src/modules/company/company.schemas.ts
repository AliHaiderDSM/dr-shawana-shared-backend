import { z } from 'zod';
import { dataEnvelope, errorResponses, jsonContent } from '../../lib/http';
import { bearerAuth, registry } from '../../lib/openapi';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const updateCompanyInfoSchema = registry.register(
  'UpdateCompanyInfo',
  z.object({
    name: z.string().trim().min(2).max(150),
    phone: optionalText(30),
    email: z.email().trim().toLowerCase().max(150).nullable().optional(),
    address: optionalText(500),
    logoPath: optionalText(500),
  }),
);

export const companyInfoSchema = registry.register(
  'CompanyInfo',
  z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    logoPath: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  }),
);

export type UpdateCompanyInfoInput = z.output<typeof updateCompanyInfoSchema>;

const common = { tags: ['Super Admin: company'], security: [{ [bearerAuth.name]: [] }] };

registry.registerPath({
  ...common,
  method: 'get',
  path: '/admin/company-info',
  summary: 'Get company info (null until it is set)',
  responses: {
    200: { description: 'Company info', ...jsonContent(dataEnvelope(companyInfoSchema.nullable())) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...common,
  method: 'put',
  path: '/admin/company-info',
  summary: 'Create or replace company info',
  request: { body: jsonContent(updateCompanyInfoSchema) },
  responses: {
    200: { description: 'Saved', ...jsonContent(dataEnvelope(companyInfoSchema)) },
    ...errorResponses,
  },
});
