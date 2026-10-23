import { AppDataSource } from '../../database/data-source';
import { type Role } from '../../lib/permissions';
import { pendingGrnEdits } from '../inventory/stock-in-edits';
import { pendingReceipts } from '../inventory/store-receipts';
import { doctorChat } from '../chat/chat.service';
import { patientRequestsService } from '../patient-app/patient-requests.service';

export interface BadgeViewer {
  isSuperAdmin: boolean;
  role: Role;
  userId: string;
  branchId: string | null;
}

export interface BadgeCounts {
  stockRequests: number;
  incomingStock: number;
  writeOffs: number;
  discountRequests: number;
  returns: number;
  stockReceipts: number;
  patientRequests: number;
  patientMessages: number;
}

const one = async (sql: string, params: unknown[]) => {
  const [row] = (await AppDataSource.query(sql, params)) as { n: number }[];
  return row?.n ?? 0;
};

export async function badgeCounts(viewer: BadgeViewer): Promise<BadgeCounts> {
  if (viewer.isSuperAdmin) {
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
    return {
      patientMessages: viewer.role === 'doctor' ? await doctorChat.unread(viewer.userId) : 0,
      stockRequests,
      incomingStock,
      writeOffs,
      discountRequests,
      returns,
      stockReceipts: (await pendingReceipts(null)) + (await pendingGrnEdits()),
      patientRequests: await patientRequestsService.openCount(null),
    };
  }
  const branchId = viewer.branchId as string;
  const [branch] = (await AppDataSource.query('SELECT kind::text AS kind FROM branches WHERE id = $1', [
    branchId,
  ])) as {
    kind: string;
  }[];
  if (branch?.kind === 'warehouse') {
    const [toSend, onTheWay] = await Promise.all([
      one(
        `SELECT COUNT(*)::int AS n FROM stock_requests WHERE status = 'approved' AND deleted_at IS NULL`,
        [],
      ),
      one(
        `SELECT COUNT(DISTINCT transfer_no)::int AS n FROM stock_outs
          WHERE transfer_no IS NOT NULL AND received_at IS NULL AND deleted_at IS NULL`,
        [],
      ),
    ]);
    return {
      patientMessages: viewer.role === 'doctor' ? await doctorChat.unread(viewer.userId) : 0,
      stockRequests: toSend,
      incomingStock: onTheWay,
      writeOffs: 0,
      discountRequests: 0,
      returns: 0,
      stockReceipts: await pendingReceipts(branchId),
      patientRequests: 0,
    };
  }
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
      [branchId, viewer.role === 'branch_admin'],
    ),
  ]);
  return {
    patientMessages: viewer.role === 'doctor' ? await doctorChat.unread(viewer.userId) : 0,
    stockRequests,
    incomingStock,
    writeOffs,
    discountRequests,
    returns,
    stockReceipts: 0,
    patientRequests: await patientRequestsService.openCount(branchId),
  };
}
