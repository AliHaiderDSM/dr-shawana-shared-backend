import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { sendOk } from '../../lib/http';
import { validBody } from '../../middleware/validate';
import { updateCompanyInfoSchema } from './company.schemas';
import { companyService } from './company.service';

export const companyController = {
  async get(_req: Request, res: Response) {
    sendOk(res, await companyService.get());
  },

  async update(req: Request, res: Response) {
    sendOk(res, await companyService.update(actorFrom(req), validBody(req, updateCompanyInfoSchema)));
  },
};
