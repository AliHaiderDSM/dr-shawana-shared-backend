import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../lib/actor';
import { dataEnvelope, errorResponses, jsonContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { validate, validParams } from '../../middleware/validate';
import { TRACE_KINDS, traceService } from './trace.service';

export const traceRouter = Router();

const paramsSchema = z.object({ number: z.string().trim().min(3).max(40) });
const person = z.object({ id: z.uuid(), name: z.string(), role: z.string() }).nullable();

const traceSchema = registry.register(
  'Trace',
  z.object({
    kind: z.enum(TRACE_KINDS),
    number: z.string(),
    id: z.uuid(),
    status: z.string().nullable(),
    branch: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
    createdAt: z.string(),
    createdBy: person,
    fields: z.array(z.object({ label: z.string(), value: z.string().nullable() })),
    items: z.array(z.object({ name: z.string(), qty: z.string().nullable(), detail: z.string().nullable() })),
    links: z.array(
      z.object({ kind: z.enum(TRACE_KINDS), number: z.string(), status: z.string().nullable() }),
    ),
    timeline: z.array(z.object({ at: z.string(), action: z.string(), entity: z.string(), by: person })),
  }),
);

registry.registerPath({
  ...securedDocs('Trace'),
  method: 'get',
  path: '/branch/trace/{number}',
  summary:
    'Find any record by its number (invoice, return, stock request, transfer, discount request, write-off) with its items, linked records and every step from the audit log. Branches see only their own records.',
  request: { params: paramsSchema },
  responses: {
    200: { description: 'Record', ...jsonContent(dataEnvelope(traceSchema)) },
    ...errorResponses,
  },
});

traceRouter.get(
  '/branch/trace/:number',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  validate({ params: paramsSchema }),
  async (req, res) => {
    sendOk(
      res,
      await traceService.find(actorFrom(req), req.branchId ?? null, validParams(req, paramsSchema).number),
    );
  },
);
