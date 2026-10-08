import { AppDataSource } from '../../database/data-source';
import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { uploadMany, withUploads, type UploadedFile } from '../../lib/file-uploads';
import { withoutInternals } from '../../lib/http';
import { applyListQuery, escapeLike, pageMeta } from '../../lib/pagination';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { auditService } from '../audit/audit.service';
import { medicalRecordsService, uploadMedicalFiles } from '../clinical-records/clinical-records.service';
import { doctorsService, type Viewer } from '../doctors/doctors.service';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { MedicalRecord } from '../medical-records/medical-record.entity';
import { patientsService } from '../patients/patients.service';
import { AppointmentAttachment } from './appointment-attachment.entity';
import { appointments, appointmentsWithParties, getAppointmentRecord } from './appointment-access';
import {
  appointmentPaymentsService,
  assertProofIndexes,
  insertPayments,
  paymentsFor,
  paymentTotals,
  toPaymentDto,
  uploadProofs,
} from './appointment-payments.service';
import { type Appointment } from './appointment.entity';
import { type AppointmentPayment } from './appointment-payment.entity';
import {
  type AppointmentListQuery,
  type AppointmentStatusInput,
  type CalendarQuery,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
} from './appointments.schemas';

export interface AppointmentFiles {
  medicalRecordFiles?: Express.Multer.File[];
  paymentProofs?: Express.Multer.File[];
}

const attachments = branchScopedRepository(AppointmentAttachment, 'att');
const medicalRecords = branchScopedRepository(MedicalRecord, 'mr');
const medicalFiles = branchScopedRepository(MedicalRecordFile, 'mrf');

const toFileDto = (f: AppointmentAttachment | MedicalRecordFile) => ({
  id: f.id,
  originalName: f.originalName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  createdAt: f.createdAt,
});

function toAppointmentDto(a: Appointment, paid: AppointmentPayment[] = []) {
  const { patient, doctor, payments: _payments, ...rest } = withoutInternals(a);
  return {
    ...rest,
    patient: patient
      ? {
          id: patient.id,
          name: patient.name,
          phone: patient.phone,
          city: patient.city,
          bhrtStatus: patient.bhrtStatus,
        }
      : null,
    doctor: doctor ? { id: doctor.id, name: doctor.displayName } : null,
    ...paymentTotals(paid),
  };
}

async function loadDetail(viewer: Viewer, id: string, manager?: EntityManager) {
  const record = await appointmentsWithParties(viewer, manager).andWhere('a.id = :id', { id }).getOne();
  if (!record) throw AppError.notFound('Appointment');
  const paid = (await paymentsFor(viewer.branchId, [id], manager)).get(id) ?? [];
  const files = await attachments
    .query(viewer.branchId, manager)
    .andWhere('att.appointmentId = :id', { id })
    .orderBy('att.createdAt', 'ASC')
    .getMany();
  const records = await medicalRecords
    .query(viewer.branchId, manager)
    .leftJoinAndSelect('mr.files', 'file')
    .andWhere('mr.appointmentId = :id', { id })
    .orderBy('mr.createdAt', 'ASC')
    .getMany();
  return {
    ...toAppointmentDto(record, paid),
    payments: paid.map(toPaymentDto),
    attachments: files.map(toFileDto),
    medicalRecords: records.map((r) => ({
      id: r.id,
      date: r.date,
      note: r.note,
      files: (r.files ?? []).map(toFileDto),
    })),
  };
}

async function assertNoOverlap(
  manager: EntityManager,
  branchId: string,
  slot: { doctorId: string; date: string; timeFrom: string; timeTo: string },
  excludeId?: string,
) {
  const qb = appointments
    .query(branchId, manager)
    .andWhere('a.doctorId = :doctorId', { doctorId: slot.doctorId })
    .andWhere('a.date = :date', { date: slot.date })
    .andWhere('a.timeFrom < :timeTo', { timeTo: slot.timeTo })
    .andWhere('a.timeTo > :timeFrom', { timeFrom: slot.timeFrom })
    .orderBy('a.timeFrom', 'ASC');
  if (excludeId) qb.andWhere('a.id <> :excludeId', { excludeId });
  const clashes = await qb.getMany();
  if (clashes.length > 0) {
    throw AppError.conflict('This time is already booked for the doctor', {
      conflicts: clashes.map((c) => ({
        appointmentId: c.id,
        appointmentNo: c.appointmentNo,
        timeFrom: c.timeFrom,
        timeTo: c.timeTo,
        status: c.status,
      })),
    });
  }
}

function assertOwnDoctor(viewer: Viewer, doctorId: string) {
  if (viewer.doctorId && viewer.doctorId !== doctorId) {
    throw AppError.forbidden('Doctors can only book their own appointments');
  }
}

async function saveAttachments(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  appointmentId: string,
  files: UploadedFile[],
) {
  for (const file of files) {
    await attachments.create(
      branchId,
      actor.userId,
      {
        appointmentId,
        filePath: file.path,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      },
      manager,
    );
  }
}

export const appointmentsService = {
  async list(viewer: Viewer, query: AppointmentListQuery) {
    const qb = appointmentsWithParties(viewer);
    if (query.doctorId) qb.andWhere('a.doctorId = :doctorId', { doctorId: query.doctorId });
    if (query.patientId) qb.andWhere('a.patientId = :patientId', { patientId: query.patientId });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.mode) qb.andWhere('a.mode = :mode', { mode: query.mode });
    if (query.visitType) qb.andWhere('a.visitType = :visitType', { visitType: query.visitType });
    if (query.createdBy) qb.andWhere('a.createdBy = :createdBy', { createdBy: query.createdBy });
    if (query.bhrtStatus) qb.andWhere('patient.bhrtStatus = :bhrt', { bhrt: query.bhrtStatus });
    if (query.from) qb.andWhere('a.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('a.date <= :to', { to: query.to });
    if (query.createdOn) qb.andWhere('a.createdAt::date = :createdOn', { createdOn: query.createdOn });
    if (query.search) {
      qb.andWhere(
        `(patient.name ILIKE :term OR patient.phone ILIKE :term OR CONCAT('APP#', a.appointmentNo) ILIKE :term)`,
        { term: `%${escapeLike(query.search)}%` },
      );
    }
    applyListQuery(
      qb,
      { ...query, search: undefined },
      { sortMap: { date: 'a.date', createdAt: 'a.createdAt', appointmentNo: 'a.appointmentNo' } },
    );
    if (query.sort.endsWith('date')) qb.addOrderBy('a.timeFrom', query.sort.startsWith('-') ? 'DESC' : 'ASC');
    const [items, total] = await qb.getManyAndCount();
    const meta = pageMeta(query, total);
    const paid = await paymentsFor(
      viewer.branchId,
      items.map((i) => i.id),
    );
    const creatorIds = [...new Set(items.flatMap((i) => (i.createdBy ? [i.createdBy] : [])))];
    const creators: { id: string; name: string }[] = creatorIds.length
      ? await AppDataSource.query(
          `SELECT id, trim(first_name || ' ' || last_name) AS name FROM staff_profiles WHERE id = ANY($1)`,
          [creatorIds],
        )
      : [];
    const creatorName = new Map(creators.map((c) => [c.id, c.name]));
    return {
      items: items.map((i) => ({
        ...toAppointmentDto(i, paid.get(i.id)),
        createdByName: i.createdBy ? (creatorName.get(i.createdBy) ?? null) : null,
      })),
      meta,
    };
  },

  async calendar(viewer: Viewer, query: CalendarQuery) {
    const qb = appointmentsWithParties(viewer)
      .andWhere('a.date BETWEEN :from AND :to', { from: query.from, to: query.to })
      .orderBy('a.date', 'ASC')
      .addOrderBy('a.timeFrom', 'ASC');
    if (query.doctorId) qb.andWhere('a.doctorId = :doctorId', { doctorId: query.doctorId });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    const rows = await qb.getMany();
    return rows.map((a) => ({
      id: a.id,
      appointmentNo: a.appointmentNo,
      date: a.date,
      timeFrom: a.timeFrom,
      timeTo: a.timeTo,
      status: a.status,
      mode: a.mode,
      visitType: a.visitType,
      patient: { id: a.patientId, name: a.patient?.name ?? '' },
      doctor: { id: a.doctorId, name: a.doctor?.displayName ?? '' },
    }));
  },

  get: (viewer: Viewer, id: string) => loadDetail(viewer, id),

  async create(actor: Actor, viewer: Viewer, input: CreateAppointmentInput, files: AppointmentFiles = {}) {
    assertOwnDoctor(viewer, input.doctorId);
    const proofs = files.paymentProofs ?? [];
    const medical = files.medicalRecordFiles ?? [];
    assertProofIndexes(input.payments, proofs.length);
    const branchId = viewer.branchId;

    const proofUploads = await uploadProofs(branchId, proofs);
    const medicalUploads = await withUploads(proofUploads, () => uploadMedicalFiles(branchId, medical));
    const uploaded = [...proofUploads, ...medicalUploads];

    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        await doctorsService.lockBookable(branchId, input.doctorId, em);
        const patient = input.patient
          ? await patientsService.createRecord(actor, branchId, input.patient, em)
          : await patientsService.require(input.patientId as string, em);
        const slot = {
          doctorId: input.doctorId,
          date: input.date,
          timeFrom: input.timeFrom,
          timeTo: input.timeTo,
        };
        await assertNoOverlap(em, branchId, slot);

        const appointment = await appointments.create(
          branchId,
          actor.userId,
          {
            ...slot,
            patientId: patient.id,
            patientCity: patient.city,
            mode: input.mode,
            visitType: input.visitType,
            issues: input.issues ?? null,
            status: 'booked',
            source: 'dashboard',
          },
          em,
        );
        if (input.medicalRecord || medicalUploads.length > 0) {
          await medicalRecordsService.insert(
            em,
            actor,
            branchId,
            patient.id,
            { ...input.medicalRecord, appointmentId: appointment.id },
            medicalUploads,
          );
        }
        await insertPayments(em, actor, branchId, appointment.id, input.payments, proofUploads);

        const detail = await loadDetail(viewer, appointment.id, em);
        await auditService.record(
          {
            actor,
            branchId,
            action: 'create',
            entity: 'appointment',
            entityId: appointment.id,
            after: detail,
          },
          em,
        );
        return detail;
      }),
    );
  },

  async update(actor: Actor, viewer: Viewer, id: string, input: UpdateAppointmentInput) {
    return withTransaction(async (em) => {
      const current = await getAppointmentRecord(viewer, id, em);
      const doctorId = input.doctorId ?? current.doctorId;
      assertOwnDoctor(viewer, doctorId);
      await doctorsService.lockBookable(viewer.branchId, doctorId, em);
      const before = await loadDetail(viewer, id, em);

      const slot = {
        doctorId,
        date: input.date ?? current.date,
        timeFrom: input.timeFrom ?? current.timeFrom,
        timeTo: input.timeTo ?? current.timeTo,
      };
      if (slot.timeTo <= slot.timeFrom) throw AppError.badRequest('Time to must be after time from');
      await assertNoOverlap(em, viewer.branchId, slot, id);

      if (input.patientId && input.patientId !== current.patientId) {
        const patient = await patientsService.require(input.patientId, em);
        current.patientCity = patient.city;
      }
      Object.assign(current, input, slot, { updatedBy: actor.userId });
      await appointments.save(current, em);

      const after = await loadDetail(viewer, id, em);
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'update',
          entity: 'appointment',
          entityId: id,
          before,
          after,
        },
        em,
      );
      return after;
    });
  },

  async setStatus(
    actor: Actor,
    viewer: Viewer,
    id: string,
    input: AppointmentStatusInput,
    files: Express.Multer.File[] = [],
  ) {
    await getAppointmentRecord(viewer, id);
    const uploaded = await uploadMany(BUCKETS.medicalRecords, `${viewer.branchId}/appointments/${id}`, files);
    return withUploads(uploaded, () =>
      withTransaction(async (em) => {
        const record = await getAppointmentRecord(viewer, id, em);
        const before = { status: record.status, remark: record.remark };
        record.status = input.status;
        if (input.remark !== undefined) record.remark = input.remark;
        record.updatedBy = actor.userId;
        await appointments.save(record, em);
        await saveAttachments(em, actor, viewer.branchId, id, uploaded);
        await auditService.record(
          {
            actor,
            branchId: viewer.branchId,
            action: 'status',
            entity: 'appointment',
            entityId: id,
            before,
            after: { status: record.status, remark: record.remark, files: uploaded.length },
          },
          em,
        );
        return loadDetail(viewer, id, em);
      }),
    );
  },

  async remove(actor: Actor, viewer: Viewer, id: string) {
    await withTransaction(async (em) => {
      const before = await loadDetail(viewer, id, em);
      const record = await getAppointmentRecord(viewer, id, em);
      await appointmentPaymentsService.removeAllFor(actor, viewer.branchId, id, em);
      await appointments.softDelete(record, actor.userId, em);
      await auditService.record(
        { actor, branchId: viewer.branchId, action: 'delete', entity: 'appointment', entityId: id, before },
        em,
      );
    });
  },

  async attachmentUrl(viewer: Viewer, id: string, attachmentId: string) {
    await getAppointmentRecord(viewer, id);
    const file = await attachments.findOneBy(viewer.branchId, { id: attachmentId, appointmentId: id });
    if (!file) throw AppError.notFound('Attachment');
    return createSignedUrl(BUCKETS.medicalRecords, file.filePath);
  },

  async medicalFileUrl(viewer: Viewer, id: string, fileId: string) {
    await getAppointmentRecord(viewer, id);
    const file = await medicalFiles
      .query(viewer.branchId)
      .innerJoin('mrf.medicalRecord', 'mr')
      .andWhere('mrf.id = :fileId', { fileId })
      .andWhere('mr.appointmentId = :id', { id })
      .getOne();
    if (!file) throw AppError.notFound('Medical record file');
    return createSignedUrl(BUCKETS.medicalRecords, file.filePath);
  },

  async removeAttachment(actor: Actor, viewer: Viewer, id: string, attachmentId: string) {
    await withTransaction(async (em) => {
      await getAppointmentRecord(viewer, id, em);
      const file = await attachments.findOneBy(viewer.branchId, { id: attachmentId, appointmentId: id }, em);
      if (!file) throw AppError.notFound('Attachment');
      await attachments.softDelete(file, actor.userId, em);
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'remove_attachment',
          entity: 'appointment',
          entityId: id,
          before: toFileDto(file),
        },
        em,
      );
    });
  },
};
