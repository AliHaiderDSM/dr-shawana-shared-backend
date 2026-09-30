import { type Request, type RequestHandler, type Response, type Router } from 'express';
import { type z } from 'zod';
import { authenticate } from '../middleware/auth';
import { branchScope } from '../middleware/branchScope';
import { requirePermission } from '../middleware/requirePermission';
import { validate, validBody, validQuery } from '../middleware/validate';
import { actorFrom, type Actor } from './actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk, type PageMeta } from './http';
import { type Module } from './permissions';
import { branchIdOf, idOf } from './request';

export interface CrudService<TQuery, TCreate, TUpdate> {
  list(branchId: string, query: TQuery): Promise<{ items: unknown[]; meta: PageMeta }>;
  options(branchId: string, query?: never): Promise<unknown[]>;
  get(branchId: string, id: string): Promise<unknown>;
  create(actor: Actor, branchId: string, input: TCreate): Promise<unknown>;
  update(actor: Actor, branchId: string, id: string, input: TUpdate): Promise<unknown>;
  remove(actor: Actor, branchId: string, id: string): Promise<void>;
}

interface CrudSchemas {
  list: z.ZodType;
  create: z.ZodType;
  update: z.ZodType;
  options?: z.ZodType;
}

export function crudController<Q, C, U>(service: CrudService<Q, C, U>, schemas: CrudSchemas) {
  return {
    async list(req: Request, res: Response) {
      const { items, meta } = await service.list(branchIdOf(req), validQuery(req, schemas.list) as Q);
      sendOk(res, items, meta);
    },
    async options(req: Request, res: Response) {
      const query = schemas.options ? (validQuery(req, schemas.options) as never) : undefined;
      sendOk(res, await service.options(branchIdOf(req), query));
    },
    async get(req: Request, res: Response) {
      sendOk(res, await service.get(branchIdOf(req), idOf(req)));
    },
    async create(req: Request, res: Response) {
      sendCreated(
        res,
        await service.create(actorFrom(req), branchIdOf(req), validBody(req, schemas.create) as C),
      );
    },
    async update(req: Request, res: Response) {
      const input = validBody(req, schemas.update) as U;
      sendOk(res, await service.update(actorFrom(req), branchIdOf(req), idOf(req), input));
    },
    async remove(req: Request, res: Response) {
      await service.remove(actorFrom(req), branchIdOf(req), idOf(req));
      sendNoContent(res);
    },
  };
}

export function mountBranchCrud<Q, C, U>(
  router: Router,
  options: {
    path: string;
    module: Module;
    service: CrudService<Q, C, U>;
    schemas: CrudSchemas;
    extraItemRoutes?: (byId: RequestHandler) => void;
  },
): void {
  const { path, module, schemas } = options;
  const controller = crudController(options.service, schemas);
  const byId = validate({ params: idParamsSchema });
  const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`${module}.${action}`);

  router.use(path, authenticate, branchScope());
  router.get(path, can('view'), validate({ query: schemas.list }), controller.list);
  router.get(`${path}/options`, can('view'), validate({ query: schemas.options }), controller.options);
  router.post(path, can('create'), validate({ body: schemas.create }), controller.create);
  router.get(`${path}/:id`, can('view'), byId, controller.get);
  router.patch(
    `${path}/:id`,
    can('update'),
    validate({ params: idParamsSchema, body: schemas.update }),
    controller.update,
  );
  router.delete(`${path}/:id`, can('delete'), byId, controller.remove);
  options.extraItemRoutes?.(byId);
}
