import { type RequestHandler } from 'express';
import { AppDataSource } from '../database/data-source';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const KEEP_HOURS = 24;

interface Stored {
  status: string;
  responseStatus: number | null;
  responseBody: unknown;
}

export function idempotent(scope: string): RequestHandler {
  return async (req, res, next) => {
    const key = req.header('idempotency-key');
    if (!key) return next();
    if (!KEY.test(key))
      return next(AppError.badRequest('Idempotency-Key must be 8-100 letters, digits, - or _'));
    const owner = req.auth?.userId ?? req.patient?.patientId;
    if (!owner) return next(AppError.unauthorized());

    try {
      await AppDataSource.query(
        `DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => $1)`,
        [KEEP_HOURS],
      );
      const inserted = (await AppDataSource.query(
        `INSERT INTO idempotency_keys (user_id, scope, key) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, scope, key) DO NOTHING RETURNING id`,
        [owner, scope, key],
      )) as { id: string }[];

      if (inserted.length === 0) {
        const [stored] = (await AppDataSource.query(
          `SELECT status, response_status AS "responseStatus", response_body AS "responseBody"
             FROM idempotency_keys WHERE user_id = $1 AND scope = $2 AND key = $3`,
          [owner, scope, key],
        )) as Stored[];
        if (stored?.status === 'done' && stored.responseStatus) {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(stored.responseStatus).json(stored.responseBody);
          return;
        }
        return next(AppError.conflict('This request is already being saved. Wait a moment and refresh.'));
      }

      const id = inserted[0]!.id;
      const send = res.json.bind(res);
      let answered = false;
      res.on('close', () => {
        if (answered) return;
        void AppDataSource.query(`DELETE FROM idempotency_keys WHERE id = $1`, [id]).catch((err: unknown) =>
          logger.warn({ err, scope }, 'Idempotency record could not be released'),
        );
      });
      res.json = (body: unknown) => {
        answered = true;
        const saved =
          res.statusCode >= 200 && res.statusCode < 300
            ? AppDataSource.query(
                `UPDATE idempotency_keys SET status = 'done', response_status = $2, response_body = $3 WHERE id = $1`,
                [id, res.statusCode, JSON.stringify(body)],
              )
            : AppDataSource.query(`DELETE FROM idempotency_keys WHERE id = $1`, [id]);
        void saved
          .catch((err: unknown) => logger.warn({ err, scope }, 'Idempotency record could not be saved'))
          .finally(() => send(body));
        return res;
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
