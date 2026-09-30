import { type Request } from 'express';
import { AppError } from './errors';

export interface Actor extends Express.AuthContext {
  ip: string | null;
}

export function actorFrom(req: Request): Actor {
  if (!req.auth) throw AppError.unauthorized();
  return { ...req.auth, ip: req.ip ?? null };
}
