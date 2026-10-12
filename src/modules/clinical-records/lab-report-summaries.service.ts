import { AppDataSource } from '../../database/data-source';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { auditService } from '../audit/audit.service';
import { patientsService } from '../patients/patients.service';
import { LabReportSummary } from './lab-report-summary.entity';
import { type ReadReport } from './report-reader';

const summaries = branchScopedRepository(LabReportSummary, 'ls');

async function toDtos(rows: LabReportSummary[]) {
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => Boolean(id)))];
  const people = ids.length
    ? ((await AppDataSource.query(
        `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM staff_profiles WHERE id = ANY($1::uuid[])`,
        [ids],
      )) as { id: string; name: string }[])
    : [];
  return rows.map((r) => ({
    id: r.id,
    testDate: r.testDate,
    fileName: r.fileName,
    valuesFound: r.valuesFound,
    summary: r.summary,
    model: r.model,
    createdAt: r.createdAt.toISOString(),
    createdBy: people.find((p) => p.id === r.createdBy)?.name ?? null,
  }));
}

export const labReportSummariesService = {
  async save(actor: Actor, branchId: string, patientId: string, fileName: string | null, read: ReadReport) {
    if (!read.summary) return null;
    const saved = await summaries.create(branchId, actor.userId, {
      patientId,
      testDate: read.testDate,
      fileName: fileName ? fileName.slice(0, 255) : null,
      valuesFound: read.results.length,
      summary: read.summary,
      model: read.model.slice(0, 80),
    });
    await auditService.record({
      actor,
      branchId,
      action: 'create',
      entity: 'lab_report_summary',
      entityId: saved.id,
      after: { patientId, testDate: read.testDate, fileName },
    });
    return (await toDtos([saved]))[0]!;
  },

  async list(branchId: string, patientId: string) {
    await patientsService.require(patientId);
    const rows = await summaries
      .query(branchId)
      .andWhere('ls.patientId = :patientId', { patientId })
      .orderBy('ls.createdAt', 'DESC')
      .take(50)
      .getMany();
    return toDtos(rows);
  },

  async remove(actor: Actor, branchId: string, patientId: string, id: string) {
    const row = await summaries
      .query(branchId)
      .andWhere('ls.id = :id AND ls.patientId = :patientId', { id, patientId })
      .getOne();
    if (!row) throw AppError.notFound('Report summary');
    await summaries.softDelete(row, actor.userId);
    await auditService.record({
      actor,
      branchId,
      action: 'delete',
      entity: 'lab_report_summary',
      entityId: id,
      before: { patientId, testDate: row.testDate },
    });
  },
};
