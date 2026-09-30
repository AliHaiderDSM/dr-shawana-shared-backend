import { Router, type Request } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { documentsUpload, documentUpload, jsonDataField, requireFile, uploadedFiles } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { saleDocumentsService } from './sale-documents.service';
import {
  createSalePaymentSchema,
  createSaleSchema,
  deliverySlipsQuerySchema,
  deliveryStatusSchema,
  saleListQuerySchema,
  salePaymentParamsSchema,
  updateSalePaymentSchema,
  updateSaleSchema,
} from './sales.schemas';
import { salesService } from './sales.service';

export const salesRouter = Router();

const path = '/branch/sales';
const byId = validate({ params: idParamsSchema });
const byPayment = validate({ params: salePaymentParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`sales.${action}`);
const paymentOf = (req: Request) => validParams(req, salePaymentParamsSchema);

salesRouter.use(path, authenticate, branchScope());

salesRouter.get(path, can('view'), validate({ query: saleListQuerySchema }), async (req, res) => {
  const { items, meta } = await salesService.list(branchIdOf(req), validQuery(req, saleListQuerySchema));
  sendOk(res, items, meta);
});

salesRouter.get(
  `${path}/delivery-slips`,
  requirePermission('deliveryReport.view'),
  validate({ query: deliverySlipsQuerySchema }),
  async (req, res) => {
    sendOk(
      res,
      await saleDocumentsService.deliverySlips(branchIdOf(req), validQuery(req, deliverySlipsQuerySchema)),
    );
  },
);

salesRouter.post(
  path,
  can('create'),
  documentsUpload('paymentProofs', 10),
  jsonDataField,
  validate({ body: createSaleSchema }),
  async (req, res) => {
    const input = validBody(req, createSaleSchema);
    sendCreated(res, await salesService.create(actorFrom(req), branchIdOf(req), input, uploadedFiles(req)));
  },
);

salesRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await salesService.get(branchIdOf(req), idOf(req)));
});

salesRouter.get(`${path}/:id/bill`, can('view'), byId, async (req, res) => {
  sendOk(res, await saleDocumentsService.bill(branchIdOf(req), idOf(req)));
});

salesRouter.patch(
  `${path}/:id`,
  can('update'),
  validate({ params: idParamsSchema, body: updateSaleSchema }),
  async (req, res) => {
    const input = validBody(req, updateSaleSchema);
    sendOk(res, await salesService.update(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

salesRouter.post(
  `${path}/:id/delivery`,
  can('update'),
  validate({ params: idParamsSchema, body: deliveryStatusSchema }),
  async (req, res) => {
    const { status } = validBody(req, deliveryStatusSchema);
    sendOk(res, await salesService.setDelivery(actorFrom(req), branchIdOf(req), idOf(req), status));
  },
);

salesRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await salesService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});

salesRouter.post(
  `${path}/:id/payments`,
  can('update'),
  byId,
  documentUpload('proof'),
  jsonDataField,
  validate({ body: createSalePaymentSchema }),
  async (req, res) => {
    const input = validBody(req, createSalePaymentSchema);
    sendCreated(
      res,
      await salesService.addPayment(actorFrom(req), branchIdOf(req), idOf(req), input, req.file),
    );
  },
);

salesRouter.patch(
  `${path}/:id/payments/:paymentId`,
  can('update'),
  validate({ params: salePaymentParamsSchema, body: updateSalePaymentSchema }),
  async (req, res) => {
    const { id, paymentId } = paymentOf(req);
    const input = validBody(req, updateSalePaymentSchema);
    sendOk(res, await salesService.updatePayment(actorFrom(req), branchIdOf(req), id, paymentId, input));
  },
);

salesRouter.post(
  `${path}/:id/payments/:paymentId/proof`,
  can('update'),
  byPayment,
  documentUpload('proof'),
  async (req, res) => {
    const { id, paymentId } = paymentOf(req);
    sendOk(
      res,
      await salesService.setPaymentProof(actorFrom(req), branchIdOf(req), id, paymentId, requireFile(req)),
    );
  },
);

salesRouter.get(`${path}/:id/payments/:paymentId/proof-url`, can('view'), byPayment, async (req, res) => {
  const { id, paymentId } = paymentOf(req);
  sendOk(res, await salesService.paymentProofUrl(branchIdOf(req), id, paymentId));
});

salesRouter.delete(`${path}/:id/payments/:paymentId`, can('update'), byPayment, async (req, res) => {
  const { id, paymentId } = paymentOf(req);
  await salesService.removePayment(actorFrom(req), branchIdOf(req), id, paymentId);
  sendNoContent(res);
});
