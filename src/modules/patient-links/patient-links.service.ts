import { repo } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { createSignedToken, readSignedToken } from '../../lib/signed-token';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { getAppointmentRecord } from '../appointments/appointment-access';
import { Appointment } from '../appointments/appointment.entity';
import { medicalRecordsService, patientRecordsTimeline } from '../clinical-records/clinical-records.service';
import { companyService } from '../company/company.service';
import { type Viewer } from '../doctors/doctors.service';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { Patient } from '../patients/patient.entity';
import { prescriptionsService } from '../prescriptions/prescriptions.service';

const LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

const invalidLink = () => new AppError(404, 'NOT_FOUND', 'This link is invalid or has expired');

function patientOf(token: string) {
  const payload = readSignedToken<{ kind?: unknown; patientId?: unknown }>(token);
  if (!payload || payload.kind !== 'patient-history' || typeof payload.patientId !== 'string')
    throw invalidLink();
  return { patientId: payload.patientId, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export const patientLinksService = {
  async create(viewer: Viewer, appointmentId: string) {
    const appointment = await getAppointmentRecord(viewer, appointmentId);
    const { token, expiresAt } = createSignedToken(
      { kind: 'patient-history', patientId: appointment.patientId },
      LINK_TTL_SECONDS,
    );
    return { token, expiresAt: expiresAt.toISOString() };
  },

  async history(token: string) {
    const { patientId, expiresAt } = patientOf(token);
    const patient = await repo(Patient).findOne({ where: { id: patientId } });
    if (!patient) throw invalidLink();
    const [company, visits, prescriptions, records, medicalRecords] = await Promise.all([
      companyService.get(),
      repo(Appointment).find({
        where: { patientId },
        relations: { doctor: true },
        order: { date: 'DESC', timeFrom: 'DESC' },
      }),
      prescriptionsService.timeline(null, patientId, null),
      patientRecordsTimeline(null, patientId),
      medicalRecordsService.timeline(null, patientId),
    ]);
    return {
      clinic: company ? { name: company.name, phone: company.phone, address: company.address } : null,
      patient: { name: patient.name, city: patient.city },
      expiresAt,
      appointments: visits.map((a) => ({
        appointmentNo: a.appointmentNo,
        date: a.date,
        timeFrom: a.timeFrom,
        timeTo: a.timeTo,
        doctor: a.doctor?.displayName ?? null,
        mode: a.mode,
        status: a.status,
      })),
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        prescriptionNo: p.prescriptionNo,
        date: p.date,
        doctor: p.doctor?.name ?? null,
        diagnosis: p.diagnosis,
        planTreatment: p.planTreatment,
        followupDate: p.followupDate,
        items: p.items.map((i) => ({
          category: i.category,
          name: i.name,
          dose: i.dose,
          instructions: i.instructions,
        })),
      })),
      bloodWork: records.bloodWork.map((b) => ({
        test: b.test,
        value: String(b.value),
        unit: b.unit,
        testDate: b.testDate,
      })),
      bhrt: records.bhrt.map((h) => ({ date: h.date, status: h.status, note: h.note })),
      medicalRecords: medicalRecords.map((r) => ({
        id: r.id,
        type: r.type,
        date: r.date,
        note: r.note,
        files: r.files.map((f) => ({ id: f.id, originalName: f.originalName, contentType: f.contentType })),
      })),
    };
  },

  async fileUrl(token: string, fileId: string) {
    const { patientId } = patientOf(token);
    const file = await repo(MedicalRecordFile)
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.medicalRecord', 'mr')
      .where('f.id = :fileId', { fileId })
      .andWhere('mr.patientId = :patientId', { patientId })
      .getOne();
    if (!file) throw AppError.notFound('File');
    return createSignedUrl(BUCKETS.medicalRecords, file.filePath);
  },
};
