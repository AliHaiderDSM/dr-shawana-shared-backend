import { type EntityManager } from 'typeorm';
import { repo, withTransaction } from '../../database/transaction';
import { Decimal, toMoney } from '../../database/transformers';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { Appointment } from '../appointments/appointment.entity';
import { AppointmentPayment } from '../appointments/appointment-payment.entity';
import { auditService } from '../audit/audit.service';
import { type Viewer } from '../doctors/doctors.service';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { MedicalRecord } from '../medical-records/medical-record.entity';
import { type Patient } from './patient.entity';
import { last9Of, normalizePhone } from './phone';
import { patientsRepository } from './patients.repository';
import { type CreatePatientInput, type PatientListQuery, type UpdatePatientInput } from './patients.schemas';

export function toPatientDto(patient: Patient) {
  const { phoneLast9: _last9, createdInBranch: _branch, ...rest } = withoutInternals(patient);
  return rest;
}

export const toPatientOption = (p: Pick<Patient, 'id' | 'name' | 'phone' | 'city'>) => ({
  id: p.id,
  name: p.name,
  phone: p.phone,
  city: p.city,
});

async function getPatient(id: string, manager?: EntityManager) {
  const patient = await patientsRepository.findById(id, manager);
  if (!patient) throw AppError.notFound('Patient');
  return patient;
}

function phoneFields(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw AppError.badRequest('Enter a valid phone number');
  return { phone, phoneNormalized: normalized.normalized, phoneLast9: normalized.last9 };
}

async function assertPhoneAvailable(last9: string, excludeId: string | undefined, manager?: EntityManager) {
  const existing = await patientsRepository.findByLast9(last9, manager);
  if (existing && existing.id !== excludeId) {
    const branch = existing.createdInBranch?.name;
    throw AppError.conflict(`This phone number is already added${branch ? ` in ${branch}` : ''}`, {
      patient: toPatientOption(existing),
      branch: branch ?? null,
    });
  }
}

function summaryAppointment(a: Appointment, received: Map<string, string>) {
  return {
    id: a.id,
    appointmentNo: a.appointmentNo,
    date: a.date,
    timeFrom: a.timeFrom,
    timeTo: a.timeTo,
    status: a.status,
    mode: a.mode,
    visitType: a.visitType,
    doctor: a.doctor ? { id: a.doctor.id, name: a.doctor.displayName } : null,
    receivedAmount: toMoney(received.get(a.id) ?? 0),
  };
}

export const patientsService = {
  async list(branchId: string, query: PatientListQuery) {
    const { items, meta } = await patientsRepository.list(branchId, query);
    return { items: items.map(toPatientDto), meta };
  },

  async options(branchId: string, search?: string) {
    return (await patientsRepository.options(branchId, search)).map(toPatientOption);
  },

  async checkPhone(phone: string, excludeId?: string) {
    const last9 = last9Of(phone);
    const existing = last9 ? await patientsRepository.findByLast9(last9) : null;
    const match = existing && existing.id !== excludeId ? existing : null;
    return {
      exists: match !== null,
      patient: match ? toPatientOption(match) : null,
      branch: match?.createdInBranch?.name ?? null,
    };
  },

  cities: (search: string) => patientsRepository.cities(search),

  async get(id: string) {
    return toPatientDto(await getPatient(id));
  },

  require: getPatient,

  async createRecord(actor: Actor, branchId: string, input: CreatePatientInput, manager: EntityManager) {
    const phone = phoneFields(input.phone);
    await assertPhoneAvailable(phone.phoneLast9, undefined, manager);
    const patient = await patientsRepository.create(
      { ...input, ...phone, createdInBranchId: branchId, createdBy: actor.userId },
      manager,
    );
    await auditService.record(
      {
        actor,
        branchId,
        action: 'create',
        entity: 'patient',
        entityId: patient.id,
        after: toPatientDto(patient),
      },
      manager,
    );
    return patient;
  },

  async create(actor: Actor, branchId: string, input: CreatePatientInput) {
    return toPatientDto(await withTransaction((em) => this.createRecord(actor, branchId, input, em)));
  },

  async update(
    actor: Actor,
    branchId: string,
    id: string,
    input: UpdatePatientInput,
    manager?: EntityManager,
  ) {
    return withTransaction(async (em) => {
      const patient = await getPatient(id, em);
      const before = toPatientDto(patient);
      const phone = input.phone ? phoneFields(input.phone) : null;
      if (phone) await assertPhoneAvailable(phone.phoneLast9, id, em);
      Object.assign(patient, input, phone ?? {}, { updatedBy: actor.userId });
      const saved = await patientsRepository.save(patient, em);
      await auditService.record(
        {
          actor,
          branchId,
          action: 'update',
          entity: 'patient',
          entityId: id,
          before,
          after: toPatientDto(saved),
        },
        em,
      );
      return toPatientDto(saved);
    }, manager);
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const patient = await getPatient(id, em);
      const appointments = await repo(Appointment, em).count({ where: { patientId: id } });
      if (appointments > 0) {
        throw AppError.conflict('This patient has appointments. Remove the appointments first.');
      }
      await patientsRepository.softDelete(patient, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'patient', entityId: id, before: toPatientDto(patient) },
        em,
      );
    });
  },

  async summary(viewer: Viewer, id: string) {
    const patient = await getPatient(id);
    const qb = repo(Appointment)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.doctor', 'doctor')
      .where('a.branchId = :branchId', { branchId: viewer.branchId })
      .andWhere('a.patientId = :id', { id });
    if (viewer.doctorId) qb.andWhere('a.doctorId = :doctorId', { doctorId: viewer.doctorId });
    const appointments = await qb.orderBy('a.date', 'DESC').addOrderBy('a.timeFrom', 'DESC').getMany();

    const ids = appointments.map((a) => a.id);
    const paid =
      ids.length === 0
        ? []
        : await repo(AppointmentPayment)
            .createQueryBuilder('pay')
            .select('pay.appointmentId', 'appointmentId')
            .addSelect('SUM(pay.amount)', 'total')
            .where('pay.branchId = :branchId', { branchId: viewer.branchId })
            .andWhere('pay.appointmentId IN (:...ids)', { ids })
            .groupBy('pay.appointmentId')
            .getRawMany<{ appointmentId: string; total: string }>();
    const received = new Map(paid.map((p) => [p.appointmentId, p.total]));
    const totalReceived = toMoney(paid.reduce((sum, p) => sum.plus(p.total), new Decimal(0)));

    const now = today();
    const upcoming = appointments
      .filter((a) => a.status === 'booked' && a.date >= now)
      .sort((x, y) => `${x.date} ${x.timeFrom}`.localeCompare(`${y.date} ${y.timeFrom}`));
    const lastVisit = appointments.find((a) => a.status === 'completed')?.date ?? null;

    const recordsQb = repo(MedicalRecord)
      .createQueryBuilder('mr')
      .leftJoinAndSelect('mr.files', 'file')
      .where('mr.branchId = :branchId', { branchId: viewer.branchId })
      .andWhere('mr.patientId = :id', { id });
    if (viewer.doctorId) {
      recordsQb.andWhere('(mr.appointmentId IS NULL OR mr.appointmentId IN (:...visible))', {
        visible: ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'],
      });
    }
    const records = await recordsQb.orderBy('mr.date', 'DESC').addOrderBy('mr.createdAt', 'DESC').getMany();

    return {
      patient: toPatientDto(patient),
      appointments: {
        total: appointments.length,
        booked: appointments.filter((a) => a.status === 'booked').length,
        completed: appointments.filter((a) => a.status === 'completed').length,
        cancelled: appointments.filter((a) => a.status === 'cancelled').length,
        lastVisit,
        nextAppointment: upcoming[0] ? summaryAppointment(upcoming[0], received) : null,
        recent: appointments.slice(0, 10).map((a) => summaryAppointment(a, received)),
      },
      payments: { totalReceived },
      medicalRecords: records.map((r) => ({
        id: r.id,
        date: r.date,
        note: r.note,
        appointmentId: r.appointmentId,
        files: (r.files ?? []).map((f) => ({
          id: f.id,
          originalName: f.originalName,
          contentType: f.contentType,
        })),
      })),
    };
  },

  async medicalFileUrl(viewer: Viewer, patientId: string, fileId: string) {
    const file = await repo(MedicalRecordFile)
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.medicalRecord', 'mr')
      .where('f.id = :fileId', { fileId })
      .andWhere('f.branchId = :branchId', { branchId: viewer.branchId })
      .andWhere('mr.patientId = :patientId', { patientId })
      .getOne();
    if (!file) throw AppError.notFound('Medical record file');
    if (viewer.doctorId && file.medicalRecord?.appointmentId) {
      const own = await repo(Appointment).count({
        where: { id: file.medicalRecord.appointmentId, doctorId: viewer.doctorId },
      });
      if (own === 0) throw AppError.notFound('Medical record file');
    }
    return createSignedUrl(BUCKETS.medicalRecords, file.filePath);
  },
};
