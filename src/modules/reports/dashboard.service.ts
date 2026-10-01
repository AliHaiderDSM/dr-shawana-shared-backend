import { AppDataSource } from '../../database/data-source';
import { type Actor } from '../../lib/actor';
import { hasPermission } from '../../lib/permissions';
import { today } from '../../lib/validation';
import { type ReportScope } from './reports.service';

type Row = Record<string, string | null>;

const one = async (sql: string, params: unknown[]) =>
  ((await AppDataSource.query(sql, params)) as Row[])[0] ?? {};
const many = (sql: string, params: unknown[]) => AppDataSource.query(sql, params) as Promise<Row[]>;

function branchClause(column: string, index: number) {
  return `($${index}::uuid IS NULL OR ${column} = $${index}::uuid)`;
}

export const dashboardService = {
  async kpis(actor: Actor, scope: ReportScope, year?: number) {
    const day = today();
    const month = day.slice(0, 7);
    const chartYear = year ?? Number(day.slice(0, 4));
    const b = scope.branchId;
    const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(actor.role, permission);
    const result: Record<string, unknown> = { date: day, month, scope: b ? 'branch' : 'all_branches' };

    result.counts = await one(
      `SELECT (SELECT COUNT(*) FROM patients p WHERE p.deleted_at IS NULL AND ($1::uuid IS NULL OR p.created_in_branch_id = $1
                 OR EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.branch_id = $1 AND a.deleted_at IS NULL)))::int AS patients,
              (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL AND pr.status = 'active' AND ${branchClause('pr.branch_id', 1)})::int AS products`,
      [b],
    );

    if (can('sales.view')) {
      const sales = (from: string, to: string) =>
        one(
          `SELECT (SELECT COUNT(*) FROM sales s WHERE s.deleted_at IS NULL AND ${branchClause('s.branch_id', 1)} AND s.date BETWEEN $2 AND $3)::int AS bills,
                  (SELECT COALESCE(SUM(si.qty), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                    WHERE s.deleted_at IS NULL AND si.deleted_at IS NULL AND ${branchClause('s.branch_id', 1)} AND s.date BETWEEN $2 AND $3)::numeric(12,3)::text AS qty,
                  ((SELECT COALESCE(SUM(y.amount), 0) FROM sale_payments y JOIN sales s ON s.id = y.sale_id
                    WHERE s.deleted_at IS NULL AND y.deleted_at IS NULL AND ${branchClause('y.branch_id', 1)} AND y.date BETWEEN $2 AND $3)
                   - (SELECT COALESCE(SUM(r.refund_amount), 0) FROM sale_returns r
                    WHERE r.deleted_at IS NULL AND ${branchClause('r.branch_id', 1)} AND r.refund_date BETWEEN $2 AND $3))::numeric(12,2)::text AS revenue,
                  (SELECT COALESCE(SUM(r.refund_amount), 0) FROM sale_returns r
                    WHERE r.deleted_at IS NULL AND ${branchClause('r.branch_id', 1)} AND r.refund_date BETWEEN $2 AND $3)::numeric(12,2)::text AS refunds`,
          [b, from, to],
        );
      result.sales = { today: await sales(day, day), month: await sales(`${month}-01`, day) };
      result.pendingDeliveries = (
        await one(
          `SELECT COUNT(*)::int AS count FROM sales s WHERE s.deleted_at IS NULL AND s.delivery_status = 'pending' AND ${branchClause('s.branch_id', 1)}`,
          [b],
        )
      ).count;
    }

    if (can('appointments.view')) {
      const appointments = (from: string, to: string) =>
        one(
          `SELECT (SELECT COUNT(*) FROM appointments a WHERE a.deleted_at IS NULL AND ${branchClause('a.branch_id', 1)}
                     AND ($4::uuid IS NULL OR a.doctor_id = $4) AND a.date BETWEEN $2 AND $3)::int AS count,
                  (SELECT COALESCE(SUM(y.amount), 0) FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id
                    WHERE a.deleted_at IS NULL AND y.deleted_at IS NULL AND ${branchClause('y.branch_id', 1)}
                      AND ($4::uuid IS NULL OR a.doctor_id = $4) AND y.date BETWEEN $2 AND $3)::numeric(12,2)::text AS amount`,
          [b, from, to, scope.doctorId],
        );
      result.appointments = {
        today: await appointments(day, day),
        month: await appointments(`${month}-01`, day),
      };
    }

    if (can('sales.view') && can('appointmentPayments.view') && !scope.doctorId) {
      const sales = (result.sales as { month: Row }).month.revenue ?? '0';
      const consultations = (result.appointments as { month: Row } | undefined)?.month.amount ?? '0';
      result.revenueSplit = { month, sales, consultations };
    }

    if (can('stock.view') || can('inventoryReport.view')) {
      const movement = (from: string, to: string) =>
        one(
          `SELECT COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('purchase_in', 'stock_in')), 0)::numeric(12,3)::text AS "stockIn",
                  COALESCE(-SUM(m.qty) FILTER (WHERE m.type = 'stock_out'), 0)::numeric(12,3)::text AS "stockOut"
             FROM stock_movements m WHERE ${branchClause('m.branch_id', 1)} AND m.date BETWEEN $2 AND $3`,
          [b, from, to],
        );
      result.stock = {
        today: await movement(day, day),
        month: await movement(`${month}-01`, day),
        lowStockCount: (
          await one(
            `SELECT COUNT(*)::int AS count FROM product_stock_balances v WHERE v.is_low_stock AND ${branchClause('v.branch_id', 1)}`,
            [b],
          )
        ).count,
      };
    }

    const charts: Record<string, unknown> = { year: chartYear };
    const months = Array.from({ length: 12 }, (_, i) => `${chartYear}-${String(i + 1).padStart(2, '0')}`);
    const series = (rows: Row[], key: string) =>
      months.map((m) => rows.find((r) => r.month === m)?.[key] ?? '0');
    if (can('sales.view')) {
      const rows = await many(
        `SELECT t.month, SUM(t.amount)::numeric(12,2)::text AS amount FROM (
           SELECT to_char(y.date, 'YYYY-MM') AS month, y.amount
             FROM sale_payments y JOIN sales s ON s.id = y.sale_id
            WHERE s.deleted_at IS NULL AND y.deleted_at IS NULL AND ${branchClause('y.branch_id', 1)} AND EXTRACT(YEAR FROM y.date) = $2
           UNION ALL
           SELECT to_char(r.refund_date, 'YYYY-MM'), -r.refund_amount
             FROM sale_returns r
            WHERE r.deleted_at IS NULL AND r.refund_amount > 0 AND ${branchClause('r.branch_id', 1)} AND EXTRACT(YEAR FROM r.refund_date) = $2
          ) t GROUP BY 1`,
        [b, chartYear],
      );
      charts.salesAmount = series(rows, 'amount');
      const products = await many(
        `SELECT pr.name AS product, to_char(s.date, 'YYYY-MM') AS month, SUM(si.qty)::numeric(12,3)::text AS qty
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products pr ON pr.id = si.product_id
          WHERE s.deleted_at IS NULL AND si.deleted_at IS NULL AND ${branchClause('s.branch_id', 1)} AND EXTRACT(YEAR FROM s.date) = $2
          GROUP BY 1, 2`,
        [b, chartYear],
      );
      const names = [...new Set(products.map((p) => p.product as string))];
      charts.productSales = names.map((name) => ({
        product: name,
        qty: series(
          products.filter((p) => p.product === name),
          'qty',
        ),
      }));
    }
    if (can('appointments.view')) {
      const rows = await many(
        `SELECT to_char(y.date, 'YYYY-MM') AS month, SUM(y.amount)::numeric(12,2)::text AS amount
           FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id
          WHERE a.deleted_at IS NULL AND y.deleted_at IS NULL AND ${branchClause('y.branch_id', 1)}
            AND ($3::uuid IS NULL OR a.doctor_id = $3) AND EXTRACT(YEAR FROM y.date) = $2
          GROUP BY 1`,
        [b, chartYear, scope.doctorId],
      );
      charts.appointmentAmount = series(rows, 'amount');
    }
    result.charts = { months, ...charts };

    if (!b && can('sales.view')) {
      result.byBranch = await many(
        `SELECT br.code AS branch, br.name,
                ((SELECT COALESCE(SUM(y.amount), 0) FROM sale_payments y JOIN sales s ON s.id = y.sale_id
                  WHERE s.deleted_at IS NULL AND y.deleted_at IS NULL AND y.branch_id = br.id AND to_char(y.date, 'YYYY-MM') = $1)
                 - (SELECT COALESCE(SUM(r.refund_amount), 0) FROM sale_returns r
                  WHERE r.deleted_at IS NULL AND r.branch_id = br.id AND to_char(r.refund_date, 'YYYY-MM') = $1))::numeric(12,2)::text AS "salesMonth",
                (SELECT COALESCE(SUM(y.amount), 0) FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id
                  WHERE a.deleted_at IS NULL AND y.deleted_at IS NULL AND y.branch_id = br.id AND to_char(y.date, 'YYYY-MM') = $1)::numeric(12,2)::text AS "appointmentsMonth"
           FROM branches br WHERE br.deleted_at IS NULL ORDER BY br.code`,
        [month],
      );
    }
    return result;
  },
};
