import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { sendNoContent, sendOk } from '../../lib/http';
import { validBody } from '../../middleware/validate';
import { changePasswordSchema, loginSchema, refreshSchema, updateOwnProfileSchema } from './auth.schemas';
import { authService } from './auth.service';

export const authController = {
  async login(req: Request, res: Response) {
    const { identifier, password } = validBody(req, loginSchema);
    sendOk(res, await authService.login(identifier, password));
  },

  async refresh(req: Request, res: Response) {
    sendOk(res, await authService.refresh(validBody(req, refreshSchema).refreshToken));
  },

  async me(req: Request, res: Response) {
    sendOk(res, await authService.me(actorFrom(req).userId));
  },

  async updateMe(req: Request, res: Response) {
    sendOk(res, await authService.updateOwnProfile(actorFrom(req), validBody(req, updateOwnProfileSchema)));
  },

  async changePassword(req: Request, res: Response) {
    const { currentPassword, newPassword } = validBody(req, changePasswordSchema);
    await authService.changePassword(actorFrom(req), currentPassword, newPassword);
    sendNoContent(res);
  },
};
