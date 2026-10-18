import { Router } from 'express';
import { z } from 'zod';
import { dataEnvelope, errorResponses, jsonContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { realtime } from '../../lib/realtime';
import { authenticate } from '../../middleware/auth';
import { STAFF_TOPIC_ID } from '../../middleware/staffNotify';
import { branchScope } from '../../middleware/branchScope';
import { badgeCounts } from './badges.service';

export const badgesRouter = Router();

const countsSchema = registry.register(
  'SidebarBadges',
  z.object({
    stockRequests: z.number().int(),
    incomingStock: z.number().int(),
    writeOffs: z.number().int(),
    discountRequests: z.number().int(),
    returns: z.number().int(),
    stockReceipts: z.number().int(),
    patientRequests: z.number().int(),
    patientMessages: z.number().int(),
  }),
);

registry.registerPath({
  ...securedDocs('Sidebar'),
  method: 'get',
  path: '/branch/badges',
  summary:
    'Counts for the red sidebar badges. Super Admin: requests waiting for a decision or to send, transfers not received yet, write-offs and discounts to approve, returns to inspect. Branch: approved or on-the-way stock requests, transfers to receive, write-offs and discounts waiting or ready, returns to inspect.',
  responses: {
    200: { description: 'Counts', ...jsonContent(dataEnvelope(countsSchema)) },
    ...errorResponses,
  },
});

registry.registerPath({
  ...securedDocs('Sidebar'),
  method: 'get',
  path: '/branch/realtime/staff',
  summary:
    'Supabase Realtime channel that pings signed-in staff when a request, approval, return or patient message changes the sidebar badges (no data in the ping). Null when realtime is off.',
  responses: {
    200: {
      description: 'Realtime channel',
      ...jsonContent(
        dataEnvelope(z.object({ url: z.string(), key: z.string(), topic: z.string() }).nullable()),
      ),
    },
    ...errorResponses,
  },
});

badgesRouter.get('/branch/realtime/staff', authenticate, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendOk(res, realtime.config('staff', STAFF_TOPIC_ID));
});

badgesRouter.get(
  '/branch/badges',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendOk(
      res,
      await badgeCounts({
        isSuperAdmin: Boolean(req.auth?.isSuperAdmin),
        role: req.auth!.role,
        userId: req.auth!.userId,
        branchId: req.branchId ?? null,
      }),
    );
  },
);
