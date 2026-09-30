import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { requireBranchId } from '../../middleware/branchScope';
import { validBody, validParams, validQuery } from '../../middleware/validate';
import {
  createStaffSchema,
  resetPasswordSchema,
  staffListQuerySchema,
  updateStaffSchema,
} from './staff.schemas';
import { staffService } from './staff.service';

const branchOf = (req: Request) => requireBranchId(req.branchId);
const idOf = (req: Request) => validParams(req, idParamsSchema).id;

export const staffController = {
  async list(req: Request, res: Response) {
    const { items, meta } = await staffService.list(branchOf(req), validQuery(req, staffListQuerySchema));
    sendOk(res, items, meta);
  },

  async get(req: Request, res: Response) {
    sendOk(res, await staffService.get(branchOf(req), idOf(req)));
  },

  async create(req: Request, res: Response) {
    sendCreated(
      res,
      await staffService.create(actorFrom(req), branchOf(req), validBody(req, createStaffSchema)),
    );
  },

  async update(req: Request, res: Response) {
    const input = validBody(req, updateStaffSchema);
    sendOk(res, await staffService.update(actorFrom(req), branchOf(req), idOf(req), input));
  },

  async resetPassword(req: Request, res: Response) {
    const { password } = validBody(req, resetPasswordSchema);
    sendOk(res, await staffService.resetPassword(actorFrom(req), branchOf(req), idOf(req), password));
  },

  async activate(req: Request, res: Response) {
    sendOk(res, await staffService.setStatus(actorFrom(req), branchOf(req), idOf(req), 'active'));
  },

  async deactivate(req: Request, res: Response) {
    sendOk(res, await staffService.setStatus(actorFrom(req), branchOf(req), idOf(req), 'inactive'));
  },

  async remove(req: Request, res: Response) {
    await staffService.remove(actorFrom(req), branchOf(req), idOf(req));
    sendNoContent(res);
  },
};
