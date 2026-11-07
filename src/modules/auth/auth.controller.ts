import { type Request, type Response } from 'express';
import { actorFrom } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { sendNoContent, sendOk } from '../../lib/http';
import { validBody } from '../../middleware/validate';
import { clearRefreshCookie, readRefreshCookie, usesCookie, writeRefreshCookie } from './auth-cookie';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  updateOwnProfileSchema,
} from './auth.schemas';
import { authService, type StaffSession } from './auth.service';
import { type SessionMeta } from './staff-sessions';

const metaOf = (req: Request): SessionMeta => ({
  device: req.header('user-agent') ?? null,
  ip: req.ip ?? null,
});

const presentedToken = (req: Request, fromBody: string | undefined) =>
  fromBody ?? (usesCookie(req) ? readRefreshCookie(req) : null);

function sendSession(req: Request, res: Response, session: StaffSession) {
  res.setHeader('Cache-Control', 'no-store');
  if (!usesCookie(req)) return sendOk(res, session);
  writeRefreshCookie(res, session.refreshToken!, new Date(session.refreshExpiresAt));
  sendOk(res, { ...session, refreshToken: null });
}

export const authController = {
  async login(req: Request, res: Response) {
    const { identifier, password } = validBody(req, loginSchema);
    sendSession(req, res, await authService.login(identifier, password, metaOf(req)));
  },

  async refresh(req: Request, res: Response) {
    const token = presentedToken(req, validBody(req, refreshSchema).refreshToken);
    if (!token) throw AppError.unauthorized('Session expired, please log in again');
    try {
      sendSession(req, res, await authService.refresh(token, metaOf(req)));
    } catch (error) {
      if (usesCookie(req) && error instanceof AppError && error.status === 401) clearRefreshCookie(res);
      throw error;
    }
  },

  async logout(req: Request, res: Response) {
    const token = presentedToken(req, validBody(req, logoutSchema).refreshToken);
    if (token) await authService.logout(token);
    if (usesCookie(req)) clearRefreshCookie(res);
    sendNoContent(res);
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
