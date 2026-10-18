import { waitUntil } from '@vercel/functions';
import { type RequestHandler } from 'express';
import { logger } from '../lib/logger';
import { realtime } from '../lib/realtime';
import { staffPush } from '../modules/push/push.service';

const WATCHED = [
  /^\/branch\/stock-requests/,
  /^\/admin\/stock-requests/,
  /^\/branch\/incoming-stock/,
  /^\/branch\/stock-outs/,
  /^\/branch\/stock-ins/,
  /^\/branch\/stock-receipts/,
  /^\/branch\/inventory\/write-offs/,
  /^\/admin\/write-offs/,
  /^\/branch\/inventory\/batches\/[^/]+\/write-off/,
  /^\/branch\/discount-requests/,
  /^\/admin\/discount-requests/,
  /^\/branch\/returns/,
  /^\/admin\/returns/,
  /^\/branch\/sales\/[^/]+\/(cancel|dispatch)/,
  /^\/branch\/patient-requests/,
  /^\/patient\/requests/,
  /^\/patient\/chats/,
  /^\/branch\/chats/,
];

export const STAFF_TOPIC_ID = 'all';

export const notifyStaffOnChange: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!WATCHED.some((pattern) => pattern.test(req.path))) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    waitUntil(realtime.publish('staff', STAFF_TOPIC_ID, 'badges', {}));
    waitUntil(
      staffPush.notifyChanges().catch((err: unknown) => logger.warn({ err }, 'Push notifications failed')),
    );
  });
  next();
};
