import type { DataSource } from 'typeorm';
import type { DumpRow, DumpTables } from './dump-reader';
import { PatientResolver } from './patient-resolver';
import { amount, dateOf, enteredByNames, isActive, money, text, timestampOf } from './possoft-values';

export const POSSOFT_RESYNC_TABLES = [
  'doctors',
  'appointments',
  'appointment_payments',
  'customers',
  'accounts_sheet',
  'wt_users',
];

export interface ResyncSummary {
  backfilled: number;
  updated: number;
  unchanged: number;
  created: number;
  payments: number;
  skipped: { noDoctor: number };
}

const SYNCED_FIELDS = [
  'app_pat_id',
  'app_pat_city',
  'app_doc_id',
  'app_date',
  'app_time_from',
  'app_time_to',
  'app_on_phy_status',
  'app_on_phy_followup',
  'app_status',
  'app_remark',
  'app_issues',
  'app_received_amount',
];

function signatures(dump: DumpTables) {
  const paid = new Map<string, string[]>();
  for (const pay of dump.get('appointment_payments') ?? []) {
    if (!isActive(pay)) continue;
    const key = text(pay.appoint_id);
    paid.set(key, [...(paid.get(key) ?? []), amount(pay.app_pay_amount).toFixed(2)]);
  }
  return new Map(
    (dump.get('appointments') ?? []).map((row) => {
      const id = text(row.app_id);
      const fields = SYNCED_FIELDS.map((f) => text(row[f]));
      return [id, JSON.stringify([fields, (paid.get(id) ?? []).sort()])] as const;
    }),
  );
}

class DryRunRollback extends Error {}

function parseTime(value: string | null | undefined): string | null {
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text(value));
  if (!match) return null;
  const h = Math.min(23, Number(match[1]));
  return `${String(h).padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, (h ?? 0) * 60 + (m ?? 0) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

const statusOf = (row: DumpRow) =>
  text(row.app_status) === '1' ? 'completed' : text(row.app_status) === '2' ? 'cancelled' : 'booked';
const modeOf = (row: DumpRow) => (/online/i.test(text(row.app_on_phy_status)) ? 'online' : 'physical');
const visitOf = (row: DumpRow) => (/follow/i.test(text(row.app_on_phy_followup)) ? 'followup' : 'new');

export async function resyncAppointments(
  source: DataSource,
  oldDump: DumpTables,
  newDump: DumpTables,
  options: { dryRun?: boolean; onProgress?: (message: string) => void } = {},
): Promise<ResyncSummary> {
  const report = options.onProgress ?? (() => {});
  const summary: ResyncSummary = {
    backfilled: 0,
    updated: 0,
    unchanged: 0,
    created: 0,
    payments: 0,
    skipped: { noDoctor: 0 },
  };

  try {
    await source.transaction(async (em) => {
      const doctorMap = new Map<string, { doctorId: string; branchId: string }>();
      for (const doc of newDump.get('doctors') ?? []) {
        const username = text(doc.doc_username)
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '');
        const name = text(doc.doc_name);
        let found: { id: string; branch_id: string } | undefined;
        if (username) {
          [found] = (await em.query(
            `SELECT d.id, d.branch_id FROM doctors d JOIN staff_profiles s ON s.id = d.staff_id
              WHERE s.username = $1 AND d.deleted_at IS NULL LIMIT 1`,
            [username],
          )) as { id: string; branch_id: string }[];
        }
        if (!found && name) {
          [found] = (await em.query(
            `SELECT id, branch_id FROM doctors WHERE lower(trim(display_name)) = lower($1)
               AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
            [name],
          )) as { id: string; branch_id: string }[];
        }
        if (found) doctorMap.set(text(doc.doc_id), { doctorId: found.id, branchId: found.branch_id });
      }

      const resolver = await PatientResolver.load(em, newDump.get('customers') ?? []);
      const resolveCity = (row: DumpRow) => text(row.app_pat_city) || 'Lahore';

      const accountByCode = new Map(
        (
          (await em.query(
            `SELECT id, lower(account_code) AS code FROM account_sheets WHERE deleted_at IS NULL`,
          )) as { id: string; code: string }[]
        ).map((r) => [r.code, r.id] as const),
      );
      const posSheets = new Map(
        (newDump.get('accounts_sheet') ?? []).map((r) => [text(r.as_id), r] as const),
      );
      const paymentsByAppt = new Map<string, DumpRow[]>();
      for (const pay of newDump.get('appointment_payments') ?? []) {
        const key = text(pay.appoint_id);
        paymentsByAppt.set(key, [...(paymentsByAppt.get(key) ?? []), pay]);
      }

      const keyToAppId = new Map<string, string>();
      const addKeys = async (rows: DumpRow[]) => {
        for (const appt of rows) {
          if (!isActive(appt)) continue;
          const doc = doctorMap.get(text(appt.app_doc_id));
          if (!doc) continue;
          const date = dateOf(appt.app_date, appt.crt_date);
          const from = parseTime(appt.app_time_from);
          if (!date || !from) continue;
          const patientId = await resolver.resolve(em, text(appt.app_pat_id), resolveCity(appt), doc.branchId);
          const key = `${patientId}|${doc.doctorId}|${date}|${from}`;
          if (!keyToAppId.has(key)) keyToAppId.set(key, text(appt.app_id));
        }
      };
      await addKeys(oldDump.get('appointments') ?? []);
      await addKeys(newDump.get('appointments') ?? []);

      const usedAppIds = new Set(
        (
          (await em.query(
            `SELECT source_app_id FROM appointments WHERE source_app_id IS NOT NULL AND deleted_at IS NULL`,
          )) as { source_app_id: string }[]
        ).map((r) => r.source_app_id),
      );
      const unlabeled = (await em.query(
        `SELECT id, patient_id, doctor_id, to_char(date, 'YYYY-MM-DD') AS d, time_from::text AS t
           FROM appointments WHERE source_app_id IS NULL AND deleted_at IS NULL`,
      )) as { id: string; patient_id: string; doctor_id: string; d: string; t: string }[];
      for (const a of unlabeled) {
        const appId = keyToAppId.get(`${a.patient_id}|${a.doctor_id}|${a.d}|${a.t}`);
        if (!appId || usedAppIds.has(appId)) continue;
        await em.query(`UPDATE appointments SET source_app_id = $1 WHERE id = $2`, [appId, a.id]);
        usedAppIds.add(appId);
        summary.backfilled += 1;
      }

      const enteredBy = enteredByNames(newDump.get('wt_users') ?? []);
      const before = signatures(oldDump);
      const after = signatures(newDump);

      for (const appt of newDump.get('appointments') ?? []) {
        if (!isActive(appt)) continue;
        const doc = doctorMap.get(text(appt.app_doc_id));
        if (!doc) {
          summary.skipped.noDoctor += 1;
          continue;
        }
        const date = dateOf(appt.app_date, appt.crt_date);
        const from = parseTime(appt.app_time_from);
        if (!date || !from) continue;
        let to = parseTime(appt.app_time_to) ?? addMinutes(from, 15);
        if (to <= from) to = addMinutes(from, 15);
        const patientId = await resolver.resolve(em, text(appt.app_pat_id), resolveCity(appt), doc.branchId);
        const payList = (paymentsByAppt.get(text(appt.app_id)) ?? []).filter(
          (p) => isActive(p) && amount(p.app_pay_amount).gt(0),
        );
        const received = payList.reduce((sum, p) => sum.plus(amount(p.app_pay_amount)), amount('0'));
        const fee = received.gt(0) ? received : amount(appt.app_received_amount);
        const city = resolveCity(appt).slice(0, 100);

        const [existing] = (await em.query(
          `SELECT id FROM appointments WHERE source_app_id = $1 AND deleted_at IS NULL LIMIT 1`,
          [text(appt.app_id)],
        )) as { id: string }[];

        if (existing) {
          const appId = text(appt.app_id);
          if (before.get(appId) === after.get(appId)) {
            summary.unchanged += 1;
            continue;
          }
          await em.query(
            `UPDATE appointments SET patient_id = $1, patient_city = $2, date = $3, time_from = $4,
               time_to = $5, mode = $6, visit_type = $7, status = $8, fee = $9,
               remark = $10, issues = $11, updated_at = now() WHERE id = $12`,
            [
              patientId,
              city,
              date,
              from,
              to,
              modeOf(appt),
              visitOf(appt),
              statusOf(appt),
              money(fee),
              text(appt.app_remark) || null,
              text(appt.app_issues) || null,
              existing.id,
            ],
          );
          summary.updated += 1;
          continue;
        }

        const [created] = (await em.query(
          `INSERT INTO appointments (branch_id, patient_id, patient_city, doctor_id, date, time_from, time_to,
             mode, visit_type, issues, fee, remark, status, source_app_id, entered_by_name, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [
            doc.branchId,
            patientId,
            city,
            doc.doctorId,
            date,
            from,
            to,
            modeOf(appt),
            visitOf(appt),
            text(appt.app_issues) || null,
            money(fee),
            text(appt.app_remark) || null,
            statusOf(appt),
            text(appt.app_id),
            enteredBy(appt.entry_by),
            timestampOf(appt.crt_date) ?? `${date}T12:00:00+05:00`,
          ],
        )) as { id: string }[];
        summary.created += 1;
        for (const pay of payList) {
          const method = /online/i.test(text(pay.app_pay_status)) ? 'online' : 'cash';
          const paidOn = dateOf(pay.app_pay_date, pay.crt_date) ?? date;
          const code = text(posSheets.get(text(pay.app_pay_receiver_sheet_id))?.as_account_code).toLowerCase();
          const accountId = (code && accountByCode.get(code)) || null;
          if (!accountId) continue;
          await em.query(
            `INSERT INTO appointment_payments (branch_id, appointment_id, method, amount, date, account_sheet_id,
               sender_bank, sender_account_title, sender_account_no)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              doc.branchId,
              created!.id,
              method,
              money(amount(pay.app_pay_amount)),
              paidOn,
              accountId,
              method === 'online' ? text(pay.app_pay_sender_bank).slice(0, 150) || null : null,
              method === 'online' ? text(pay.app_pay_account_title).slice(0, 150) || null : null,
              method === 'online' ? text(pay.app_pay_account_no).slice(0, 100) || null : null,
            ],
          );
          summary.payments += 1;
        }
      }

      report(
        `back-filled ${summary.backfilled}, updated ${summary.updated}, unchanged ${summary.unchanged}, created ${summary.created}`,
      );
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return summary;
}
