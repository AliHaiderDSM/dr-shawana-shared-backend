import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { listQuerySchema } from '../../lib/pagination';
import { branchIdOf, idOf } from '../../lib/request';
import { requireFile } from '../../lib/upload';
import { validBody, validParams, validQuery } from '../../middleware/validate';
import { createPurchaseSchema, purchaseParamsSchema, updatePurchaseSchema } from './products.schemas';
import { productsService } from './products.service';

export const purchaseListQuerySchema = listQuerySchema(['createdAt', 'date']);

const entryOf = (req: Request) => validParams(req, purchaseParamsSchema);

export const productExtrasController = {
  async uploadImage(req: Request, res: Response) {
    sendOk(
      res,
      await productsService.uploadImage(actorFrom(req), branchIdOf(req), idOf(req), requireFile(req)),
    );
  },

  async listPurchases(req: Request, res: Response) {
    const query = validQuery(req, purchaseListQuerySchema);
    const { items, meta } = await productsService.listPurchases(branchIdOf(req), idOf(req), query);
    sendOk(res, items, meta);
  },

  async addPurchase(req: Request, res: Response) {
    const input = validBody(req, createPurchaseSchema);
    sendCreated(res, await productsService.addPurchase(actorFrom(req), branchIdOf(req), idOf(req), input));
  },

  async updatePurchase(req: Request, res: Response) {
    const { id, entryId } = entryOf(req);
    const input = validBody(req, updatePurchaseSchema);
    sendOk(res, await productsService.updatePurchase(actorFrom(req), branchIdOf(req), id, entryId, input));
  },

  async removePurchase(req: Request, res: Response) {
    const { id, entryId } = entryOf(req);
    await productsService.removePurchase(actorFrom(req), branchIdOf(req), id, entryId);
    sendNoContent(res);
  },
};
