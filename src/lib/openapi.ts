import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Supabase access token',
});

export function generateOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'DSM Clinic Platform API',
      version: '1.0.0',
      description:
        'Multi-branch clinic backend (rebuild of posSoft). All routes are under /api/v1. ' +
        'Success: `{ data, meta? }`. Error: `{ error: { code, message, details? } }`.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
