import { randomUUID } from 'node:crypto';
import { type RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.valid = {};
  res.setHeader('X-Request-Id', req.id);
  next();
};
