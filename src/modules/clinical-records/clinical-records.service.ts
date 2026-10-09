import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { uploadMany, withUploads, type UploadedFile } from '../../lib/file-uploads';
import { withoutInternals } from '../../lib/http';
import { BUCKETS } from '../../lib/storage';
import { today } from '../../lib/validation';
import { appointments } from '../appointments/appointment-access';
import { auditService } from '../audit/audit.service';
import { Consultation } from '../consultations/consultation.entity';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { MedicalRecord, type MedicalRecordType } from '../medical-records/medical-record.entity';
import { type BhrtStatus, Patient } from '../patients/patient.entity';
import { patientsService } from '../patients/patients.service';
import { BhrtStatusLog, type BhrtLogStatus } from './bhrt-status-log.entity';
import { BLOOD_TESTS, BloodWorkResult } from './blood-work-result.entity';
import {
  BLOOD_TEST_UNITS,
  type AddBhrtInput,
  type AddBloodWorkInput,
  type CreateMedicalRecordInput,
  type UpdateBloodWorkInput,
  type UpdateMedicalRecordInput,
} from './clinical-records.schemas';

const bloodResults = branchScopedRepository(BloodWorkResult, 'bw');
const bhrtLog = branchScopedRepository(BhrtStatusLog, 'bhrt');
const records = branchScopedRepository(MedicalRecord, 'mr');
const recordFiles = branchScopedRepository(MedicalRecordFile, 'mrf');

const PATIENT_BHRT: Record<BhrtLogStatus, BhrtStatus> = {
  on: 'on',
  off: 'off',
  recommended: 'recommended',
  other: 'none',
};

const toBloodDto = (r: BloodWorkResult) => {
  const { patient: _p, consultation: _c, branch: _b, ...rest } = withoutInternals(r);
  return rest;
};
const toBhrtDto = (r: BhrtStatusLog) => {
  const { patient: _p, appointment: _a, branch: _b, ...rest } = withoutInternals(r);
  return rest;
};
const toFileDto = (f: MedicalRecordFile) => ({
  id: f.id,
  originalName: f.originalName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  createdAt: f.createdAt,
});
const toRecordDto = (r: MedicalRecord) => ({
  id: r.id,
  patientId: r.patientId,
  appointmentId: r.appointmentId,
  type: r.type,
  date: r.date,
  note: r.note,
  files: (r.files ?? []).map(toFileDto),
  createdBy: r.createdBy,
  createdAt: r.createdAt,
});

async function assertConsultation(branchId: string, patientId: string, id: string, manager: EntityManager) {
  const found = await repo(Consultation, manager).count({ where: { id, branchId, patientId } });
  if (found === 0)
    throw AppError.badRequest('The consultation was not found for this patient in this branch');
}

async function assertAppointment(branchId: string, patientId: string, id: string, manager: EntityManager) {
  const found = await appointments.count(branchId, { id, patientId }, manager);
  if (found === 0) throw AppError.badRequest('The appointment was not found for this patient in this branch');
}

async function getResult(branchId: string, patientId: string, id: string, manager?: EntityManager) {
  const result = await bloodResults.findOneBy(branchId, { id, patientId }, manager);
  if (!result) throw AppError.notFound('Blood work result');
  return result;
}

function recordQuery(branchId: string, manager?: EntityManager) {
  return records.query(branchId, manager).leftJoinAndSelect('mr.files', 'file');
}

async function getRecord(branchId: string, patientId: string, id: string, manager?: EntityManager) {
  const record = await recordQuery(branchId, manager)
    .andWhere('mr.id = :id', { id })
    .andWhere('mr.patientId = :patientId', { patientId })
    .getOne();
  if (!record) throw AppError.notFound('Medical record');
  return record;
}

async function saveFiles(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  medicalRecordId: string,
  files: UploadedFile[],
) {
  for (const file of files) {
    await recordFiles.create(
      branchId,
      actor.userId,
      {
        medicalRecordId,
        filePath: file.path,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      },
      manager,
    );
  }
}

export const uploadMedicalFiles = (branchId: string, files: Express.Multer.File[]) =>
  uploadMany(BUCKETS.medicalRecords, `${branchId}/medical-records`, files);

export const bloodWorkService = {
  async list(branchId: string, patientId: string) {
    await patientsService.require(patientId);
    const rows = await bloodResults
      .query(branchId)
      .andWhere('bw.patientId = :patientId', { patientId })
      .orderBy('bw.testDate', 'ASC')
      .addOrderBy('bw.createdAt', 'ASC')
      .getMany();
    const dates = [...new Set(rows.map((r) => r.testDate))].sort();
    const tests = BLOOD_TESTS.filter((test) => rows.some((r) => r.test === test)).map((test) => ({
      test,
      unit: rows.find((r) => r.test === test)?.unit ?? BLOOD_TEST_UNITS[test],
      points: [
        ...new Map(
          rows
            .filter((r) => r.test === test)
            .map((r) => [r.testDate, { id: r.id, date: r.testDate, value: r.value }] as const),
        ).values(),
      ],
    }));
    return { results: rows.map(toBloodDto), dates, tests };
  },

  async add(actor: Actor, branchId: string, patientId: string, input: AddBloodWorkInput) {
    return withTransaction(async (em) => {
      await patientsService.require(patientId, em);
      if (input.consultationId) await assertConsultation(branchId, patientId, input.consultationId, em);
      const created: BloodWorkResult[] = [];
      for (const result of input.results) {
        const existing = await bloodResults
          .query(branchId, em)
          .andWhere('bw.patientId = :patientId', { patientId })
          .andWhere('bw.test = :test', { test: result.test })
          .andWhere('bw.testDate = :testDate', { testDate: result.testDate })
          .orderBy('bw.createdAt', 'DESC')
          .getOne();
        if (existing) {
          Object.assign(existing, {
            value: result.value as never,
            unit: result.unit ?? existing.unit,
            updatedBy: actor.userId,
          });
          created.push(await bloodResults.save(existing, em));
          continue;
        }
        created.push(
          await bloodResults.create(
            branchId,
            actor.userId,
            {
              patientId,
              consultationId: input.consultationId ?? null,
              test: result.test,
              value: result.value as never,
              unit: result.unit ?? BLOOD_TEST_UNITS[result.test],
              testDate: result.testDate,
            },
            em,
          ),
        );
      }
      const dtos = created.map(toBloodDto);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'create',
          entity: 'blood_work',
          entityId: patientId,
          after: { results: dtos },
        },
        em,
      );
      return dtos;
    });
  },

  async update(actor: Actor, branchId: string, patientId: string, id: string, input: UpdateBloodWorkInput) {
    return withTransaction(async (em) => {
      const result = await getResult(branchId, patientId, id, em);
      const before = toBloodDto(result);
      Object.assign(result, input, { updatedBy: actor.userId });
      const after = toBloodDto(await bloodResults.save(result, em));
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'blood_work', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, patientId: string, id: string) {
    await withTransaction(async (em) => {
      const result = await getResult(branchId, patientId, id, em);
      await bloodResults.softDelete(result, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'blood_work', entityId: id, before: toBloodDto(result) },
        em,
      );
    });
  },
};

export const bhrtService = {
  async list(branchId: string, patientId: string) {
    await patientsService.require(patientId);
    const rows = await bhrtLog
      .query(branchId)
      .andWhere('bhrt.patientId = :patientId', { patientId })
      .orderBy('bhrt.date', 'DESC')
      .addOrderBy('bhrt.createdAt', 'DESC')
      .getMany();
    return rows.map(toBhrtDto);
  },

  async add(actor: Actor, branchId: string, patientId: string, input: AddBhrtInput) {
    return withTransaction(async (em) => {
      const patient = await patientsService.require(patientId, em);
      if (input.appointmentId) await assertAppointment(branchId, patientId, input.appointmentId, em);
      const entry = await bhrtLog.create(
        branchId,
        actor.userId,
        {
          patientId,
          appointmentId: input.appointmentId ?? null,
          date: input.date ?? today(),
          status: input.status,
          note: input.note ?? null,
        },
        em,
      );
      const latest = await repo(BhrtStatusLog, em).findOne({
        where: { patientId },
        order: { date: 'DESC', createdAt: 'DESC' },
      });
      const status = PATIENT_BHRT[latest?.status ?? input.status];
      if (patient.bhrtStatus !== status) {
        await repo(Patient, em).update({ id: patientId }, { bhrtStatus: status, updatedBy: actor.userId });
      }
      const dto = toBhrtDto(entry);
      await auditService.record(
        { actor, branchId, action: 'create', entity: 'bhrt_status', entityId: entry.id, after: dto },
        em,
      );
      return dto;
    });
  },
};

export const medicalRecordsService = {
  async list(branchId: string, patientId: string, type?: MedicalRecordType) {
    await patientsService.require(patientId);
    const qb = recordQuery(branchId).andWhere('mr.patientId = :patientId', { patientId });
    if (type) qb.andWhere('mr.type = :type', { type });
    const rows = await qb.orderBy('mr.date', 'DESC').addOrderBy('mr.createdAt', 'DESC').getMany();
    return rows.map(toRecordDto);
  },

  async insert(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    patientId: string,
    input: Partial<CreateMedicalRecordInput>,
    files: UploadedFile[],
  ) {
    const record = await records.create(
      branchId,
      actor.userId,
      {
        patientId,
        appointmentId: input.appointmentId ?? null,
        type: input.type ?? 'medical_record',
        date: input.date ?? today(),
        note: input.note ?? null,
      },
      manager,
    );
    await saveFiles(manager, actor, branchId, record.id, files);
    return record;
  },

  async create(
    actor: Actor,
    branchId: string,
    patientId: string,
    input: CreateMedicalRecordInput,
    files: Express.Multer.File[],
  ) {
    await patientsService.require(patientId);
    const uploaded = await uploadMedicalFiles(branchId, files);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        if (input.appointmentId) await assertAppointment(branchId, patientId, input.appointmentId, em);
        const record = await this.insert(em, actor, branchId, patientId, input, uploaded);
        const dto = toRecordDto(await getRecord(branchId, patientId, record.id, em));
        await auditService.record(
          { actor, branchId, action: 'create', entity: 'medical_record', entityId: record.id, after: dto },
          em,
        );
        return dto;
      }),
    );
  },

  async update(
    actor: Actor,
    branchId: string,
    patientId: string,
    id: string,
    input: UpdateMedicalRecordInput,
  ) {
    return withTransaction(async (em) => {
      const record = await getRecord(branchId, patientId, id, em);
      const before = toRecordDto(record);
      Object.assign(record, input, { updatedBy: actor.userId });
      delete record.files;
      await records.save(record, em);
      const after = toRecordDto(await getRecord(branchId, patientId, id, em));
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'medical_record', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, patientId: string, id: string) {
    await withTransaction(async (em) => {
      const record = await getRecord(branchId, patientId, id, em);
      for (const file of record.files ?? []) await recordFiles.softDelete(file, actor.userId, em);
      await records.softDelete(record, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'delete',
          entity: 'medical_record',
          entityId: id,
          before: toRecordDto(record),
        },
        em,
      );
    });
  },

  async addFiles(
    actor: Actor,
    branchId: string,
    patientId: string,
    id: string,
    files: Express.Multer.File[],
  ) {
    if (files.length === 0) throw AppError.badRequest('Attach at least one file');
    await getRecord(branchId, patientId, id);
    const uploaded = await uploadMedicalFiles(branchId, files);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        await saveFiles(em, actor, branchId, id, uploaded);
        return toRecordDto(await getRecord(branchId, patientId, id, em));
      }),
    );
  },

  async removeFile(actor: Actor, branchId: string, patientId: string, id: string, fileId: string) {
    await withTransaction(async (em) => {
      await getRecord(branchId, patientId, id, em);
      const file = await recordFiles.findOneBy(branchId, { id: fileId, medicalRecordId: id }, em);
      if (!file) throw AppError.notFound('Medical record file');
      await recordFiles.softDelete(file, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'remove_file',
          entity: 'medical_record',
          entityId: id,
          before: toFileDto(file),
        },
        em,
      );
    });
  },

  async timeline(branchId: string | null, patientId: string) {
    const qb = repo(MedicalRecord)
      .createQueryBuilder('mr')
      .leftJoinAndSelect('mr.files', 'file')
      .where('mr.patientId = :patientId', { patientId });
    if (branchId) qb.andWhere('mr.branchId = :branchId', { branchId });
    return (await qb.orderBy('mr.date', 'DESC').getMany()).map((r) => ({
      ...toRecordDto(r),
      branchId: r.branchId,
    }));
  },
};

export async function patientRecordsTimeline(branchId: string | null, patientId: string) {
  const where = branchId ? { patientId, branchId } : { patientId };
  const [blood, bhrt] = await Promise.all([
    repo(BloodWorkResult).find({ where, order: { testDate: 'DESC' } }),
    repo(BhrtStatusLog).find({ where, order: { date: 'DESC', createdAt: 'DESC' } }),
  ]);
  return {
    bloodWork: blood.map((r) => ({ ...toBloodDto(r), branchId: r.branchId })),
    bhrt: bhrt.map((r) => ({ ...toBhrtDto(r), branchId: r.branchId })),
  };
}
