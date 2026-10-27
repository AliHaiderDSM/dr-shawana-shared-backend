import { AppDataSource } from '../../database/data-source';
import { Decimal, toMoney } from '../../database/transformers';
import { CLINIC_TIME_ZONE } from '../../lib/validation';

type Row = Record<string, unknown>;

const many = (sql: string, params: unknown[]) => AppDataSource.query(sql, params) as Promise<Row[]>;
const money = (value: Decimal) => toMoney(value).toFixed(2);
const sum = (values: Decimal[]) => values.reduce((total, v) => total.plus(v), new Decimal(0));
const BOOKED_ON = `(a.created_at AT TIME ZONE '${CLINIC_TIME_ZONE}')::date`;

interface Money {
  appointmentId: string;
  date: string;
  amount: Decimal;
  method: string | null;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

async function moneyOf(table: 'appointment_payments' | 'appointment_refunds', ids: string[], upTo: string) {
  if (ids.length === 0) return new Map<string, Money[]>();
  const rows = await many(
    `SELECT appointment_id AS "appointmentId", date::text AS date, amount::text AS amount, method::text AS method
       FROM ${table} WHERE deleted_at IS NULL AND appointment_id = ANY($1::uuid[]) AND date <= $2::date
      ORDER BY date, created_at`,
    [ids, upTo],
  );
  const grouped = new Map<string, Money[]>();
  for (const r of rows) {
    const id = r.appointmentId as string;
    grouped.set(id, [
      ...(grouped.get(id) ?? []),
      {
        appointmentId: id,
        date: r.date as string,
        amount: new Decimal(r.amount as string),
        method: r.method as string,
      },
    ]);
  }
  return grouped;
}

interface Appointment {
  id: string;
  appointmentNo: number;
  visitDate: string;
  bookedOn: string;
  status: string;
  fee: Decimal;
  patientName: string | null;
  patientPhone: string | null;
  doctorName: string | null;
  branchCode: string;
  branchName: string;
}

const APPOINTMENT_SELECT = `
  SELECT a.id, a.appointment_no AS "appointmentNo", a.date::text AS "visitDate", ${BOOKED_ON}::text AS "bookedOn",
         a.status::text AS status, a.fee::text AS fee, p.name AS "patientName", p.phone AS "patientPhone",
         d.display_name AS "doctorName", b.code AS "branchCode", b.name AS "branchName"
    FROM appointments a
    JOIN branches b ON b.id = a.branch_id
    LEFT JOIN patients p ON p.id = a.patient_id
    LEFT JOIN doctors d ON d.id = a.doctor_id`;

const toAppointment = (r: Row): Appointment => ({
  id: r.id as string,
  appointmentNo: Number(r.appointmentNo),
  visitDate: r.visitDate as string,
  bookedOn: r.bookedOn as string,
  status: r.status as string,
  fee: new Decimal((r.fee as string | null) ?? 0),
  patientName: r.patientName as string | null,
  patientPhone: r.patientPhone as string | null,
  doctorName: r.doctorName as string | null,
  branchCode: r.branchCode as string,
  branchName: r.branchName as string,
});

function standing(a: Appointment, paid: Decimal, refunded: Decimal) {
  if (a.status === 'cancelled') {
    if (paid.isZero()) return 'cancelled' as const;
    return refunded.gte(paid) ? ('refunded' as const) : ('held' as const);
  }
  if (a.fee.gt(0) && paid.gte(a.fee)) return 'paid' as const;
  if (a.fee.isZero()) return 'paid' as const;
  return paid.gt(0) ? ('advance' as const) : ('unpaid' as const);
}

const dueOf = (a: Appointment, paid: Decimal) =>
  a.status === 'cancelled' ? new Decimal(0) : Decimal.max(a.fee.minus(paid), 0);

export const appointmentPaymentsReportService = {
  async day(date: string, branchId: string | null) {
    const candidates = (
      await many(
        `${APPOINTMENT_SELECT}
          WHERE a.deleted_at IS NULL AND ($2::uuid IS NULL OR a.branch_id = $2::uuid) AND ${BOOKED_ON} <= $1::date
            AND (
              ${BOOKED_ON} = $1::date
              OR EXISTS (SELECT 1 FROM appointment_payments y WHERE y.appointment_id = a.id AND y.deleted_at IS NULL AND y.date = $1::date)
              OR EXISTS (SELECT 1 FROM appointment_refunds r WHERE r.appointment_id = a.id AND r.deleted_at IS NULL AND r.date = $1::date)
              OR (a.status <> 'cancelled' AND a.date <= $1::date AND a.fee > COALESCE((
                    SELECT SUM(y.amount) FROM appointment_payments y
                     WHERE y.appointment_id = a.id AND y.deleted_at IS NULL AND y.date <= $1::date), 0))
            )
          ORDER BY ${BOOKED_ON}, a.appointment_no`,
        [date, branchId],
      )
    ).map(toAppointment);
    const ids = candidates.map((a) => a.id);
    const [payments, refunds] = await Promise.all([
      moneyOf('appointment_payments', ids, date),
      moneyOf('appointment_refunds', ids, date),
    ]);

    const rows = candidates.map((a) => {
      const paid = payments.get(a.id) ?? [];
      const back = refunds.get(a.id) ?? [];
      const before = paid.filter((p) => p.date < date);
      const today = paid.filter((p) => p.date === date);
      const paidBefore = sum(before.map((p) => p.amount));
      const paidTotal = sum(paid.map((p) => p.amount));
      const refundedBefore = sum(back.filter((r) => r.date < date).map((r) => r.amount));
      const refundedTotal = sum(back.map((r) => r.amount));
      const advanceToday = sum(today.filter((p) => p.date < a.visitDate).map((p) => p.amount));
      const balanceToday = sum(today.filter((p) => p.date >= a.visitDate).map((p) => p.amount));
      const refundToday = refundedTotal.minus(refundedBefore);
      const startState = standing(a, paidBefore, refundedBefore);
      const endState = standing(a, paidTotal, refundedTotal);
      const dueBefore = a.visitDate < date ? dueOf(a, paidBefore) : new Decimal(0);
      const dueAfter = a.visitDate <= date ? dueOf(a, paidTotal) : new Decimal(0);
      return {
        id: a.id,
        appointmentNo: a.appointmentNo,
        bookedOn: a.bookedOn,
        visitDate: a.visitDate,
        appointmentStatus: a.status,
        patient: { name: a.patientName, phone: a.patientPhone },
        doctor: a.doctorName,
        branch: { code: a.branchCode, name: a.branchName },
        fee: money(a.fee),
        advance: money(sum(paid.filter((p) => p.date < a.visitDate).map((p) => p.amount))),
        paidBefore: money(paidBefore),
        advanceToday: money(advanceToday),
        balanceToday: money(balanceToday),
        refundToday: money(refundToday),
        totalPaid: money(paidTotal),
        refunded: money(refundedTotal),
        remaining: money(dueOf(a, paidTotal)),
        held: money(
          a.status === 'cancelled' ? Decimal.max(paidTotal.minus(refundedTotal), 0) : new Decimal(0),
        ),
        state: endState,
        fullyPaidToday: endState === 'paid' && startState !== 'paid' && today.length > 0,
        fromBefore: a.bookedOn < date,
        waitingDays: daysBetween(a.visitDate, date),
        dueBefore: money(dueBefore),
        dueAfter: money(dueAfter),
        methods: [...new Set(today.map((p) => p.method).filter(Boolean))] as string[],
      };
    });

    const amount = (key: 'advanceToday' | 'balanceToday' | 'refundToday' | 'dueBefore' | 'dueAfter') =>
      sum(rows.map((r) => new Decimal(r[key])));
    const count = (key: 'advanceToday' | 'balanceToday' | 'refundToday' | 'dueBefore' | 'dueAfter') =>
      rows.filter((r) => Number(r[key]) > 0).length;
    const collected = amount('advanceToday').plus(amount('balanceToday'));
    return {
      date,
      branchId,
      summary: {
        opening: count('dueBefore'),
        openingAmount: money(amount('dueBefore')),
        booked: rows.filter((r) => r.bookedOn === date).length,
        advance: count('advanceToday'),
        advanceAmount: money(amount('advanceToday')),
        balance: count('balanceToday'),
        balanceAmount: money(amount('balanceToday')),
        fullyPaid: rows.filter((r) => r.fullyPaidToday).length,
        refunds: count('refundToday'),
        refundAmount: money(amount('refundToday')),
        collected: money(collected),
        net: money(collected.minus(amount('refundToday'))),
        closing: count('dueAfter'),
        closingAmount: money(amount('dueAfter')),
      },
      rows: rows.map((r, i) => ({ sr: i + 1, ...r })),
    };
  },

  async month(month: string, branchId: string | null) {
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const to = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
    const days = Array.from(
      { length: Number(to.slice(8)) },
      (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
    );

    const [inMonth, booked, refundsInMonth, open] = await Promise.all([
      many(
        `SELECT y.date::text AS date, y.amount::text AS amount, a.date::text AS "visitDate", a.id
           FROM appointment_payments y JOIN appointments a ON a.id = y.appointment_id AND a.deleted_at IS NULL
          WHERE y.deleted_at IS NULL AND y.date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR a.branch_id = $3::uuid)`,
        [from, to, branchId],
      ),
      many(
        `SELECT ${BOOKED_ON}::text AS day, COUNT(*)::int AS n FROM appointments a
          WHERE a.deleted_at IS NULL AND ${BOOKED_ON} BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR a.branch_id = $3::uuid)
          GROUP BY 1`,
        [from, to, branchId],
      ),
      many(
        `SELECT r.date::text AS date, r.amount::text AS amount FROM appointment_refunds r
           JOIN appointments a ON a.id = r.appointment_id AND a.deleted_at IS NULL
          WHERE r.deleted_at IS NULL AND r.date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR a.branch_id = $3::uuid)`,
        [from, to, branchId],
      ),
      many(
        `${APPOINTMENT_SELECT}
          WHERE a.deleted_at IS NULL AND a.status <> 'cancelled' AND ($3::uuid IS NULL OR a.branch_id = $3::uuid)
            AND a.date <= $2::date AND ${BOOKED_ON} <= $2::date
            AND a.fee > COALESCE((SELECT SUM(y.amount) FROM appointment_payments y
                                   WHERE y.appointment_id = a.id AND y.deleted_at IS NULL AND y.date < $1::date), 0)`,
        [from, to, branchId],
      ),
    ]);
    const openAppointments = open.map(toAppointment);
    const openPayments = await moneyOf(
      'appointment_payments',
      openAppointments.map((a) => a.id),
      to,
    );
    const bookedOn = new Map(booked.map((r) => [r.day as string, Number(r.n)]));

    const perDay = days.map((day) => {
      const paidToday = inMonth.filter((p) => p.date === day);
      const advance = sum(
        paidToday
          .filter((p) => (p.date as string) < (p.visitDate as string))
          .map((p) => new Decimal(p.amount as string)),
      );
      const balance = sum(
        paidToday
          .filter((p) => (p.date as string) >= (p.visitDate as string))
          .map((p) => new Decimal(p.amount as string)),
      );
      const refunds = sum(
        refundsInMonth.filter((r) => r.date === day).map((r) => new Decimal(r.amount as string)),
      );
      let fullyPaid = 0;
      let due = 0;
      let dueAmount = new Decimal(0);
      for (const a of openAppointments) {
        if (a.bookedOn > day) continue;
        const paid = openPayments.get(a.id) ?? [];
        const upTo = sum(paid.filter((p) => p.date <= day).map((p) => p.amount));
        const before = sum(paid.filter((p) => p.date < day).map((p) => p.amount));
        if (paid.some((p) => p.date === day) && upTo.gte(a.fee) && before.lt(a.fee)) fullyPaid += 1;
        if (a.visitDate <= day && upTo.lt(a.fee)) {
          due += 1;
          dueAmount = dueAmount.plus(a.fee.minus(upTo));
        }
      }
      return {
        date: day,
        booked: bookedOn.get(day) ?? 0,
        advance: money(advance),
        balance: money(balance),
        refunds: money(refunds),
        net: money(advance.plus(balance).minus(refunds)),
        fullyPaid,
        due,
        dueAmount: money(dueAmount),
      };
    });

    const total = (key: 'advance' | 'balance' | 'refunds' | 'net') =>
      money(sum(perDay.map((d) => new Decimal(d[key]))));
    return {
      month,
      branchId,
      days: perDay,
      totals: {
        booked: perDay.reduce((n, d) => n + d.booked, 0),
        advance: total('advance'),
        balance: total('balance'),
        refunds: total('refunds'),
        net: total('net'),
        fullyPaid: perDay.reduce((n, d) => n + d.fullyPaid, 0),
      },
    };
  },
};
