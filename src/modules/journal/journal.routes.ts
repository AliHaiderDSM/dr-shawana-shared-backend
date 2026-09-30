import { Router } from 'express';
import { actorFrom } from '../../lib/actor';
import { idParamsSchema, sendCreated, sendNoContent, sendOk } from '../../lib/http';
import { branchIdOf, idOf } from '../../lib/request';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';
import { requirePermission } from '../../middleware/requirePermission';
import { validate, validBody, validQuery } from '../../middleware/validate';
import {
  createJournalEntrySchema,
  journalListQuerySchema,
  updateJournalEntrySchema,
} from './journal.schemas';
import { journalService } from './journal.service';

export const journalRouter = Router();

const path = '/branch/journal-entries';
const byId = validate({ params: idParamsSchema });
const can = (action: 'view' | 'create' | 'update' | 'delete') => requirePermission(`journal.${action}`);

journalRouter.use(path, authenticate, branchScope());

journalRouter.get(path, can('view'), validate({ query: journalListQuerySchema }), async (req, res) => {
  const { items, meta } = await journalService.list(branchIdOf(req), validQuery(req, journalListQuerySchema));
  sendOk(res, items, meta);
});

journalRouter.post(path, can('create'), validate({ body: createJournalEntrySchema }), async (req, res) => {
  const input = validBody(req, createJournalEntrySchema);
  sendCreated(res, await journalService.create(actorFrom(req), branchIdOf(req), input));
});

journalRouter.get(`${path}/:id`, can('view'), byId, async (req, res) => {
  sendOk(res, await journalService.get(branchIdOf(req), idOf(req)));
});

journalRouter.patch(
  `${path}/:id`,
  can('update'),
  validate({ params: idParamsSchema, body: updateJournalEntrySchema }),
  async (req, res) => {
    const input = validBody(req, updateJournalEntrySchema);
    sendOk(res, await journalService.update(actorFrom(req), branchIdOf(req), idOf(req), input));
  },
);

journalRouter.delete(`${path}/:id`, can('delete'), byId, async (req, res) => {
  await journalService.remove(actorFrom(req), branchIdOf(req), idOf(req));
  sendNoContent(res);
});
