import { z } from 'zod';
import { dataEnvelope, errorResponseSchema } from '../../lib/http';
import { registry } from '../../lib/openapi';

export const healthSchema = registry.register(
  'Health',
  z.object({
    status: z.enum(['ok', 'degraded']),
    database: z.enum(['up', 'down']),
    uptimeSeconds: z.number().int(),
    timestamp: z.iso.datetime(),
  }),
);

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Liveness + database check (runs `select 1`)',
  responses: {
    200: {
      description: 'API and database are up',
      content: { 'application/json': { schema: dataEnvelope(healthSchema) } },
    },
    503: {
      description: 'Database is unreachable',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
