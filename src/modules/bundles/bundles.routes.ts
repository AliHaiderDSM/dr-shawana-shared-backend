import { Router, type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { mountBranchCrud } from '../../lib/crud';
import { sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { imageUpload, requireFile } from '../../lib/upload';
import { requirePermission } from '../../middleware/requirePermission';
import { bundleListQuerySchema, createBundleSchema, updateBundleSchema } from './bundles.schemas';
import { bundlesService } from './bundles.service';

export const bundlesRouter = Router();

const path = '/branch/bundles';

async function uploadImage(req: Request, res: Response) {
  sendOk(res, await bundlesService.uploadImage(actorFrom(req), branchIdOf(req), idOf(req), requireFile(req)));
}

mountBranchCrud(bundlesRouter, {
  path,
  module: 'bundles',
  service: bundlesService,
  schemas: { list: bundleListQuerySchema, create: createBundleSchema, update: updateBundleSchema },
  extraItemRoutes: (byId) =>
    bundlesRouter.post(
      `${path}/:id/image`,
      requirePermission('bundles.update'),
      byId,
      imageUpload('image'),
      uploadImage,
    ),
});
