import type { DataSource } from 'typeorm';
import type { DumpTables } from './dump-reader';
import { PatientResolver } from './patient-resolver';
import {
  amount,
  byId,
  cityBranchOf,
  dateOf,
  deterministicId,
  isActive,
  text,
  timestampOf,
} from './possoft-values';

export const POSSOFT_EXTRA_TABLES = ['customers_blood_work', 'customers_bhrt_details', 'customers'];

const BLOOD_TESTS: { field: string; test: string; unit: string }[] = [
  { field: 'FSH', test: 'fsh', unit: 'mIU/mL' },
  { field: 'Estradiol', test: 'estradiol', unit: 'pg/mL' },
  { field: 'TestosteroneFree', test: 'testosterone_free', unit: 'pg/mL' },
  { field: 'TestosteroneTotal', test: 'testosterone_total', unit: 'ng/dL' },
  { field: 'DHEASulphate', test: 'dhea_s', unit: 'ug/dL' },
  { field: 'VitD3', test: 'vit_d3', unit: 'ng/mL' },
  { field: 'TSH', test: 'tsh', unit: 'uIU/mL' },
  { field: 'Ferritin', test: 'ferritin', unit: 'ng/mL' },
  { field: 'B12', test: 'b12', unit: 'pg/mL' },
];

function bhrtStatus(value: string): string {
  const v = value.toLowerCase();
  if (v.includes('recommend')) return 'recommended';
  if (v.includes('off')) return 'off';
  if (v.includes('on')) return 'on';
  return 'other';
}

export interface ExtraSummary {
  bloodWorkResults: number;
  bloodWorkReused: number;
  bhrtLogs: number;
  bhrtReused: number;
  patientsCreated: number;
  skipped: { bloodWorkNoValue: number; bloodWorkNoDate: number };
}

class DryRunRollback extends Error {}

export async function importPossoftClinicalExtras(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean } = {},
): Promise<ExtraSummary> {
  const rows = (table: string) => dump.get(table) ?? [];
  const customers = byId(rows('customers'), 'cust_id');
  const summary: ExtraSummary = {
    bloodWorkResults: 0,
    bloodWorkReused: 0,
    bhrtLogs: 0,
    bhrtReused: 0,
    patientsCreated: 0,
    skipped: { bloodWorkNoValue: 0, bloodWorkNoDate: 0 },
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
      const branchOf = (custId: string) => {
        const city = text(customers.get(custId)?.cust_city) || 'Lahore';
        return branchByCode.get(cityBranchOf(city)?.code ?? '') ?? defaultBranchId;
      };
      const patients = await PatientResolver.load(em, rows('customers'));

      for (const row of rows('customers_blood_work')) {
        if (!isActive(row)) continue;
        const custId = text(row.cbw_cust_id);
        const branchId = branchOf(custId);
        const patientId = await patients.resolve(em, custId, 'Lahore', branchId);
        const rowDate =
          BLOOD_TESTS.map(({ field }) => dateOf(row[`cbw_bloodDate${field}`])).find(Boolean) ?? null;
        for (const { field, test, unit } of BLOOD_TESTS) {
          const raw = text(row[`cbw_bloodNumb${field}`]);
          if (!raw) continue;
          const value = raw.replace(/[^0-9.]/g, '');
          if (!value || Number.isNaN(Number(value))) {
            summary.skipped.bloodWorkNoValue += 1;
            continue;
          }
          const testDate = dateOf(row[`cbw_bloodDate${field}`]) ?? rowDate;
          if (!testDate) {
            summary.skipped.bloodWorkNoDate += 1;
            continue;
          }
          const id = deterministicId(`bloodwork:${text(row.cbw_id)}:${test}`);
          const inserted = (await em.query(
            `INSERT INTO blood_work_results (id, branch_id, patient_id, test, value, unit, test_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
            [id, branchId, patientId, test, amount(value).toFixed(3), unit, testDate],
          )) as { id: string }[];
          if (inserted.length) summary.bloodWorkResults += 1;
          else summary.bloodWorkReused += 1;
        }
      }

      for (const row of rows('customers_bhrt_details')) {
        if (!isActive(row)) continue;
        const custId = text(row.bhrt_cust_id);
        const branchId = branchOf(custId);
        const patientId = await patients.resolve(em, custId, 'Lahore', branchId);
        const date = dateOf(row.bhrt_date, row.crt_date) ?? new Date().toISOString().slice(0, 10);
        const id = deterministicId(`bhrt:${text(row.bhrt_id)}`);
        const inserted = (await em.query(
          `INSERT INTO bhrt_status_log (id, branch_id, patient_id, date, status, note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [
            id,
            branchId,
            patientId,
            date,
            bhrtStatus(text(row.bhrt_status)),
            text(row.bhrt_note) || null,
            timestampOf(row.crt_date) ?? `${date}T12:00:00+05:00`,
          ],
        )) as { id: string }[];
        if (inserted.length) summary.bhrtLogs += 1;
        else summary.bhrtReused += 1;
      }

      summary.patientsCreated = patients.created;
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return summary;
}
