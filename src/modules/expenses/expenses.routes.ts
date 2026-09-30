import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { mountBranchCrud } from '../../lib/crud';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { documentUpload, jsonDataField } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validQuery } from '../../middleware/validate';
import {
  createExpenseCategorySchema,
  createExpenseSchema,
  expenseCategoryListQuerySchema,
  expenseListQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
} from './expenses.schemas';
import { expenseCategoriesService, expensesService } from './expenses.service';

export const expensesRouter = Router();

mountBranchCrud(expensesRouter, {
  path: '/branch/expense-categories',
  module: 'expenses',
  service: expenseCategoriesService,
  schemas: {
    list: expenseCategoryListQuerySchema,
    create: createExpenseCategorySchema,
    update: updateExpenseCategorySchema,
  },
});

const path = '/branch/expenses';
const byId = validate({ params: idParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`expenses.${action}`);

expensesRouter.use(path, authenticate, branchScope());

expensesRouter.get(path, can('view'), validate({ query: expenseListQuerySchema }), async (req, res) => {
  const { items, meta } = await expensesService.list(
    branchIdOf(req),
    validQuery(req, expenseListQuerySchema),
  );
  sendOk(res, items, meta);
});

expensesRouter.post(
  path,
  can('create'),
  documentUpload('attachment'),
  jsonDataField,
  validate({ body: createExpenseSchema }),
  async (req, res) => {
    const input = validBody(req, createExpenseSchema);
    sendCreated(res, await expensesService.create(actorFrom(req), branchIdOf(req), input, req.file));
  },
);

expensesRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await expensesService.get(branchIdOf(req), idOf(req)));
});

expensesRouter.get(`${path}/:id/attachment-url`, can('view'), byId, async (req, res) => {
  sendOk(res, await expensesService.attachmentUrl(branchIdOf(req), idOf(req)));
});

expensesRouter.patch(
  `${path}/:id`,
  can('update'),
  validate({ params: idParamsSchema, body: updateExpenseSchema }),
  async (req, res) => {
    const input = validBody(req, updateExpenseSchema);
    sendOk(res, await expensesService.update(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

expensesRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await expensesService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});
