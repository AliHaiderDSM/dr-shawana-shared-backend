import { Router } from 'express';
import { z } from 'zod';
import { dataEnvelope, errorResponses, jsonContent, sendNoContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { authenticate } from '../../middleware/auth';
import { validate, validBody } from '../../middleware/validate';
import { staffPush } from './push.service';

const subscriptionSchema = registry.register(
  'StaffPushSubscription',
  z.object({
    endpoint: z.url().max(2000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
);
const unsubscribeSchema = z.object({ endpoint: z.url().max(2000) });

const docs = securedDocs('Push notifications');

registry.registerPath({
  ...docs,
  method: 'get',
  path: '/branch/push/public-key',
  summary: 'VAPID public key for browser push subscriptions; null when web push is not configured',
  responses: {
    200: { description: 'Key', ...jsonContent(dataEnvelope(z.object({ publicKey: z.string() }).nullable())) },
    ...errorResponses,
  },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/push/subscriptions',
  summary:
    'Save this browser for push notifications. The signed-in staff member then gets a notification when one of their sidebar badges (requests, approvals, returns, patient messages) goes up, even with the dashboard closed.',
  request: { body: { content: { 'application/json': { schema: subscriptionSchema } } } },
  responses: { 204: { description: 'Saved' }, ...errorResponses },
});
registry.registerPath({
  ...docs,
  method: 'post',
  path: '/branch/push/unsubscribe',
  summary: 'Stop push notifications for this browser',
  request: { body: { content: { 'application/json': { schema: unsubscribeSchema } } } },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

export const pushRouter = Router();

pushRouter.get('/branch/push/public-key', authenticate, (_req, res) => {
  const publicKey = staffPush.publicKey();
  sendOk(res, publicKey ? { publicKey } : null);
});

pushRouter.post(
  '/branch/push/subscriptions',
  authenticate,
  validate({ body: subscriptionSchema }),
  async (req, res) => {
    await staffPush.subscribe(
      { id: req.auth!.userId, role: req.auth!.role, branchId: req.auth!.branchId },
      validBody(req, subscriptionSchema),
      req.get('user-agent') ?? null,
    );
    sendNoContent(res);
  },
);

pushRouter.post(
  '/branch/push/unsubscribe',
  authenticate,
  validate({ body: unsubscribeSchema }),
  async (req, res) => {
    await staffPush.unsubscribe(req.auth!.userId, validBody(req, unsubscribeSchema).endpoint);
    sendNoContent(res);
  },
);
