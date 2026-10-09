import { AppDataSource } from '../../database/data-source';
import { repo } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { createSignedToken, readSignedToken } from '../../lib/signed-token';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { getAppointmentRecord } from '../appointments/appointment-access';
import { Appointment } from '../appointments/appointment.entity';
import { medicalRecordsService, patientRecordsTimeline } from '../clinical-records/clinical-records.service';
import { type MedicalRecordType } from '../medical-records/medical-record.entity';
import { type SectionKey } from '../consultations/consultation-section.entity';
import { consultationsService } from '../consultations/consultations.service';
import { companyService } from '../company/company.service';
import { type Viewer } from '../doctors/doctors.service';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { Patient } from '../patients/patient.entity';
import { prescriptionsService } from '../prescriptions/prescriptions.service';

const LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

const invalidLink = () => new AppError(404, 'NOT_FOUND', 'This link is invalid or has expired');

export const PUBLIC_SECTIONS = ['basic_info', 'medical_history', 'additional_symptoms'] as const;
export type PublicSectionKey = (typeof PUBLIC_SECTIONS)[number];

const RESOURCE_KEYS = [
  'glpDietPlan',
  'generalDietPlan',
  'liverDetox',
  'skinCareRoutine',
  'hairCareRoutine',
] as const;

function patientOf(token: string) {
  const payload = readSignedToken<{
    kind?: unknown;
    patientId?: unknown;
    appointmentId?: unknown;
    issuedBy?: unknown;
  }>(token);
  if (!payload || payload.kind !== 'patient-history' || typeof payload.patientId !== 'string')
    throw invalidLink();
  return {
    patientId: payload.patientId,
    appointmentId: typeof payload.appointmentId === 'string' ? payload.appointmentId : null,
    issuedBy: typeof payload.issuedBy === 'string' ? payload.issuedBy : null,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

const formClosed = () =>
  new AppError(
    409,
    'CONFLICT',
    'This link can only show the history. Ask the clinic for a new link to fill the form.',
  );

async function formContext(token: string, ip: string | null) {
  const link = patientOf(token);
  if (!link.appointmentId || !link.issuedBy) throw formClosed();
  const appointment = await repo(Appointment).findOne({ where: { id: link.appointmentId } });
  if (!appointment || appointment.patientId !== link.patientId) throw invalidLink();
  const [staff] = (await AppDataSource.query(
    `SELECT id, role, branch_id AS "branchId" FROM staff_profiles WHERE id = $1 AND deleted_at IS NULL`,
    [link.issuedBy],
  )) as { id: string; role: Actor['role']; branchId: string | null }[];
  if (!staff) throw formClosed();
  const actor: Actor = {
    userId: staff.id,
    role: staff.role,
    branchId: staff.branchId,
    isSuperAdmin: staff.role === 'super_admin',
    ip,
  };
  const viewer = { branchId: appointment.branchId, doctorId: null };
  return { link, appointment, actor, viewer };
}

async function publicForm(appointmentId: string | null) {
  if (!appointmentId) return { form: null, resources: [] as string[] };
  const appointment = await repo(Appointment).findOne({ where: { id: appointmentId } });
  if (!appointment) return { form: null, resources: [] as string[] };
  const viewer = { branchId: appointment.branchId, doctorId: null };
  const consultation = await consultationsService.forAppointment(viewer, appointmentId).catch(() => null);
  const plans = (consultation?.sections.plans?.data ?? {}) as Record<string, unknown>;
  return {
    form: {
      appointmentNo: appointment.appointmentNo,
      date: appointment.date,
      sections: Object.fromEntries(
        PUBLIC_SECTIONS.map((key) => [key, consultation?.sections[key]?.data ?? null]),
      ) as Record<PublicSectionKey, Record<string, unknown> | null>,
    },
    resources: RESOURCE_KEYS.filter((key) => plans[key] === 'yes'),
  };
}

export const patientLinksService = {
  async create(viewer: Viewer, appointmentId: string, issuedBy: string) {
    const appointment = await getAppointmentRecord(viewer, appointmentId);
    const { token, expiresAt } = createSignedToken(
      { kind: 'patient-history', patientId: appointment.patientId, appointmentId: appointment.id, issuedBy },
      LINK_TTL_SECONDS,
    );
    return { token, expiresAt: expiresAt.toISOString() };
  },

  async history(token: string) {
    const { patientId, appointmentId, expiresAt } = patientOf(token);
    const patient = await repo(Patient).findOne({ where: { id: patientId } });
    if (!patient) throw invalidLink();
    const [company, visits, prescriptions, records, medicalRecords, extra] = await Promise.all([
      companyService.get(),
      repo(Appointment).find({
        where: { patientId },
        relations: { doctor: true },
        order: { date: 'DESC', timeFrom: 'DESC' },
      }),
      prescriptionsService.timeline(null, patientId, null),
      patientRecordsTimeline(null, patientId),
      medicalRecordsService.timeline(null, patientId),
      publicForm(appointmentId),
    ]);
    return {
      ...extra,
      phone: patient.phone,
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

  async saveSection(token: string, key: PublicSectionKey, body: unknown, ip: string | null) {
    const { appointment, actor, viewer } = await formContext(token, ip);
    const opened = await consultationsService.open(actor, viewer, appointment.id);
    const result = await consultationsService.saveSection(
      actor,
      viewer,
      opened.consultation.id,
      key as SectionKey,
      body,
    );
    return { key, data: result.section?.data ?? null };
  },

  async addRecord(
    token: string,
    input: { type: MedicalRecordType; note?: string | null },
    files: Express.Multer.File[],
    ip: string | null,
  ) {
    const { link, appointment, actor } = await formContext(token, ip);
    if (files.length === 0) throw AppError.badRequest('Choose at least one file');
    const record = await medicalRecordsService.create(
      actor,
      appointment.branchId,
      link.patientId,
      {
        type: input.type,
        note: input.note ?? null,
        appointmentId: appointment.id,
      } as never,
      files,
    );
    return { id: record.id };
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
