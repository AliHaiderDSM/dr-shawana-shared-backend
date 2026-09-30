import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { validBody, validParams, validQuery } from '../../middleware/validate';
import { createBranchAdminSchema } from '../staff/staff.schemas';
import { branchListQuerySchema, createBranchSchema, updateBranchSchema } from './branches.schemas';
import { branchesService } from './branches.service';

const idOf = (req: Request) => validParams(req, idParamsSchema).id;

export const branchesController = {
  async list(req: Request, res: Response) {
    const { items, meta } = await branchesService.list(validQuery(req, branchListQuerySchema));
    sendOk(res, items, meta);
  },

  async options(_req: Request, res: Response) {
    sendOk(res, await branchesService.options());
  },

  async get(req: Request, res: Response) {
    sendOk(res, await branchesService.get(idOf(req)));
  },

  async create(req: Request, res: Response) {
    sendCreated(res, await branchesService.create(actorFrom(req), validBody(req, createBranchSchema)));
  },

  async update(req: Request, res: Response) {
    sendOk(res, await branchesService.update(actorFrom(req), idOf(req), validBody(req, updateBranchSchema)));
  },

  async activate(req: Request, res: Response) {
    sendOk(res, await branchesService.setStatus(actorFrom(req), idOf(req), 'active'));
  },

  async deactivate(req: Request, res: Response) {
    sendOk(res, await branchesService.setStatus(actorFrom(req), idOf(req), 'inactive'));
  },

  async remove(req: Request, res: Response) {
    await branchesService.remove(actorFrom(req), idOf(req));
    sendNoContent(res);
  },

  async createAdmin(req: Request, res: Response) {
    const input = validBody(req, createBranchAdminSchema);
    sendCreated(res, await branchesService.createBranchAdmin(actorFrom(req), idOf(req), input));
  },
};
