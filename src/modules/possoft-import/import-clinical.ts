import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { hashPassword } from '../../lib/password';
import { CATALOG_SEED } from '../prescriptions/catalog-seed';
import type { DumpRow, DumpTables } from './dump-reader';
import { PatientResolver } from './patient-resolver';
import {
  amount,
  byId,
  cityBranchOf,
  dateOf,
  groupBy,
  insertMany,
  isActive,
  money,
  text,
  timestampOf,
} from './possoft-values';

export const POSSOFT_CLINICAL_TABLES = [
  'doctors',
  'appointments',
  'appointment_payments',
  'prescriptions',
  'customers',
  'banks',
  'accounts_sheet',
];

const NO_ACCOUNT_CHOSEN = 'posSoft: no account chosen';

export interface ClinicalSummary {
  doctorBranch: string;
  doctors: number;
  doctorsReused: number;
  patientsCreated: number;
  appointments: number;
  appointmentPayments: number;
  prescriptions: number;
  prescriptionItems: number;
  skipped: {
    appointmentsNoDoctor: number;
    appointmentsNoDate: number;
    prescriptionsNoDoctor: number;
    paymentsNoAppointment: number;
    paymentsNoAmount: number;
  };
}

class DryRunRollback extends Error {}

const catalogMeta = new Map(CATALOG_SEED.map((item, index) => [item.code, { ...item, sortOrder: index }]));

function usernameFrom(raw: string | null | undefined, name: string, taken: Set<string>): string {
  const base =
    text(raw)
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '') ||
    text(name)
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 20) ||
    'doctor';
  let candidate = base.slice(0, 44);
  let n = 1;
  while (taken.has(candidate)) candidate = `${base.slice(0, 40)}${(n += 1)}`;
  taken.add(candidate);
  return candidate;
}

function emailFrom(raw: string | null | undefined, username: string, taken: Set<string>): string {
  const value = text(raw).toLowerCase();
  let candidate = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : `${username}@imported.dsm`;
  let n = 1;
  while (taken.has(candidate)) candidate = `${username}+${(n += 1)}@imported.dsm`;
  taken.add(candidate);
  return candidate.slice(0, 150);
}

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

export async function importPossoftClinical(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean; password: string },
): Promise<ClinicalSummary> {
  const rows = (table: string) => dump.get(table) ?? [];
  const summary: ClinicalSummary = {
    doctorBranch: '',
    doctors: 0,
    doctorsReused: 0,
    patientsCreated: 0,
    appointments: 0,
    appointmentPayments: 0,
    prescriptions: 0,
    prescriptionItems: 0,
    skipped: {
      appointmentsNoDoctor: 0,
      appointmentsNoDate: 0,
      prescriptionsNoDoctor: 0,
      paymentsNoAppointment: 0,
      paymentsNoAmount: 0,
    },
  };

  const customers = byId(rows('customers'), 'cust_id');
  const posSheets = byId(rows('accounts_sheet'), 'as_id');
  const paymentsByAppt = groupBy(rows('appointment_payments'), 'appoint_id');

  try {
    await source.transaction(async (em) => {
      const [existing] = (await em.query(
        `SELECT (SELECT COUNT(*) FROM appointments) + (SELECT COUNT(*) FROM prescriptions) AS count`,
      )) as { count: string }[];
      if (Number(existing?.count ?? 0) > 0) {
        throw new Error(
          'Appointments or prescriptions already exist. The clinical import runs only on an empty clinic, so it is not added twice.',
        );
      }
      const branchRows = (await em.query(`SELECT id, code, kind FROM branches WHERE deleted_at IS NULL`)) as {
        id: string;
        code: string;
        kind: string;
      }[];
      const branchByCode = new Map(branchRows.map((b) => [b.code, b.id]));
      const doctorBranchId =
        branchByCode.get('LHR') ?? branchRows.find((b) => b.kind === 'branch')?.id ?? branchRows[0]?.id;
      if (!doctorBranchId) throw new Error('No branch exists. Run the sales import first.');
      summary.doctorBranch = branchRows.find((b) => b.id === doctorBranchId)?.code ?? '';
      const branchIdForCity = (city: string) =>
        branchByCode.get(cityBranchOf(city)?.code ?? '') ?? doctorBranchId;

      const existingUsernames = new Set(
        ((await em.query(`SELECT username FROM staff_profiles`)) as { username: string }[]).map(
          (r) => r.username,
        ),
      );
      const existingEmails = new Set(
        ((await em.query(`SELECT email FROM staff_profiles`)) as { email: string }[]).map((r) => r.email),
      );
      const passwordHash = await hashPassword(options.password);

      const doctorMap = new Map<string, string>();
      for (const doc of rows('doctors')) {
        const docId = text(doc.doc_id);
        const username = text(doc.doc_username)
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '');
        const [found] = username
          ? ((await em.query(
              `SELECT d.id FROM doctors d JOIN staff_profiles s ON s.id = d.staff_id
                WHERE s.username = $1 AND d.deleted_at IS NULL LIMIT 1`,
              [username],
            )) as { id: string }[])
          : [];
        if (found) {
          doctorMap.set(docId, found.id);
          summary.doctorsReused += 1;
          continue;
        }
        if (!isActive(doc)) continue;
        const staffId = randomUUID();
        const doctorRowId = randomUUID();
        const name = text(doc.doc_name) || `Doctor ${docId}`;
        const uname = usernameFrom(doc.doc_username, name, existingUsernames);
        const email = emailFrom(doc.doc_email, uname, existingEmails);
        const createdAt = timestampOf(doc.crt_date) ?? new Date().toISOString();
        const parts = name
          .replace(/^dr\.?\s*/i, '')
          .trim()
          .split(/\s+/);
        await em.query(
          `INSERT INTO staff_profiles (id, branch_id, role, first_name, last_name, email, username, phone, status, must_change_password, created_at)
           VALUES ($1,$2,'doctor',$3,$4,$5,$6,$7,'active',true,$8)`,
          [
            staffId,
            doctorBranchId,
            (parts[0] ?? 'Doctor').slice(0, 100),
            (parts.slice(1).join(' ') || 'Imported').slice(0, 100),
            email,
            uname,
            text(doc.doc_phone).slice(0, 30) || null,
            createdAt,
          ],
        );
        await em.query(
          `INSERT INTO staff_credentials (staff_id, password_hash, password_changed_at) VALUES ($1,$2,now())`,
          [staffId, passwordHash],
        );
        await em.query(
          `INSERT INTO doctors (id, branch_id, staff_id, display_name, phone, email, details, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
          [
            doctorRowId,
            doctorBranchId,
            staffId,
            name.slice(0, 150),
            text(doc.doc_phone).slice(0, 30) || null,
            /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(doc.doc_email)) ? text(doc.doc_email).slice(0, 150) : null,
            text(doc.doc_details) || null,
            createdAt,
          ],
        );
        doctorMap.set(docId, doctorRowId);
        summary.doctors += 1;
      }

      const patients = await PatientResolver.load(em, rows('customers'));

      const accountByCode = new Map(
        (
          (await em.query(
            `SELECT id, lower(account_code) AS code, lower(account_name) AS name FROM account_sheets WHERE deleted_at IS NULL`,
          )) as { id: string; code: string; name: string }[]
        ).map((r) => [r.code, r.id] as const),
      );
      const accountByName = new Map(
        (
          (await em.query(`SELECT id, lower(account_name) AS name FROM account_sheets`)) as {
            id: string;
            name: string;
          }[]
        ).map((r) => [r.name, r.id] as const),
      );
      let noAccountId = accountByName.get(NO_ACCOUNT_CHOSEN.toLowerCase());
      const ensureNoAccount = async () => {
        if (noAccountId) return noAccountId;
        const id = randomUUID();
        await em.query(
          `INSERT INTO account_sheets (id, branch_id, account_name, account_code, type, date, deleted_at)
           VALUES ($1,$2,$3,'-','cash',CURRENT_DATE, now())`,
          [id, doctorBranchId, NO_ACCOUNT_CHOSEN],
        );
        noAccountId = id;
        return id;
      };
      const accountFor = async (sheetId: string) => {
        const code = text(posSheets.get(sheetId)?.as_account_code).toLowerCase();
        return (code && accountByCode.get(code)) || (await ensureNoAccount());
      };

      const apptIds = new Map<string, string>();
      const apptRows: unknown[][] = [];
      const paymentRows: unknown[][] = [];
      for (const appt of rows('appointments')) {
        if (!isActive(appt)) continue;
        const apptId = text(appt.app_id);
        const doctorId = doctorMap.get(text(appt.app_doc_id));
        if (!doctorId) {
          summary.skipped.appointmentsNoDoctor += 1;
          continue;
        }
        const date = dateOf(appt.app_date, appt.crt_date);
        if (!date) {
          summary.skipped.appointmentsNoDate += 1;
          continue;
        }
        const customer = customers.get(text(appt.app_pat_id));
        const city = text(appt.app_pat_city) || text(customer?.cust_city) || 'Lahore';
        const branchId = branchIdForCity(city);
        const patientId = await patients.resolve(em, text(appt.app_pat_id), city, branchId);
        const id = randomUUID();
        const from = parseTime(appt.app_time_from) ?? '09:00:00';
        let to = parseTime(appt.app_time_to) ?? addMinutes(from, 15);
        if (to <= from) to = addMinutes(from, 15);
        const mode = /online/i.test(text(appt.app_on_phy_status)) ? 'online' : 'physical';
        const visit = /follow/i.test(text(appt.app_on_phy_followup)) ? 'followup' : 'new';
        const status =
          text(appt.app_status) === '1'
            ? 'completed'
            : text(appt.app_status) === '2'
              ? 'cancelled'
              : 'booked';
        const payList = (paymentsByAppt.get(apptId) ?? []).filter(
          (p) => isActive(p) && amount(p.app_pay_amount).gt(0),
        );
        const received = payList.reduce((sum, p) => sum.plus(amount(p.app_pay_amount)), amount('0'));
        const fee = received.gt(0) ? received : amount(appt.app_received_amount);
        const createdAt = timestampOf(appt.crt_date) ?? `${date}T12:00:00+05:00`;
        apptRows.push([
          id,
          branchId,
          patientId,
          city.slice(0, 100),
          doctorId,
          date,
          from,
          to,
          mode,
          visit,
          text(appt.app_issues) || null,
          money(fee),
          text(appt.app_remark) || null,
          status,
          createdAt,
        ]);
        apptIds.set(apptId, id);
        for (const pay of payList) {
          const method = /online/i.test(text(pay.app_pay_status)) ? 'online' : 'cash';
          const paidOn = dateOf(pay.app_pay_date, pay.crt_date) ?? date;
          paymentRows.push([
            randomUUID(),
            branchId,
            id,
            method,
            money(amount(pay.app_pay_amount)),
            paidOn,
            await accountFor(text(pay.app_pay_receiver_sheet_id)),
            method === 'online' ? text(pay.app_pay_sender_bank).slice(0, 150) || null : null,
            method === 'online' ? text(pay.app_pay_account_title).slice(0, 150) || null : null,
            method === 'online' ? text(pay.app_pay_account_no).slice(0, 100) || null : null,
            timestampOf(pay.crt_date) ?? createdAt,
          ]);
          summary.appointmentPayments += 1;
        }
      }
      for (const pay of rows('appointment_payments')) {
        if (!isActive(pay)) continue;
        if (amount(pay.app_pay_amount).lte(0)) summary.skipped.paymentsNoAmount += 1;
        else if (!apptIds.has(text(pay.appoint_id))) summary.skipped.paymentsNoAppointment += 1;
      }

      await insertMany(
        em,
        'appointments',
        [
          'id',
          'branch_id',
          'patient_id',
          'patient_city',
          'doctor_id',
          'date',
          'time_from',
          'time_to',
          'mode',
          'visit_type',
          'issues',
          'fee',
          'remark',
          'status',
          'created_at',
        ],
        apptRows,
      );
      await insertMany(
        em,
        'appointment_payments',
        [
          'id',
          'branch_id',
          'appointment_id',
          'method',
          'amount',
          'date',
          'account_sheet_id',
          'sender_bank',
          'sender_account_title',
          'sender_account_no',
          'created_at',
        ],
        paymentRows,
      );
      summary.appointments = apptRows.length;

      const catalogByBranchCode = new Map<string, string>();
      for (const row of (await em.query(
        `SELECT branch_id, code, id FROM prescription_items_catalog WHERE deleted_at IS NULL`,
      )) as { branch_id: string; code: string; id: string }[]) {
        catalogByBranchCode.set(`${row.branch_id}:${row.code}`, row.id);
      }

      const prescriptionRows: unknown[][] = [];
      const itemRows: unknown[][] = [];
      for (const pres of rows('prescriptions')) {
        if (!isActive(pres)) continue;
        const doctorId = doctorMap.get(text(pres.pres_doc_id));
        if (!doctorId) {
          summary.skipped.prescriptionsNoDoctor += 1;
          continue;
        }
        const date = dateOf(pres.pres_date, pres.crt_date) ?? new Date().toISOString().slice(0, 10);
        const customer = customers.get(text(pres.pres_cust_id));
        const city = text(customer?.cust_city) || 'Lahore';
        const branchId = branchIdForCity(city);
        const patientId = await patients.resolve(em, text(pres.pres_cust_id), city, branchId);
        const id = randomUUID();
        const notes = {
          blood: text(pres.pres_bloodNote) || null,
          imaging: text(pres.pres_imagingNote) || null,
          supplements: text(pres.pres_supplementsNote) || null,
          skinCare: text(pres.pres_skinCareNote) || null,
          hairCare: text(pres.pres_hairCareNote) || null,
        };
        prescriptionRows.push([
          id,
          branchId,
          patientId,
          doctorId,
          date,
          text(pres.pres_diaganosis) || '-',
          JSON.stringify(notes),
          text(pres.pres_plantreatment) || null,
          dateOf(pres.pres_followup_date),
          timestampOf(pres.crt_date) ?? `${date}T12:00:00+05:00`,
        ]);
        summary.prescriptions += 1;
        let sort = 0;
        for (const [code, meta] of catalogMeta) {
          if (text((pres as DumpRow)[code]) !== '1') continue;
          itemRows.push([
            randomUUID(),
            branchId,
            id,
            catalogByBranchCode.get(`${branchId}:${code}`) ?? null,
            meta.category,
            meta.groupName.slice(0, 150),
            meta.name.slice(0, 255),
            meta.defaultDose,
            (sort += 1),
          ]);
        }
      }
      await insertMany(
        em,
        'prescriptions',
        [
          'id',
          'branch_id',
          'patient_id',
          'doctor_id',
          'date',
          'diagnosis',
          'notes',
          'plan_treatment',
          'followup_date',
          'created_at',
        ],
        prescriptionRows,
      );
      await insertMany(
        em,
        'prescription_items',
        [
          'id',
          'branch_id',
          'prescription_id',
          'catalog_item_id',
          'category',
          'group_name',
          'name',
          'dose',
          'sort_order',
        ],
        itemRows,
      );
      summary.prescriptionItems = itemRows.length;
      summary.patientsCreated = patients.created;

      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return summary;
}
