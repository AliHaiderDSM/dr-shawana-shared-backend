import { AppDataSource } from '../../database/data-source';
import { toMoney, toQuantity } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { viewScope } from '../stock-requests/stock-requests.service';

export const TRACE_KINDS = [
  'sale',
  'return',
  'stock_request',
  'transfer',
  'discount_request',
  'write_off',
  'store_receipt',
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

interface Person {
  id: string;
  name: string;
  role: string;
}

interface Field {
  label: string;
  value: string | null;
}

interface Item {
  name: string;
  qty: string | null;
  detail: string | null;
}

interface Link {
  kind: TraceKind;
  number: string;
  status: string | null;
}

interface Found {
  kind: TraceKind;
  number: string;
  id: string;
  status: string | null;
  branch: { id: string; name: string; code: string };
  branchIds: string[];
  createdAt: string;
  createdBy: Person | null;
  fields: Field[];
  items: Item[];
  links: Link[];
  auditIds: string[];
}

const q = <T>(sql: string, params: unknown[]) => AppDataSource.query(sql, params) as Promise<T[]>;

const PERSON = (alias: string) =>
  `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id,
     'name', TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), 'role', ${alias}.role) END`;

const BRANCH = (alias: string) =>
  `json_build_object('id', ${alias}.id, 'name', ${alias}.name, 'code', ${alias}.code)`;

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : '');
const qty = (value: unknown) =>
  value === null || value === undefined ? null : toQuantity(value as string).toString();
const money = (value: unknown) =>
  value === null || value === undefined ? null : toMoney(value as string).toString();

type Row = Record<string, unknown> & {
  id: string;
  number: string;
  status: string | null;
  branch: Found['branch'];
  createdAt: string;
  createdBy: Person | null;
};

async function sale(number: string): Promise<Found | null> {
  const [s] = await q<Row>(
    `SELECT s.id, s.invoice_no AS number, COALESCE(s.delivery_status::text, s.payment_status::text) AS status,
            ${BRANCH('b')} AS branch, s.created_at AS "createdAt", ${PERSON('u')} AS "createdBy",
            s.fulfillment_branch_id AS "fulfillmentId", fb.name AS "fulfiller", s.sale_type AS "saleType",
            to_char(s.date, 'YYYY-MM-DD') AS date, s.total::text AS total, s.received::text AS received,
            s.payment_status AS "paymentStatus", s.delivery_status AS "deliveryStatus",
            to_char(s.dispatched_on, 'YYYY-MM-DD') AS "dispatchedOn", p.name AS customer, p.phone
       FROM sales s JOIN branches b ON b.id = s.branch_id
       LEFT JOIN branches fb ON fb.id = s.fulfillment_branch_id
       LEFT JOIN patients p ON p.id = s.patient_id
       LEFT JOIN staff_profiles u ON u.id = s.created_by
      WHERE upper(s.invoice_no) = $1 AND s.deleted_at IS NULL`,
    [number],
  );
  if (!s) return null;
  const items = await q<{ name: string; qty: string; lineTotal: string; discountPercent: string }>(
    `SELECT COALESCE(p.name, 'Item') AS name, si.qty::text AS qty, si.line_total::text AS "lineTotal",
            si.discount_percent::text AS "discountPercent"
       FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = $1 AND si.deleted_at IS NULL ORDER BY p.name`,
    [s.id],
  );
  const links = await q<Link & { id: string }>(
    `SELECT 'return' AS kind, return_no AS number, status::text AS status, id FROM sale_returns
      WHERE sale_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 'discount_request', request_no, status::text, id FROM discount_requests
      WHERE sale_id = $1 AND deleted_at IS NULL`,
    [s.id],
  );
  return {
    kind: 'sale',
    number: s.number,
    id: s.id,
    status: s.status,
    branch: s.branch,
    branchIds: [s.branch.id, ...(s.fulfillmentId ? [s.fulfillmentId as string] : [])],
    createdAt: iso(s.createdAt),
    createdBy: s.createdBy,
    fields: [
      { label: 'Date', value: s.date as string },
      { label: 'Type', value: s.saleType as string },
      { label: 'Customer', value: s.customer ? `${s.customer as string} · ${s.phone as string}` : null },
      { label: 'Total', value: money(s.total) },
      { label: 'Received', value: money(s.received) },
      { label: 'Payment', value: s.paymentStatus as string },
      { label: 'Delivery', value: (s.deliveryStatus as string) ?? null },
      { label: 'Dispatched on', value: (s.dispatchedOn as string) ?? null },
      { label: 'Ships from', value: (s.fulfiller as string) ?? null },
    ],
    items: items.map((i) => ({
      name: i.name,
      qty: qty(i.qty),
      detail: `${money(i.lineTotal)}${Number(i.discountPercent) ? ` · ${Number(i.discountPercent)}% off` : ''}`,
    })),
    links: links.map(({ kind, number: n, status }) => ({ kind, number: n, status })),
    auditIds: [s.id, ...links.map((l) => l.id)],
  };
}

async function saleReturn(number: string): Promise<Found | null> {
  const [r] = await q<Row>(
    `SELECT r.id, r.return_no AS number, r.status::text AS status, ${BRANCH('b')} AS branch,
            r.created_at AS "createdAt", ${PERSON('u')} AS "createdBy", r.reason::text AS reason, r.note,
            to_char(r.date, 'YYYY-MM-DD') AS date, r.refund_amount::text AS refund,
            s.invoice_no AS "invoiceNo", s.payment_status::text AS "saleStatus", s.fulfillment_branch_id AS "fulfillmentId"
       FROM sale_returns r JOIN branches b ON b.id = r.branch_id
       JOIN sales s ON s.id = r.sale_id
       LEFT JOIN staff_profiles u ON u.id = r.created_by
      WHERE upper(r.return_no) = $1 AND r.deleted_at IS NULL`,
    [number],
  );
  if (!r) return null;
  const items = await q<{
    name: string;
    qty: string;
    disposition: string;
    proposed: string | null;
    note: string | null;
  }>(
    `SELECT COALESCE(p.name, 'Item') AS name, i.qty::text AS qty, i.disposition::text AS disposition,
            i.proposed_disposition::text AS proposed, COALESCE(i.resolution_note, i.proposal_note) AS note
       FROM sale_return_items i LEFT JOIN products p ON p.id = i.product_id
      WHERE i.sale_return_id = $1 AND i.deleted_at IS NULL`,
    [r.id],
  );
  return {
    kind: 'return',
    number: r.number,
    id: r.id,
    status: r.status,
    branch: r.branch,
    branchIds: [r.branch.id, ...(r.fulfillmentId ? [r.fulfillmentId as string] : [])],
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    fields: [
      { label: 'Date', value: r.date as string },
      { label: 'Reason', value: r.reason as string },
      { label: 'Refund', value: money(r.refund) },
      { label: 'Note', value: (r.note as string) ?? null },
    ],
    items: items.map((i) => ({
      name: i.name,
      qty: qty(i.qty),
      detail: [
        i.disposition,
        i.proposed && i.disposition === 'pending' ? `checked as ${i.proposed}, waiting for approval` : null,
        i.note,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    links: [{ kind: 'sale', number: r.invoiceNo as string, status: r.saleStatus as string }],
    auditIds: [r.id],
  };
}

async function stockRequest(number: string): Promise<Found | null> {
  const [r] = await q<Row>(
    `SELECT r.id, r.request_no AS number, r.status::text AS status, ${BRANCH('b')} AS branch,
            r.created_at AS "createdAt", ${PERSON('u')} AS "createdBy", r.note, r.decision_note AS "decisionNote",
            ${PERSON('d')} AS "decidedBy", r.decided_at AS "decidedAt", r.sent_at AS "sentAt",
            r.received_at AS "receivedAt", ${PERSON('rc')} AS "receivedBy"
       FROM stock_requests r JOIN branches b ON b.id = r.branch_id
       LEFT JOIN staff_profiles u ON u.id = r.created_by
       LEFT JOIN staff_profiles d ON d.id = r.decided_by
       LEFT JOIN staff_profiles rc ON rc.id = r.received_by
      WHERE upper(r.request_no) = $1 AND r.deleted_at IS NULL`,
    [number],
  );
  if (!r) return null;
  const items = await q<{
    name: string;
    qty: string;
    approved: string | null;
    sent: string;
    received: string;
  }>(
    `SELECT p.name, it.qty::text AS qty, it.approved_qty::text AS approved,
            COALESCE((SELECT SUM(o.qty) FROM stock_outs o WHERE o.stock_request_id = it.request_id
                       AND o.product_id = it.product_id AND o.deleted_at IS NULL), 0)::text AS sent,
            COALESCE((SELECT SUM(o.qty) FROM stock_outs o WHERE o.stock_request_id = it.request_id
                       AND o.product_id = it.product_id AND o.deleted_at IS NULL AND o.received_at IS NOT NULL), 0)::text AS received
       FROM stock_request_items it JOIN products p ON p.id = it.product_id
      WHERE it.request_id = $1 ORDER BY p.name`,
    [r.id],
  );
  const transfers = await q<{ number: string; received: boolean; ids: string[] }>(
    `SELECT transfer_no AS number, bool_and(received_at IS NOT NULL) AS received, array_agg(id::text) AS ids
       FROM stock_outs WHERE stock_request_id = $1 AND deleted_at IS NULL AND transfer_no IS NOT NULL
      GROUP BY transfer_no`,
    [r.id],
  );
  const decided = r.decidedBy as Person | null;
  const receivedBy = r.receivedBy as Person | null;
  return {
    kind: 'stock_request',
    number: r.number,
    id: r.id,
    status: r.status,
    branch: r.branch,
    branchIds: [r.branch.id],
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    fields: [
      { label: 'Note', value: (r.note as string) ?? null },
      {
        label: 'Decided',
        value: decided
          ? `${decided.name} · ${iso(r.decidedAt)}${r.decisionNote ? ` · ${r.decisionNote as string}` : ''}`
          : null,
      },
      { label: 'Sent', value: r.sentAt ? iso(r.sentAt) : null },
      { label: 'Received', value: receivedBy ? `${receivedBy.name} · ${iso(r.receivedAt)}` : null },
    ],
    items: items.map((i) => ({
      name: i.name,
      qty: qty(i.qty),
      detail: `approved ${i.approved === null ? '—' : qty(i.approved)} · sent ${qty(i.sent)} · received ${qty(i.received)}`,
    })),
    links: transfers.map((t) => ({
      kind: 'transfer' as const,
      number: t.number,
      status: t.received ? 'received' : 'sent',
    })),
    auditIds: [r.id, ...transfers.flatMap((t) => t.ids)],
  };
}

async function transfer(number: string): Promise<Found | null> {
  const rows = await q<
    Row & {
      productName: string;
      qty: string;
      receivedAt: string | null;
      receivedBy: Person | null;
      toBranch: Found['branch'];
      requestNo: string | null;
      requestStatus: string | null;
      date: string;
      labels: number;
    }
  >(
    `SELECT o.id, o.transfer_no AS number, ${BRANCH('b')} AS branch, ${BRANCH('tb')} AS "toBranch",
            o.created_at AS "createdAt", ${PERSON('u')} AS "createdBy", to_char(o.date, 'YYYY-MM-DD') AS date,
            p.name AS "productName", o.qty::text AS qty, o.received_at AS "receivedAt", ${PERSON('rc')} AS "receivedBy",
            sr.request_no AS "requestNo", sr.status::text AS "requestStatus",
            (SELECT COUNT(*) FROM inventory_items i WHERE i.stock_out_id = o.id)::int AS labels, NULL AS status
       FROM stock_outs o JOIN branches b ON b.id = o.branch_id
       JOIN branches tb ON tb.id = o.to_branch_id
       JOIN products p ON p.id = o.product_id
       LEFT JOIN staff_profiles u ON u.id = o.created_by
       LEFT JOIN staff_profiles rc ON rc.id = o.received_by
       LEFT JOIN stock_requests sr ON sr.id = o.stock_request_id
      WHERE upper(o.transfer_no) = $1 AND o.deleted_at IS NULL
      ORDER BY p.name`,
    [number],
  );
  const first = rows[0];
  if (!first) return null;
  const received = rows.every((r) => r.receivedAt);
  return {
    kind: 'transfer',
    number: first.number,
    id: first.id,
    status: received ? 'received' : 'on the way',
    branch: first.toBranch,
    branchIds: [first.toBranch.id, first.branch.id],
    createdAt: iso(first.createdAt),
    createdBy: first.createdBy,
    fields: [
      { label: 'Sent on', value: first.date },
      { label: 'From', value: first.branch.name },
      { label: 'To', value: first.toBranch.name },
      {
        label: 'Received',
        value: received && first.receivedBy ? `${first.receivedBy.name} · ${iso(first.receivedAt)}` : null,
      },
    ],
    items: rows.map((r) => ({
      name: r.productName,
      qty: qty(r.qty),
      detail: [r.labels ? `${r.labels} labels` : null, r.receivedAt ? 'received' : 'waiting']
        .filter(Boolean)
        .join(' · '),
    })),
    links: first.requestNo
      ? [{ kind: 'stock_request', number: first.requestNo, status: first.requestStatus }]
      : [],
    auditIds: rows.map((r) => r.id),
  };
}

async function discountRequest(number: string): Promise<Found | null> {
  const [r] = await q<Row>(
    `SELECT r.id, r.request_no AS number, r.status::text AS status, ${BRANCH('b')} AS branch,
            r.created_at AS "createdAt", ${PERSON('u')} AS "createdBy", COALESCE(p.name, bu.name, 'Item') AS item,
            r.qty::text AS qty, r.unit_price::text AS price, r.discount_percent::text AS percent, r.note,
            ${PERSON('d')} AS "decidedBy", r.decided_at AS "decidedAt", r.decision_note AS "decisionNote",
            s.invoice_no AS "invoiceNo", s.payment_status::text AS "saleStatus"
       FROM discount_requests r JOIN branches b ON b.id = r.branch_id
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN bundles bu ON bu.id = r.bundle_id
       LEFT JOIN staff_profiles u ON u.id = r.created_by
       LEFT JOIN staff_profiles d ON d.id = r.decided_by
       LEFT JOIN sales s ON s.id = r.sale_id
      WHERE upper(r.request_no) = $1 AND r.deleted_at IS NULL`,
    [number],
  );
  if (!r) return null;
  const decided = r.decidedBy as Person | null;
  return {
    kind: 'discount_request',
    number: r.number,
    id: r.id,
    status: r.status,
    branch: r.branch,
    branchIds: [r.branch.id],
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
    fields: [
      { label: 'Discount', value: `${Number(r.percent)}%` },
      { label: 'Price', value: money(r.price) },
      { label: 'Note', value: (r.note as string) ?? null },
      {
        label: 'Decided',
        value: decided
          ? `${decided.name} · ${iso(r.decidedAt)}${r.decisionNote ? ` · ${r.decisionNote as string}` : ''}`
          : null,
      },
    ],
    items: [{ name: r.item as string, qty: qty(r.qty), detail: `${Number(r.percent)}% off` }],
    links: r.invoiceNo
      ? [{ kind: 'sale', number: r.invoiceNo as string, status: r.saleStatus as string }]
      : [],
    auditIds: [r.id],
  };
}

async function writeOff(number: string): Promise<Found | null> {
  const [w] = await q<Row>(
    `SELECT w.id, w.write_off_no AS number, w.status::text AS status, ${BRANCH('b')} AS branch,
            w.created_at AS "createdAt", ${PERSON('u')} AS "createdBy", p.name AS product, w.qty::text AS qty,
            w.reason::text AS reason, w.note, to_char(w.date, 'YYYY-MM-DD') AS date, pb.batch_no AS "batchNo",
            to_char(pb.expiry_date, 'YYYY-MM-DD') AS expiry, w.serials, ${PERSON('d')} AS "decidedBy",
            w.decided_at AS "decidedAt", w.decision_note AS "decisionNote"
       FROM stock_write_offs w JOIN branches b ON b.id = w.branch_id
       JOIN products p ON p.id = w.product_id
       LEFT JOIN product_batches pb ON pb.id = w.batch_id
       LEFT JOIN staff_profiles u ON u.id = w.created_by
       LEFT JOIN staff_profiles d ON d.id = w.decided_by
      WHERE upper(w.write_off_no) = $1 AND w.deleted_at IS NULL`,
    [number],
  );
  if (!w) return null;
  const decided = w.decidedBy as Person | null;
  const serials = (w.serials as string[]) ?? [];
  return {
    kind: 'write_off',
    number: w.number,
    id: w.id,
    status: w.status,
    branch: w.branch,
    branchIds: [w.branch.id],
    createdAt: iso(w.createdAt),
    createdBy: w.createdBy,
    fields: [
      { label: 'Date', value: w.date as string },
      { label: 'Reason', value: w.reason as string },
      {
        label: 'Batch',
        value: w.batchNo
          ? `${w.batchNo as string}${w.expiry ? ` · expires ${w.expiry as string}` : ''}`
          : null,
      },
      { label: 'Note', value: (w.note as string) ?? null },
      {
        label: 'Decided',
        value: decided
          ? `${decided.name} · ${iso(w.decidedAt)}${w.decisionNote ? ` · ${w.decisionNote as string}` : ''}`
          : null,
      },
    ],
    items: [
      {
        name: w.product as string,
        qty: qty(w.qty),
        detail: serials.length ? `Labels ${serials.join(', ')}` : null,
      },
    ],
    links: [],
    auditIds: [w.id],
  };
}

async function storeReceipt(number: string): Promise<Found | null> {
  const rows = await q<
    Row & {
      productName: string;
      qty: string;
      receivedQty: string | null;
      receiptStatus: string;
      batch: string | null;
      supplier: string | null;
      confirmedBy: Person | null;
      confirmedAt: string | null;
      receiptNote: string | null;
      date: string;
    }
  >(
    `SELECT si.id, si.grn_no AS number, ${BRANCH('b')} AS branch, si.created_at AS "createdAt", ${PERSON('u')} AS "createdBy",
            p.name AS "productName", si.qty::text AS qty, si.received_qty::text AS "receivedQty",
            si.receipt_status::text AS "receiptStatus", si.batch, sp.name AS supplier, ${PERSON('c')} AS "confirmedBy",
            si.confirmed_at AS "confirmedAt", si.receipt_note AS "receiptNote", to_char(si.date, 'YYYY-MM-DD') AS date,
            NULL AS status
       FROM stock_ins si JOIN branches b ON b.id = si.branch_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN suppliers sp ON sp.id = si.supplier_id
       LEFT JOIN staff_profiles u ON u.id = si.created_by
       LEFT JOIN staff_profiles c ON c.id = si.confirmed_by
      WHERE upper(si.grn_no) = $1 AND si.deleted_at IS NULL
      ORDER BY p.name`,
    [number],
  );
  const first = rows[0];
  if (!first) return null;
  const confirmed = rows.every((r) => r.receiptStatus === 'confirmed');
  return {
    kind: 'store_receipt',
    number: first.number,
    id: first.id,
    status: confirmed ? 'confirmed' : 'waiting for the Warehouse Keeper',
    branch: first.branch,
    branchIds: [first.branch.id],
    createdAt: iso(first.createdAt),
    createdBy: first.createdBy,
    fields: [
      { label: 'Stock In date', value: first.date },
      { label: 'Supplier', value: first.supplier },
      {
        label: 'Confirmed',
        value:
          confirmed && first.confirmedBy ? `${first.confirmedBy.name} · ${iso(first.confirmedAt)}` : null,
      },
    ],
    items: rows.map((r) => ({
      name: r.productName,
      qty: qty(r.qty),
      detail: [
        r.batch ? `batch ${r.batch}` : null,
        r.receivedQty !== null ? `received ${qty(r.receivedQty)}` : 'not checked yet',
        r.receiptNote,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    links: [],
    auditIds: rows.map((r) => r.id),
  };
}

const FINDERS = [sale, saleReturn, stockRequest, transfer, discountRequest, writeOff, storeReceipt];

export const traceService = {
  async find(actor: Actor, branchId: string | null, raw: string) {
    const number = raw.trim().toUpperCase();
    let found: Found | null = null;
    for (const finder of FINDERS) {
      found = await finder(number);
      if (found) break;
    }
    if (!found) throw AppError.notFound(`Nothing has the number ${raw.trim()}`);
    const warehouseView =
      (found.kind === 'stock_request' || found.kind === 'transfer') &&
      branchId !== null &&
      (await viewScope(branchId)) === null;
    if (!actor.isSuperAdmin && !warehouseView && (!branchId || !found.branchIds.includes(branchId))) {
      throw AppError.notFound(`Nothing has the number ${raw.trim()}`);
    }
    const timeline = await q<{ at: string; action: string; entity: string; by: Person | null }>(
      `SELECT a.created_at AS at, a.action, a.entity, ${PERSON('s')} AS by
         FROM audit_logs a LEFT JOIN staff_profiles s ON s.id = a.actor_id
        WHERE a.entity_id = ANY($1::text[])
        ORDER BY a.created_at ASC
        LIMIT 200`,
      [found.auditIds],
    );
    const { auditIds: _auditIds, branchIds: _branchIds, ...rest } = found;
    return {
      ...rest,
      timeline: timeline.map((t) => ({ at: iso(t.at), action: t.action, entity: t.entity, by: t.by })),
    };
  },
};
