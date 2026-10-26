import { AppDataSource } from '../../database/data-source';
import { AppError } from '../../lib/errors';
import { isDispatchBranch } from './fulfilment';
import type { GDN_REPORT_TYPES } from './sales.schemas';

type GdnReportType = (typeof GDN_REPORT_TYPES)[number];

interface OrderRow {
  id: string;
  saleType: 'online' | 'office';
  invoiceNo: string;
  gdnNo: string | null;
  date: string;
  dispatchedOn: string | null;
  cancelledOn: string | null;
  deliveryStatus: string;
  paymentStatus: string;
  total: string;
  city: string | null;
  customerName: string | null;
  customerPhone: string | null;
  bookedCode: string | null;
  bookedName: string | null;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const sum = (rows: { total: string }[]) => rows.reduce((total, r) => total + Number(r.total), 0).toFixed(2);

export const gdnReportService = {
  async day(branchId: string, date: string, superAdmin: boolean, wanted: GdnReportType = 'online') {
    const dispatch = await isDispatchBranch(AppDataSource.manager, branchId);
    const type: GdnReportType = superAdmin ? wanted : 'online';
    if (!superAdmin && !dispatch) {
      throw AppError.forbidden('The GDN report is for the Dispatch Department and the Super Admin');
    }
    const column = dispatch ? 's.fulfillment_branch_id' : 's.branch_id';
    const [branch] = (await AppDataSource.query('SELECT name, code FROM branches WHERE id = $1', [
      branchId,
    ])) as { name: string; code: string }[];
    if (!branch) throw AppError.notFound('Branch');
    const select = `SELECT s.id, s.sale_type AS "saleType", s.invoice_no AS "invoiceNo", s.gdn_no AS "gdnNo", s.date::text AS date,
              s.dispatched_on::text AS "dispatchedOn", s.cancelled_on::text AS "cancelledOn",
              s.delivery_status AS "deliveryStatus", s.payment_status AS "paymentStatus",
              s.total::text AS total, COALESCE(s.patient_city, s.city) AS city,
              p.name AS "customerName", p.phone AS "customerPhone",
              b.code AS "bookedCode", b.name AS "bookedName"
         FROM sales s
         LEFT JOIN patients p ON p.id = s.patient_id
         LEFT JOIN branches b ON b.id = s.branch_id`;
    const onlineRows =
      type === 'office'
        ? []
        : ((await AppDataSource.query(
            `${select}
        WHERE ${column} = $1 AND s.sale_type = 'online' AND s.deleted_at IS NULL
          AND s.date <= $2::date
          AND (s.dispatched_on IS NULL OR s.dispatched_on >= $2::date)
          AND (s.cancelled_on IS NULL OR s.cancelled_on >= $2::date)
          AND NOT (s.delivery_status = 'cancelled' AND s.cancelled_on IS NULL)
        ORDER BY s.date, s.invoice_seq`,
            [branchId, date],
          )) as OrderRow[]);
    const officeRows =
      type === 'online'
        ? []
        : ((await AppDataSource.query(
            `${select}
        WHERE (${dispatch ? '$1::uuid IS NOT NULL' : 's.branch_id = $1'}) AND s.sale_type = 'office' AND s.deleted_at IS NULL
          AND s.date = $2::date
        ORDER BY b.code, s.invoice_seq`,
            [branchId, date],
          )) as OrderRow[]);
    const rows = [...onlineRows, ...officeRows];
    const items = rows.length
      ? ((await AppDataSource.query(
          `SELECT i.sale_id AS "saleId", COALESCE(pr.name, bu.name, 'Item') AS name, i.qty::text AS qty
             FROM sale_items i
             LEFT JOIN products pr ON pr.id = i.product_id
             LEFT JOIN bundles bu ON bu.id = i.bundle_id
            WHERE i.sale_id = ANY($1::uuid[]) AND i.deleted_at IS NULL
            ORDER BY i.created_at`,
          [rows.map((r) => r.id)],
        )) as { saleId: string; name: string; qty: string }[])
      : [];
    const orders = rows.map((r) => {
      const office = r.saleType === 'office';
      const fromBefore = !office && r.date < date;
      const dispatchedToday = office || r.dispatchedOn === date;
      const cancelledToday = r.cancelledOn === date;
      return {
        id: r.id,
        invoiceNo: r.invoiceNo,
        gdnNo: dispatchedToday ? r.gdnNo : null,
        date: r.date,
        saleType: r.saleType,
        dispatchedOn: dispatchedToday ? (r.dispatchedOn ?? r.date) : null,
        status: dispatchedToday ? 'dispatched' : cancelledToday ? 'cancelled' : 'pending',
        fromBefore,
        waitingDays: daysBetween(r.date, date),
        paymentStatus: r.paymentStatus,
        total: Number(r.total).toFixed(2),
        city: r.city,
        customer: { name: r.customerName, phone: r.customerPhone },
        bookedAt: r.bookedCode ? { code: r.bookedCode, name: r.bookedName } : null,
        items: items
          .filter((i) => i.saleId === r.id)
          .map((i) => ({ name: i.name, qty: Number(i.qty).toString() })),
      };
    });
    const opening = orders.filter((o) => o.fromBefore);
    const fresh = orders.filter((o) => !o.fromBefore);
    const dispatched = orders.filter((o) => o.status === 'dispatched');
    const cancelled = orders.filter((o) => o.status === 'cancelled');
    const closing = orders.filter((o) => o.status === 'pending');
    const counter = orders.filter((o) => o.saleType === 'office');
    return {
      date,
      type,
      branch: { ...branch, dispatch },
      summary: {
        office: counter.length,
        officeAmount: sum(counter),
        opening: opening.length,
        openingAmount: sum(opening),
        newOrders: fresh.length,
        newAmount: sum(fresh),
        dispatched: dispatched.length,
        dispatchedAmount: sum(dispatched),
        dispatchedFromOpening: dispatched.filter((o) => o.fromBefore).length,
        dispatchedFromNew: dispatched.filter((o) => !o.fromBefore).length,
        cancelled: cancelled.length,
        closing: closing.length,
        closingAmount: sum(closing),
        closingFromOpening: closing.filter((o) => o.fromBefore).length,
        oldestPending: closing[0]?.date ?? null,
      },
      orders,
    };
  },
};
