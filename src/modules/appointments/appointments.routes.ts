import { Router, type Request } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import {
  documentFieldsUpload,
  documentsUpload,
  documentUpload,
  filesOf,
  jsonDataField,
  requireFile,
  uploadedFiles,
} from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import { hasPermission } from '../../lib/permissions';
import { doctorsService } from '../doctors/doctors.service';
import { medicalFileParamsSchema } from '../patients/patients.schemas';
import { appointmentPaymentsService } from './appointment-payments.service';
import {
  appointmentListQuerySchema,
  appointmentStatusSchema,
  attachmentParamsSchema,
  calendarQuerySchema,
  createAppointmentSchema,
  createPaymentSchema,
  paymentParamsSchema,
  paymentReportQuerySchema,
  updateAppointmentSchema,
  updatePaymentSchema,
} from './appointments.schemas';
import { appointmentsService } from './appointments.service';

export const appointmentsRouter = Router();

const path = '/branch/appointments';
const byId = validate({ params: idParamsSchema });
const byPayment = validate({ params: paymentParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`appointments.${action}`);
const canPay = (action: 'view' | 'create' | 'update' | 'delete') =>
  requirePermission(`appointmentPayments.${action}`);

const viewerOf = (req: Request) => doctorsService.viewer(actorFrom(req), branchIdOf(req));
const paymentOf = (req: Request) => validParams(req, paymentParamsSchema);

appointmentsRouter.use(path, authenticate, branchScope());
appointmentsRouter.use('/branch/appointment-payments', authenticate, branchScope());

appointmentsRouter.get(
  '/branch/appointment-payments',
  canPay('view'),
  validate({ query: paymentReportQuerySchema }),
  async (req, res) => {
    const { items, meta } = await appointmentPaymentsService.report(
      await viewerOf(req),
      validQuery(req, paymentReportQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

appointmentsRouter.get(
  path,
  can('view'),
  validate({ query: appointmentListQuerySchema }),
  async (req, res) => {
    const { items, meta } = await appointmentsService.list(
      await viewerOf(req),
      validQuery(req, appointmentListQuerySchema),
    );
    sendOk(res, items, meta);
  },
);

appointmentsRouter.get(
  `${path}/calendar`,
  can('view'),
  validate({ query: calendarQuerySchema }),
  async (req, res) => {
    sendOk(
      res,
      await appointmentsService.calendar(await viewerOf(req), validQuery(req, calendarQuerySchema)),
    );
  },
);

appointmentsRouter.post(
  path,
  can('create'),
  documentFieldsUpload([
    { name: 'medicalRecordFiles', maxCount: 5 },
    { name: 'paymentProofs', maxCount: 10 },
  ]),
  jsonDataField,
  validate({ body: createAppointmentSchema }),
  async (req, res) => {
    const input = validBody(req, createAppointmentSchema);
    const actor = actorFrom(req);
    if (input.payments.length > 0 && !hasPermission(actor.role, 'appointmentPayments.create')) {
      throw AppError.forbidden('You cannot record appointment payments');
    }
    sendCreated(
      res,
      await appointmentsService.create(actor, await viewerOf(req), input, {
        medicalRecordFiles: filesOf(req, 'medicalRecordFiles'),
        paymentProofs: filesOf(req, 'paymentProofs'),
      }),
    );
  },
);

appointmentsRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await appointmentsService.get(await viewerOf(req), idOf(req)));
});

appointmentsRouter.patch(
  `${path}/:id`,
  can('update'),
  validate({ params: idParamsSchema, body: updateAppointmentSchema }),
  async (req, res) => {
    const input = validBody(req, updateAppointmentSchema);
    sendOk(res, await appointmentsService.update(actorFrom(req), await viewerOf(req), idOf(req), input));
  },
);

appointmentsRouter.post(
  `${path}/:id/status`,
  can('update'),
  byId,
  documentsUpload('files'),
  jsonDataField,
  validate({ body: appointmentStatusSchema }),
  async (req, res) => {
    const input = validBody(req, appointmentStatusSchema);
    sendOk(
      res,
      await appointmentsService.setStatus(
        actorFrom(req),
        await viewerOf(req),
        idOf(req),
        input,
        uploadedFiles(req),
      ),
    );
  },
);

appointmentsRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await appointmentsService.remove(actorFrom(req), await viewerOf(req), idOf(req));
  sendNoContent(res);
});

appointmentsRouter.get(
  `${path}/:id/attachments/:attachmentId/url`,
  can('view'),
  validate({ params: attachmentParamsSchema }),
  async (req, res) => {
    const { id, attachmentId } = validParams(req, attachmentParamsSchema);
    sendOk(res, await appointmentsService.attachmentUrl(await viewerOf(req), id, attachmentId));
  },
);

appointmentsRouter.delete(
  `${path}/:id/attachments/:attachmentId`,
  can('update'),
  validate({ params: attachmentParamsSchema }),
  async (req, res) => {
    const { id, attachmentId } = validParams(req, attachmentParamsSchema);
    await appointmentsService.removeAttachment(actorFrom(req), await viewerOf(req), id, attachmentId);
    sendNoContent(res);
  },
);

appointmentsRouter.get(
  `${path}/:id/medical-records/files/:fileId/url`,
  can('view'),
  validate({ params: medicalFileParamsSchema }),
  async (req, res) => {
    const { id, fileId } = validParams(req, medicalFileParamsSchema);
    sendOk(res, await appointmentsService.medicalFileUrl(await viewerOf(req), id, fileId));
  },
);

appointmentsRouter.get(`${path}/:id/payments`, canPay('view'), byId, async (req, res) => {
  sendOk(res, await appointmentPaymentsService.list(await viewerOf(req), idOf(req)));
});

appointmentsRouter.post(
  `${path}/:id/payments`,
  canPay('create'),
  byId,
  documentUpload('proof'),
  jsonDataField,
  validate({ body: createPaymentSchema }),
  async (req, res) => {
    const input = validBody(req, createPaymentSchema);
    sendCreated(
      res,
      await appointmentPaymentsService.add(actorFrom(req), await viewerOf(req), idOf(req), input, req.file),
    );
  },
);

appointmentsRouter.patch(
  `${path}/:id/payments/:paymentId`,
  canPay('update'),
  validate({ params: paymentParamsSchema, body: updatePaymentSchema }),
  async (req, res) => {
    const { id, paymentId } = paymentOf(req);
    const input = validBody(req, updatePaymentSchema);
    sendOk(
      res,
      await appointmentPaymentsService.update(actorFrom(req), await viewerOf(req), id, paymentId, input),
    );
  },
);

appointmentsRouter.post(
  `${path}/:id/payments/:paymentId/proof`,
  canPay('update'),
  byPayment,
  documentUpload('proof'),
  async (req, res) => {
    const { id, paymentId } = paymentOf(req);
    sendOk(
      res,
      await appointmentPaymentsService.setProof(
        actorFrom(req),
        await viewerOf(req),
        id,
        paymentId,
        requireFile(req),
      ),
    );
  },
);

appointmentsRouter.get(
  `${path}/:id/payments/:paymentId/proof-url`,
  canPay('view'),
  byPayment,
  async (req, res) => {
    const { id, paymentId } = paymentOf(req);
    sendOk(res, await appointmentPaymentsService.proofUrl(await viewerOf(req), id, paymentId));
  },
);

appointmentsRouter.delete(
  `${path}/:id/payments/:paymentId`,
  canPay('delete'),
  byPayment,
  async (req, res) => {
    const { id, paymentId } = paymentOf(req);
    await appointmentPaymentsService.remove(actorFrom(req), await viewerOf(req), id, paymentId);
    sendNoContent(res);
  },
);
