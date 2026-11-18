import { Router } from 'express';
import { AppError } from '../../lib/errors';
import { BUCKETS, downloadObject } from '../../lib/storage';

export const filesRouter = Router();

const SAFE_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/;

filesRouter.get('/files/product-images/*path', async (req, res) => {
  const objectPath = ([] as string[]).concat(req.params.path ?? []).join('/');
  if (!SAFE_PATH.test(objectPath) || objectPath.includes('..')) throw AppError.notFound('File');
  const file = await downloadObject(BUCKETS.productImages, objectPath);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(file.body);
});
