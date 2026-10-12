import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../../database/data-source';
import { dataEnvelope, errorResponses, jsonContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { authenticate } from '../../middleware/auth';
import { branchScope } from '../../middleware/branchScope';

export const badgesRouter = Router();

const countsSchema = registry.register(
  'SidebarBadges',
  z.object({
    stockRequests: z.number().int(),
    incomingStock: z.number().int(),
    writeOffs: z.number().int(),
    discountRequests: z.number().int(),
    returns: z.number().int(),
  }),
);

registry.registerPath({
  ...securedDocs('Sidebar'),
  method: 'get',
  path: '/branch/badges',
  summary:
    'Counts for the red sidebar badges. Super Admin: requests waiting for a decision or to send, transfers not received yet, write-offs and discounts to approve, returns to inspect. Branch: approved or on-the-way stock requests, transfers to receive, write-offs and discounts waiting or ready, returns to inspect.',
  responses: {
    200: { description: 'Counts', ...jsonContent(dataEnvelope(countsSchema)) },
    ...errorResponses,
  },
});

const one = async (sql: string, params: unknown[]) => {
  const [row] = (await AppDataSource.query(sql, params)) as { n: number }[];
  return row?.n ?? 0;
};

badgesRouter.get(
  '/branch/badges',
  authenticate,
  branchScope({ allowAllForSuperAdmin: true }),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.auth?.isSuperAdmin) {
      const [stockRequests, incomingStock, writeOffs, discountRequests, returns] = await Promise.all([
        one(
          `SELECT COUNT(*)::int AS n FROM stock_requests WHERE status IN ('pending', 'approved') AND deleted_at IS NULL`,
          [],
        ),
        one(
          `SELECT COUNT(DISTINCT transfer_no)::int AS n FROM stock_outs
            WHERE transfer_no IS NOT NULL AND received_at IS NULL AND deleted_at IS NULL`,
          [],
        ),
        one(
          `SELECT COUNT(*)::int AS n FROM stock_write_offs WHERE status = 'pending' AND deleted_at IS NULL`,
          [],
        ),
        one(
          `SELECT COUNT(*)::int AS n FROM discount_requests WHERE status = 'pending' AND deleted_at IS NULL`,
          [],
        ),
        one(
          `SELECT COUNT(DISTINCT x.sale_return_id)::int AS n FROM sale_return_items x
            WHERE x.deleted_at IS NULL AND x.proposed_disposition IS NOT NULL
              AND x.disposition IN ('pending', 'quarantined')`,
          [],
        ),
      ]);
      sendOk(res, { stockRequests, incomingStock, writeOffs, discountRequests, returns });
      return;
    }
    const branchId = req.branchId as string;
    const [stockRequests, incomingStock, writeOffs, discountRequests, returns] = await Promise.all([
      one(
        `SELECT COUNT(*)::int AS n FROM stock_requests
          WHERE branch_id = $1 AND status IN ('approved', 'sent') AND deleted_at IS NULL`,
        [branchId],
      ),
      one(
        `SELECT COUNT(DISTINCT transfer_no)::int AS n FROM stock_outs
          WHERE to_branch_id = $1 AND transfer_no IS NOT NULL AND received_at IS NULL AND deleted_at IS NULL`,
        [branchId],
      ),
      one(
        `SELECT COUNT(*)::int AS n FROM stock_write_offs WHERE branch_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
        [branchId],
      ),
      one(
        `SELECT COUNT(*)::int AS n FROM discount_requests
          WHERE branch_id = $1 AND status IN ('pending', 'approved') AND deleted_at IS NULL`,
        [branchId],
      ),
      one(
        `SELECT COUNT(*)::int AS n FROM sale_returns r JOIN sales s ON s.id = r.sale_id
          WHERE r.status = 'pending' AND r.deleted_at IS NULL
            AND (
              ((r.branch_id = $1 OR s.fulfillment_branch_id = $1)
                AND EXISTS (SELECT 1 FROM sale_return_items x WHERE x.sale_return_id = r.id AND x.deleted_at IS NULL
                              AND x.disposition = 'pending' AND x.proposed_disposition IS NULL))
              OR (r.branch_id = $1 AND $2::boolean
                AND EXISTS (SELECT 1 FROM sale_return_items x WHERE x.sale_return_id = r.id AND x.deleted_at IS NULL
                              AND x.proposed_disposition IS NOT NULL AND x.disposition IN ('pending', 'quarantined')))
            )`,
        [branchId, req.auth?.role === 'branch_admin'],
      ),
    ]);
    sendOk(res, { stockRequests, incomingStock, writeOffs, discountRequests, returns });
  },
);
