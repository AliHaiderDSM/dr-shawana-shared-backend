import { repo } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { MedicalRecord } from '../medical-records/medical-record.entity';
import { bloodWorkService, medicalRecordsService } from './clinical-records.service';
import { labReportSummariesService } from './lab-report-summaries.service';
import { readBloodReport } from './report-reader';

const SCANNABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_SCAN_FILES = 5;
const MAX_SCAN_BYTES = 15 * 1024 * 1024;

export interface RecordScan {
  scanned: boolean;
  reason: string | null;
  saved: number;
  dates: string[];
  summaryId: string | null;
}

const skipped = (reason: string): RecordScan => ({
  scanned: false,
  reason,
  saved: 0,
  dates: [],
  summaryId: null,
});

async function findRecord(recordId: string, patientId: string, branchId: string | null) {
  const record = await repo(MedicalRecord).findOneBy({
    id: recordId,
    patientId,
    ...(branchId ? { branchId } : {}),
  });
  if (!record) throw AppError.notFound('Medical record');
  return record;
}

async function scannableFiles(record: MedicalRecord, fileIds: string[] | undefined) {
  const files = await repo(MedicalRecordFile).find({
    where: { medicalRecordId: record.id },
    order: { createdAt: 'ASC' },
  });
  return files
    .filter((f) => !fileIds?.length || fileIds.includes(f.id))
    .filter((f) => SCANNABLE_TYPES.includes(f.contentType))
    .slice(0, MAX_SCAN_FILES);
}

export const recordScanService = {
  async scan(
    actor: Actor | null,
    patientId: string,
    recordId: string,
    options: { branchId?: string | null; fileIds?: string[] } = {},
  ): Promise<RecordScan> {
    const record = await findRecord(recordId, patientId, options.branchId ?? null);
    if (record.type !== 'medical_record') return skipped('Imaging is kept as a file and is not read by AI.');
    const files = await scannableFiles(record, options.fileIds);
    if (files.length === 0) return skipped('No PDF or photo to read in this record.');
    if (files.reduce((sum, f) => sum + f.sizeBytes, 0) > MAX_SCAN_BYTES)
      return skipped('These files are too large to read together.');

    const branchId = record.branchId;
    const saved = await medicalRecordsService.filesForReading(
      branchId,
      patientId,
      files.map((f) => f.id),
    );
    const read = await readBloodReport(saved.map((s) => s.file));
    const summary = await labReportSummariesService.save(
      actor,
      branchId,
      patientId,
      saved.map((s) => s.ref),
      read,
    );

    const byDate = new Map<string, typeof read.results>();
    for (const result of read.results) {
      const date = result.testDate ?? record.date;
      byDate.set(date, [...(byDate.get(date) ?? []), { ...result, testDate: date }]);
    }
    for (const [testDate, results] of byDate) {
      await bloodWorkService.add(actor, branchId, patientId, {
        consultationId: null,
        results: results.map((r) => ({ test: r.test, value: r.value, unit: r.unit, testDate })),
      });
    }
    return {
      scanned: true,
      reason: read.results.length
        ? null
        : 'No FSH, estradiol, testosterone, DHEA-S, vitamin D, TSH, ferritin or B12 value was found.',
      saved: read.results.length,
      dates: [...byDate.keys()].sort(),
      summaryId: summary?.id ?? null,
    };
  },
};
