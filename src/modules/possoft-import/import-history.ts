import type { DataSource, EntityManager } from 'typeorm';
import { type SectionKey } from '../consultations/consultation-section.entity';
import { basicInfoSchema, SECTION_SCHEMAS } from '../consultations/section-schemas';
import type { DumpTables } from './dump-reader';
import { mapHistorySections } from './history-mapper';
import { PatientResolver } from './patient-resolver';
import { byId, cityBranchOf, dateOf, deterministicId, isActive, text, timestampOf } from './possoft-values';

export const POSSOFT_HISTORY_TABLES = ['customers_history', 'appointments', 'customers'];

export interface HistorySummary {
  consultations: number;
  consultationsReused: number;
  sections: number;
  patientsCreated: number;
  statusAligned: number;
  skipped: {
    noAppointmentRow: number;
    appointmentNotMatched: number;
    sectionsInvalid: number;
  };
  sectionsByKey: Record<string, number>;
}

class DryRunRollback extends Error {}

function parseTime(value: string | null | undefined): string | null {
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text(value));
  if (!match) return null;
  return `${String(Math.min(23, Number(match[1]))).padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(meaningful);
  return true;
}

export async function importPossoftHistory(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean } = {},
): Promise<HistorySummary> {
  const rows = (table: string) => dump.get(table) ?? [];
  const customers = byId(rows('customers'), 'cust_id');
  const posAppts = byId(rows('appointments'), 'app_id');
  const summary: HistorySummary = {
    consultations: 0,
    consultationsReused: 0,
    sections: 0,
    patientsCreated: 0,
    statusAligned: 0,
    skipped: { noAppointmentRow: 0, appointmentNotMatched: 0, sectionsInvalid: 0 },
    sectionsByKey: {},
  };

  try {
    await source.transaction(async (em) => {
      const branchRows = (await em.query(`SELECT id, code, kind FROM branches WHERE deleted_at IS NULL`)) as {
        id: string;
        code: string;
        kind: string;
      }[];
      const branchByCode = new Map(branchRows.map((b) => [b.code, b.id]));
      const defaultBranchId =
        branchByCode.get('LHR') ?? branchRows.find((b) => b.kind === 'branch')?.id ?? branchRows[0]?.id;
      if (!defaultBranchId) throw new Error('No branch exists. Run the sales import first.');
      const patients = await PatientResolver.load(em, rows('customers'));

      const matchAppointment = async (patientId: string, date: string, timeFrom: string) => {
        const found = (await em.query(
          `SELECT id, doctor_id AS "doctorId", branch_id AS "branchId", status FROM appointments
            WHERE patient_id = $1 AND date = $2 AND time_from = $3 AND deleted_at IS NULL LIMIT 2`,
          [patientId, date, timeFrom],
        )) as { id: string; doctorId: string; branchId: string; status: string }[];
        return found.length === 1 ? found[0] : null;
      };

      const lastBasicByCust = new Map<string, Record<string, unknown>>();
      const ordered = rows('customers_history')
        .filter(isActive)
        .map((history) => ({ history, appt: posAppts.get(text(history.hist_appoint_id)) }))
        .sort((a, b) => {
          const da = a.appt ? (dateOf(a.appt.app_date, a.appt.crt_date) ?? '') : '';
          const db = b.appt ? (dateOf(b.appt.app_date, b.appt.crt_date) ?? '') : '';
          if (da !== db) return da < db ? -1 : 1;
          return Number(text(a.history.hist_id)) - Number(text(b.history.hist_id));
        });

      for (const { history, appt } of ordered) {
        if (!appt) {
          summary.skipped.noAppointmentRow += 1;
          continue;
        }
        const custId = text(appt.app_pat_id) || text(history.hist_cust_id);
        const city = text(customers.get(custId)?.cust_city) || 'Lahore';
        const branchId = branchByCode.get(cityBranchOf(city)?.code ?? '') ?? defaultBranchId;
        const patientId = await patients.resolve(em, custId, city, branchId);
        const date = dateOf(appt.app_date, appt.crt_date);
        const timeFrom = parseTime(appt.app_time_from);
        if (!date || !timeFrom) {
          summary.skipped.appointmentNotMatched += 1;
          continue;
        }
        const matched = await matchAppointment(patientId, date, timeFrom);
        if (!matched) {
          summary.skipped.appointmentNotMatched += 1;
          continue;
        }

        const customer = customers.get(custId);
        const mapped = mapHistorySections(history, {
          name: text(customer?.cust_name) || 'Patient',
          age: Number(text(customer?.cust_age).replace(/\D/g, '')) || null,
          city,
          country: text(customer?.cust_country) || null,
        });

        const basicInfo = mapped.sections.basic_info;
        let resolvedBasic: Record<string, unknown> | null = null;
        if (basicInfo) {
          const parsed = basicInfoSchema.safeParse(basicInfo);
          if (parsed.success) {
            resolvedBasic = parsed.data as Record<string, unknown>;
            lastBasicByCust.set(custId, resolvedBasic);
          }
        }
        mapped.sections.basic_info = resolvedBasic ?? lastBasicByCust.get(custId) ?? null;

        const remark = text(appt.app_remark);
        const assessment = mapped.sections.clinical_assessment as Record<string, unknown> | null;
        if (remark && assessment && !text(assessment.plan as string)) assessment.plan = remark;

        const consultationId = deterministicId(`consult:${matched.id}`);
        const consultationStatus = matched.status === 'completed' ? 'completed' : 'open';
        const createdAt = timestampOf(history.crt_date) ?? `${date}T12:00:00+05:00`;
        const inserted = (await em.query(
          `INSERT INTO consultations (id, branch_id, patient_id, doctor_id, appointment_id, status, discuss_topics, major_complaint, current_medications, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (appointment_id) WHERE deleted_at IS NULL DO NOTHING RETURNING id`,
          [
            consultationId,
            matched.branchId,
            patientId,
            matched.doctorId,
            matched.id,
            consultationStatus,
            mapped.discussTopics,
            mapped.majorComplaint,
            mapped.currentMedications,
            createdAt,
          ],
        )) as { id: string }[];
        let existingId = inserted[0]?.id;
        if (existingId) summary.consultations += 1;
        else {
          summary.consultationsReused += 1;
          const [existing] = (await em.query(
            `SELECT id FROM consultations WHERE appointment_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [matched.id],
          )) as { id: string }[];
          existingId = existing?.id;
        }
        if (!existingId) continue;

        await insertSections(em, summary, existingId, matched.branchId, mapped.sections);
      }

      const aligned = (await em.query(
        `UPDATE consultations c SET status = 'open', updated_at = now()
           FROM appointments a
          WHERE c.appointment_id = a.id AND c.deleted_at IS NULL
            AND c.status = 'completed' AND a.status <> 'completed'
        RETURNING c.id`,
      )) as { id: string }[];
      summary.statusAligned = aligned.length;

      summary.patientsCreated = patients.created;
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return summary;
}

async function insertSections(
  em: EntityManager,
  summary: HistorySummary,
  consultationId: string,
  branchId: string,
  sections: Record<string, unknown>,
) {
  for (const [key, raw] of Object.entries(sections)) {
    if (raw === null || !meaningful(raw)) continue;
    const schema = SECTION_SCHEMAS[key as SectionKey];
    const result = schema.safeParse(raw);
    if (!result.success) {
      summary.skipped.sectionsInvalid += 1;
      continue;
    }
    const id = deterministicId(`section:${consultationId}:${key}`);
    const done = (await em.query(
      `INSERT INTO consultation_sections (id, branch_id, consultation_id, section_key, data)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (consultation_id, section_key) WHERE deleted_at IS NULL
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING id`,
      [id, branchId, consultationId, key, JSON.stringify(result.data)],
    )) as { id: string }[];
    if (done.length) {
      summary.sections += 1;
      summary.sectionsByKey[key] = (summary.sectionsByKey[key] ?? 0) + 1;
    }
  }
}
