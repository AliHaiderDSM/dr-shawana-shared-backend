import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { BUCKETS, putObject } from '../../lib/storage';
import type { DumpTables } from './dump-reader';
import { PatientResolver } from './patient-resolver';
import { cityBranchOf, dateOf, isActive, text, timestampOf } from './possoft-values';

export const POSSOFT_MEDICAL_TABLES = ['customers_med_record', 'customers'];

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export interface MedicalSummary {
  medicalRecords: number;
  recordsReused: number;
  filesUploaded: number;
  filesReused: number;
  patientsCreated: number;
  skipped: {
    filesMissing: number;
    filesWrongType: number;
  };
  missingSample: string[];
}

function deterministicId(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  hash[16] = ((parseInt(hash[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const extensionOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

export async function importPossoftMedical(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean; filesDir: string },
): Promise<MedicalSummary> {
  const em = source.manager;
  const summary: MedicalSummary = {
    medicalRecords: 0,
    recordsReused: 0,
    filesUploaded: 0,
    filesReused: 0,
    patientsCreated: 0,
    skipped: { filesMissing: 0, filesWrongType: 0 },
    missingSample: [],
  };

  const branchRows = (await em.query(`SELECT id, code, kind FROM branches WHERE deleted_at IS NULL`)) as {
    id: string;
    code: string;
    kind: string;
  }[];
  const branchByCode = new Map(branchRows.map((b) => [b.code, b.id]));
  const codeById = new Map(branchRows.map((b) => [b.id, b.code]));
  const defaultBranchId =
    branchByCode.get('LHR') ?? branchRows.find((b) => b.kind === 'branch')?.id ?? branchRows[0]?.id;
  if (!defaultBranchId) throw new Error('No branch exists. Run the sales import first.');

  const customers = new Map<string, Record<string, string | null>>();
  for (const c of dump.get('customers') ?? []) customers.set(text(c.cust_id), c);
  const patients = await PatientResolver.load(em, dump.get('customers') ?? []);

  for (const record of dump.get('customers_med_record') ?? []) {
    if (!isActive(record)) continue;
    const medId = text(record.med_record_id);
    const custId = text(record.med_record_cust_id);
    const city = text(customers.get(custId)?.cust_city) || 'Lahore';
    const branchId = branchByCode.get(cityBranchOf(city)?.code ?? '') ?? defaultBranchId;
    const branchCode = codeById.get(branchId) ?? 'LHR';
    const date = dateOf(record.med_record_date, record.crt_date) ?? new Date().toISOString().slice(0, 10);
    const recordId = deterministicId(`medrec:${medId}`);

    if (!options.dryRun) {
      const patientId = await patients.resolve(em, custId, city, branchId);
      const inserted = (await em.query(
        `INSERT INTO medical_records (id, branch_id, patient_id, type, date, status, note, uploaded_by_patient, created_at)
         VALUES ($1,$2,$3,'medical_record',$4,$5,$6,false,$7)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          recordId,
          branchId,
          patientId,
          date,
          text(record.med_record_status).slice(0, 50) || null,
          text(record.med_record_note) || null,
          timestampOf(record.crt_date) ?? `${date}T12:00:00+05:00`,
        ],
      )) as { id: string }[];
      if (inserted.length) summary.medicalRecords += 1;
      else summary.recordsReused += 1;
    } else {
      summary.medicalRecords += 1;
    }

    const names = text(record.med_record_screenshot).split(',');
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index]?.trim();
      if (!name) continue;
      const ext = extensionOf(name);
      const contentType = CONTENT_TYPES[ext];
      if (!contentType) {
        summary.skipped.filesWrongType += 1;
        continue;
      }
      const localPath = join(options.filesDir, name);
      if (!existsSync(localPath)) {
        summary.skipped.filesMissing += 1;
        if (summary.missingSample.length < 10) summary.missingSample.push(name);
        continue;
      }
      const fileId = deterministicId(`medfile:${medId}:${index}`);
      const objectPath = `${branchCode}/medical-records/${fileId}.${ext}`;
      if (options.dryRun) {
        summary.filesUploaded += 1;
        continue;
      }
      const buffer = await readFile(localPath);
      await putObject(BUCKETS.medicalRecords, objectPath, buffer, contentType);
      const inserted = (await em.query(
        `INSERT INTO medical_record_files (id, branch_id, medical_record_id, file_path, original_name, content_type, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [fileId, branchId, recordId, objectPath, name.slice(0, 255), contentType, statSync(localPath).size],
      )) as { id: string }[];
      if (inserted.length) summary.filesUploaded += 1;
      else summary.filesReused += 1;
    }
  }
  summary.patientsCreated = patients.created;
  return summary;
}
