import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { requireFile } from '../../lib/upload';
import { categoriesService } from './categories.service';

export const categoryImageController = {
  async upload(req: Request, res: Response) {
    sendOk(
      res,
      await categoriesService.uploadImage(actorFrom(req), branchIdOf(req), idOf(req), requireFile(req)),
    );
  },
};
