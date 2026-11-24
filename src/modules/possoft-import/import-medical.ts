import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { BUCKETS, putObject } from '../../lib/storage';
import type { DumpTables } from './dump-reader';
import { PatientResolver } from './patient-resolver';
import { cityBranchOf, dateOf, deterministicId, isActive, text, timestampOf } from './possoft-values';

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
  missingFiles: string[];
}

const extensionOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

interface FileTask {
  fileId: string;
  branchId: string;
  recordId: string;
  localPath: string;
  objectPath: string;
  name: string;
  contentType: string;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function importPossoftMedical(
  source: DataSource,
  dump: DumpTables,
  options: {
    dryRun?: boolean;
    filesDir: string;
    concurrency?: number;
    onProgress?: (message: string) => void;
  },
): Promise<MedicalSummary> {
  const em = source.manager;
  const report = options.onProgress ?? (() => {});
  const summary: MedicalSummary = {
    medicalRecords: 0,
    recordsReused: 0,
    filesUploaded: 0,
    filesReused: 0,
    patientsCreated: 0,
    skipped: { filesMissing: 0, filesWrongType: 0 },
    missingSample: [],
    missingFiles: [],
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

  const existingFileIds = new Set(
    options.dryRun
      ? []
      : ((await em.query(`SELECT id FROM medical_record_files`)) as { id: string }[]).map((r) => r.id),
  );

  const filesByLower = new Map<string, string>();
  try {
    for (const entry of readdirSync(options.filesDir)) filesByLower.set(entry.toLowerCase(), entry);
  } catch {
    // files directory missing; every file is then reported missing
  }

  const records = (dump.get('customers_med_record') ?? []).filter(isActive);
  const tasks: FileTask[] = [];
  let processed = 0;
  for (const record of records) {
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
      const actualName = filesByLower.get(name.toLowerCase());
      if (!actualName) {
        summary.skipped.filesMissing += 1;
        summary.missingFiles.push(name);
        if (summary.missingSample.length < 10) summary.missingSample.push(name);
        continue;
      }
      const localPath = join(options.filesDir, actualName);
      const fileId = deterministicId(`medfile:${medId}:${index}`);
      if (existingFileIds.has(fileId)) {
        summary.filesReused += 1;
        continue;
      }
      tasks.push({
        fileId,
        branchId,
        recordId,
        localPath,
        objectPath: `${branchCode}/medical-records/${fileId}.${ext}`,
        name,
        contentType,
      });
    }
    processed += 1;
    if (processed % 300 === 0) report(`records ${processed}/${records.length}`);
  }
  summary.patientsCreated = patients.created;

  report(`uploading ${tasks.length} files…`);
  if (options.dryRun) {
    summary.filesUploaded = tasks.length;
    return summary;
  }

  let done = 0;
  await runPool(tasks, options.concurrency ?? 8, async (task) => {
    const buffer = await readFile(task.localPath);
    await putObject(BUCKETS.medicalRecords, task.objectPath, buffer, task.contentType);
    await em.query(
      `INSERT INTO medical_record_files (id, branch_id, medical_record_id, file_path, original_name, content_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [
        task.fileId,
        task.branchId,
        task.recordId,
        task.objectPath,
        task.name.slice(0, 255),
        task.contentType,
        buffer.length,
      ],
    );
    summary.filesUploaded += 1;
    done += 1;
    if (done % 200 === 0) report(`files ${done}/${tasks.length}`);
  });
  report(`files ${done}/${tasks.length}`);
  return summary;
}
