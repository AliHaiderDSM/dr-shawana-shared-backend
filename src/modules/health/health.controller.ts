import { type Request, type Response } from 'express';
import { sendOk } from '../../lib/http';
import { healthService } from './health.service';

export const healthController = {
  async get(req: Request, res: Response) {
    const health = await healthService.check();
    if (health.database === 'down') {
      res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database is unreachable',
          details: health,
          requestId: req.id,
        },
      });
      return;
    }
    sendOk(res, health);
  },
};
