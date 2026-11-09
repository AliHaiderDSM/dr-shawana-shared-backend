import { AppDataSource } from '../../database/data-source';
import { Decimal, toMoney } from '../../database/transformers';
import { CLINIC_TIME_ZONE } from '../../lib/validation';

type Row = Record<string, unknown>;

const many = (sql: string, params: unknown[]) => AppDataSource.query(sql, params) as Promise<Row[]>;
const money = (value: Decimal) => toMoney(value).toFixed(2);
const BOOKED_ON = `(a.created_at AT TIME ZONE '${CLINIC_TIME_ZONE}')::date`;

type EntryKind = 'booked' | 'advance' | 'balance' | 'refund' | 'visit';
type State = 'unpaid' | 'advance' | 'paid' | 'held' | 'refunded' | 'cancelled';

interface Movement {
  id: string;
  appointmentId: string;
  date: string;
  createdAt: string;
  amount: Decimal;
  method: string | null;
  account: string | null;
}

async function movementsOf(table: 'appointment_payments' | 'appointment_refunds', ids: string[]) {
  if (ids.length === 0) return new Map<string, Movement[]>();
  const rows = await many(
    `SELECT m.id, m.appointment_id AS "appointmentId", m.date::text AS date, m.created_at AS "createdAt",
            m.amount::text AS amount, m.method::text AS method, s.account_name AS account
       FROM ${table} m LEFT JOIN account_sheets s ON s.id = m.account_sheet_id
      WHERE m.deleted_at IS NULL AND m.appointment_id = ANY($1::uuid[])
      ORDER BY m.date, m.created_at`,
    [ids],
  );
  const grouped = new Map<string, Movement[]>();
  for (const r of rows) {
    const id = r.appointmentId as string;
    grouped.set(id, [
      ...(grouped.get(id) ?? []),
      {
        id: r.id as string,
        appointmentId: id,
        date: r.date as string,
        createdAt: new Date(r.createdAt as string).toISOString(),
        amount: new Decimal(r.amount as string),
        method: r.method as string | null,
        account: r.account as string | null,
      },
    ]);
  }
  return grouped;
}

function stateOf(status: string, fee: Decimal, paid: Decimal, refunded: Decimal): State {
  if (status === 'cancelled') {
    if (paid.isZero()) return 'cancelled';
    return refunded.gte(paid) ? 'refunded' : 'held';
  }
  if (fee.isZero() || paid.gte(fee)) return 'paid';
  return paid.gt(0) ? 'advance' : 'unpaid';
}

export const appointmentPaymentsReportService = {
  async entries(from: string, to: string, branchId: string | null) {
    const appointments = await many(
      `SELECT a.id, a.appointment_no AS "appointmentNo", a.date::text AS "visitDate", ${BOOKED_ON}::text AS "bookedOn",
              a.created_at AS "createdAt", a.status::text AS status, a.fee::text AS fee,
              p.name AS "patientName", p.phone AS "patientPhone", d.display_name AS "doctorName",
              b.code AS "branchCode", b.name AS "branchName"
         FROM appointments a
         JOIN branches b ON b.id = a.branch_id
         LEFT JOIN patients p ON p.id = a.patient_id
         LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE a.deleted_at IS NULL AND ($3::uuid IS NULL OR a.branch_id = $3::uuid)
          AND (${BOOKED_ON} BETWEEN $1::date AND $2::date
            OR a.date BETWEEN $1::date AND $2::date
            OR EXISTS (SELECT 1 FROM appointment_payments y WHERE y.appointment_id = a.id AND y.deleted_at IS NULL
                        AND y.date BETWEEN $1::date AND $2::date)
            OR EXISTS (SELECT 1 FROM appointment_refunds r WHERE r.appointment_id = a.id AND r.deleted_at IS NULL
                        AND r.date BETWEEN $1::date AND $2::date))`,
      [from, to, branchId],
    );
    const ids = appointments.map((a) => a.id as string);
    const [payments, refunds] = await Promise.all([
      movementsOf('appointment_payments', ids),
      movementsOf('appointment_refunds', ids),
    ]);

    const historyOf = new Map<
      string,
      {
        kind: 'payment' | 'refund';
        id: string;
        date: string;
        amount: string;
        method: string | null;
        account: string | null;
      }[]
    >();
    const visits: typeof entries = [];
    const entries: {
      kind: EntryKind;
      id: string;
      date: string;
      at: string;
      amount: Decimal;
      method: string | null;
      account: string | null;
      paidAfter: Decimal;
      refundedAfter: Decimal;
      appointment: Row;
    }[] = [];

    for (const a of appointments) {
      const id = a.id as string;
      const paid = payments.get(id) ?? [];
      const back = refunds.get(id) ?? [];
      const bookedOn = a.bookedOn as string;
      historyOf.set(
        id,
        [
          ...paid.map((m) => ({ kind: 'payment' as const, m })),
          ...back.map((m) => ({ kind: 'refund' as const, m })),
        ]
          .sort((x, y) => x.m.date.localeCompare(y.m.date) || x.m.createdAt.localeCompare(y.m.createdAt))
          .map(({ kind, m }) => ({
            kind,
            id: m.id,
            date: m.date,
            amount: money(m.amount),
            method: m.method,
            account: m.account,
          })),
      );
      const inRange = (date: string) => date >= from && date <= to;
      let paidAfter = new Decimal(0);
      for (const p of paid) {
        paidAfter = paidAfter.plus(p.amount);
        if (!inRange(p.date)) continue;
        const refundedAfter = back
          .filter((r) => r.date < p.date || (r.date === p.date && r.createdAt <= p.createdAt))
          .reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
        entries.push({
          kind: p.date < (a.visitDate as string) ? 'advance' : 'balance',
          id: p.id,
          date: p.date,
          at: p.createdAt,
          amount: p.amount,
          method: p.method,
          account: p.account,
          paidAfter,
          refundedAfter,
          appointment: a,
        });
      }
      let refundedAfter = new Decimal(0);
      for (const r of back) {
        refundedAfter = refundedAfter.plus(r.amount);
        if (!inRange(r.date)) continue;
        const paidUpTo = paid
          .filter((p) => p.date < r.date || (p.date === r.date && p.createdAt <= r.createdAt))
          .reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
        entries.push({
          kind: 'refund',
          id: r.id,
          date: r.date,
          at: r.createdAt,
          amount: r.amount,
          method: r.method,
          account: r.account,
          paidAfter: paidUpTo,
          refundedAfter,
          appointment: a,
        });
      }
      const visitDate = a.visitDate as string;
      const hasEntry =
        paid.some((p) => inRange(p.date)) ||
        back.some((r) => inRange(r.date)) ||
        (inRange(bookedOn) && !paid.some((p) => p.date === bookedOn));
      if (inRange(visitDate) && !hasEntry) {
        const upTo = (list: Movement[]) =>
          list.filter((m) => m.date <= to).reduce((sum, m) => sum.plus(m.amount), new Decimal(0));
        visits.push({
          kind: 'visit',
          id: `visit-${id}`,
          date: visitDate,
          at: new Date(a.createdAt as string).toISOString(),
          amount: new Decimal(0),
          method: null,
          account: null,
          paidAfter: upTo(paid),
          refundedAfter: upTo(back),
          appointment: a,
        });
      }
      if (inRange(bookedOn) && !paid.some((p) => p.date === bookedOn)) {
        entries.push({
          kind: 'booked',
          id: `booked-${id}`,
          date: bookedOn,
          at: new Date(a.createdAt as string).toISOString(),
          amount: new Decimal(0),
          method: null,
          account: null,
          paidAfter: new Decimal(0),
          refundedAfter: new Decimal(0),
          appointment: a,
        });
      }
    }

    entries.sort((x, y) => x.date.localeCompare(y.date) || x.at.localeCompare(y.at));

    const toRow = (e: (typeof entries)[number], index: number) => {
      const a = e.appointment;
      const fee = new Decimal((a.fee as string | null) ?? 0);
      const status = a.status as string;
      const before = e.kind === 'refund' ? e.paidAfter : e.paidAfter.minus(e.amount);
      const after = stateOf(status, fee, e.paidAfter, e.refundedAfter);
      const wasPaid = stateOf('booked', fee, before, new Decimal(0)) === 'paid';
      return {
        sr: index + 1,
        id: e.id,
        kind: e.kind,
        date: e.date,
        amount: money(e.amount),
        method: e.method,
        account: e.account,
        appointment: {
          id: a.id as string,
          appointmentNo: Number(a.appointmentNo),
          visitDate: a.visitDate as string,
          bookedOn: a.bookedOn as string,
          status,
          fee: money(fee),
          history: historyOf.get(a.id as string) ?? [],
        },
        patient: { name: a.patientName as string | null, phone: a.patientPhone as string | null },
        doctor: a.doctorName as string | null,
        branch: { code: a.branchCode as string, name: a.branchName as string },
        paidAfter: money(e.paidAfter),
        refundedAfter: money(e.refundedAfter),
        remainingAfter: money(
          status === 'cancelled' ? new Decimal(0) : Decimal.max(fee.minus(e.paidAfter), 0),
        ),
        stateAfter: after,
        fullyPaidHere:
          e.kind !== 'refund' && e.kind !== 'booked' && e.kind !== 'visit' && after === 'paid' && !wasPaid,
      };
    };
    const rows = entries.map(toRow);
    const visitRows = visits
      .sort((x, y) => x.date.localeCompare(y.date) || x.at.localeCompare(y.at))
      .map((e, index) => toRow(e, rows.length + index));

    const total = (kind: EntryKind) =>
      rows.filter((r) => r.kind === kind).reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
    const count = (kind: EntryKind) => rows.filter((r) => r.kind === kind).length;
    const collected = total('advance').plus(total('balance'));
    return {
      from,
      to,
      branchId,
      summary: {
        bookings: appointments.filter((a) => (a.bookedOn as string) >= from && (a.bookedOn as string) <= to)
          .length,
        advance: count('advance'),
        advanceAmount: money(total('advance')),
        balance: count('balance'),
        balanceAmount: money(total('balance')),
        refunds: count('refund'),
        refundAmount: money(total('refund')),
        collected: money(collected),
        net: money(collected.minus(total('refund'))),
        fullyPaid: rows.filter((r) => r.fullyPaidHere).length,
      },
      rows,
      visits: visitRows,
    };
  },
};
