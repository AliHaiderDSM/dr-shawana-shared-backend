import { AppDataSource } from '../../database/data-source';
import { repo } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { medicalRecordsService } from '../clinical-records/clinical-records.service';
import { companyService } from '../company/company.service';
import { MedicalRecordFile } from '../medical-records/medical-record-file.entity';
import { Patient } from '../patients/patient.entity';
import { Prescription } from '../prescriptions/prescription.entity';
import { auditService } from '../audit/audit.service';
import { patientRequestsService } from './patient-requests.service';

interface AppointmentRow {
  id: string;
  appointmentNo: number;
  date: string;
  timeFrom: string;
  timeTo: string;
  mode: string;
  visitType: string;
  status: string;
  doctorName: string | null;
  doctorDetails: string | null;
  branchName: string;
  branchCity: string;
  branchAddress: string | null;
  branchPhone: string | null;
  consultationId: string | null;
}

const APPOINTMENT_SELECT = `
  SELECT a.id, a.appointment_no AS "appointmentNo", a.date::text AS date, a.time_from::text AS "timeFrom",
         a.time_to::text AS "timeTo", a.mode, a.visit_type AS "visitType", a.status,
         d.display_name AS "doctorName", d.details AS "doctorDetails",
         b.name AS "branchName", b.city AS "branchCity", b.address AS "branchAddress", b.phone AS "branchPhone",
         c.id AS "consultationId"
    FROM appointments a
    JOIN branches b ON b.id = a.branch_id
    LEFT JOIN doctors d ON d.id = a.doctor_id
    LEFT JOIN consultations c ON c.appointment_id = a.id AND c.deleted_at IS NULL
   WHERE a.deleted_at IS NULL AND a.patient_id = $1`;

function isUpcoming(row: { date: string; status: string }) {
  return row.status === 'booked' && row.date >= today();
}

function toAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    appointmentNo: row.appointmentNo,
    date: row.date,
    timeFrom: row.timeFrom.slice(0, 5),
    timeTo: row.timeTo.slice(0, 5),
    mode: row.mode,
    visitType: row.visitType,
    status: row.status,
    upcoming: isUpcoming(row),
    doctor: row.doctorName ? { name: row.doctorName, details: row.doctorDetails } : null,
    branch: {
      name: row.branchName,
      city: row.branchCity,
      address: row.branchAddress,
      phone: row.branchPhone,
    },
  };
}

async function appointmentRows(patientId: string) {
  return (await AppDataSource.query(`${APPOINTMENT_SELECT} ORDER BY a.date DESC, a.time_from DESC`, [
    patientId,
  ])) as AppointmentRow[];
}

async function prescriptionRows(patientId: string) {
  return repo(Prescription)
    .createQueryBuilder('rx')
    .leftJoinAndSelect('rx.doctor', 'doctor')
    .leftJoinAndSelect('rx.items', 'items')
    .where('rx.patientId = :patientId', { patientId })
    .orderBy('rx.date', 'DESC')
    .addOrderBy('rx.createdAt', 'DESC')
    .getMany();
}

async function appointmentIdsByConsultation(consultationIds: string[]) {
  if (consultationIds.length === 0) return new Map<string, string>();
  const rows = (await AppDataSource.query(
    `SELECT id, appointment_id AS "appointmentId" FROM consultations WHERE id = ANY($1::uuid[])`,
    [consultationIds],
  )) as { id: string; appointmentId: string }[];
  return new Map(rows.map((r) => [r.id, r.appointmentId]));
}

function toPrescriptionSummary(rx: Prescription, appointmentId: string | null) {
  return {
    id: rx.id,
    prescriptionNo: rx.prescriptionNo,
    date: rx.date,
    doctor: rx.doctor?.displayName ?? null,
    diagnosis: rx.diagnosis,
    followupDate: rx.followupDate,
    itemCount: rx.items?.length ?? 0,
    appointmentId,
  };
}

function toPrescriptionDetail(rx: Prescription, appointmentId: string | null) {
  return {
    ...toPrescriptionSummary(rx, appointmentId),
    planTreatment: rx.planTreatment,
    items: [...(rx.items ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        category: i.category,
        groupName: i.groupName,
        name: i.name,
        dose: i.dose,
        instructions: i.instructions,
        optional: i.optional,
      })),
  };
}

async function documents(patientId: string) {
  const records = await medicalRecordsService.timeline(null, patientId);
  return records.map((r) => ({
    id: r.id,
    type: r.type,
    date: r.date,
    title: r.note,
    appointmentId: r.appointmentId,
    uploadedByPatient: r.uploadedByPatient,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    files: r.files.map((f) => ({
      id: f.id,
      name: f.originalName,
      contentType: f.contentType,
      sizeBytes: f.sizeBytes,
    })),
  }));
}

export const patientAppService = {
  async me(patientId: string) {
    const patient = await repo(Patient).findOne({ where: { id: patientId } });
    if (!patient) throw AppError.unauthorized();
    const company = await companyService.get();
    return {
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      age: patient.age,
      dateOfBirth: patient.dateOfBirth,
      city: patient.city,
      country: patient.country,
      clinic: company ? { name: company.name, phone: company.phone, address: company.address } : null,
    };
  },

  async updateMe(
    patientId: string,
    input: {
      name?: string;
      city?: string;
      country?: string | null;
      age?: number | null;
      dateOfBirth?: string | null;
    },
  ) {
    const patients = repo(Patient);
    const patient = await patients.findOne({ where: { id: patientId } });
    if (!patient) throw AppError.unauthorized();
    const before = {
      name: patient.name,
      city: patient.city,
      country: patient.country,
      age: patient.age,
      dateOfBirth: patient.dateOfBirth,
    };
    const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    await patients.update({ id: patientId }, { ...changes, appUpdatedAt: new Date() });
    await auditService.record({
      actor: null,
      branchId: patient.createdInBranchId,
      action: 'update_from_app',
      entity: 'patient',
      entityId: patientId,
      before,
      after: changes,
    });
    return this.me(patientId);
  },

  async overview(patientId: string) {
    const [me, appointments, prescriptions, requests] = await Promise.all([
      this.me(patientId),
      appointmentRows(patientId),
      prescriptionRows(patientId),
      patientRequestsService.listForPatient(patientId),
    ]);
    const upcoming = appointments
      .filter(isUpcoming)
      .sort((a, b) => `${a.date} ${a.timeFrom}`.localeCompare(`${b.date} ${b.timeFrom}`));
    const past = appointments.filter((a) => !isUpcoming(a));
    const latest = prescriptions[0];
    const links = await appointmentIdsByConsultation(latest?.consultationId ? [latest.consultationId] : []);
    return {
      patient: { name: me.name },
      nextAppointment: upcoming[0] ? toAppointment(upcoming[0]) : null,
      upcomingCount: upcoming.length,
      latestPrescription: latest
        ? toPrescriptionSummary(
            latest,
            latest.consultationId ? (links.get(latest.consultationId) ?? null) : null,
          )
        : null,
      recentVisits: past.slice(0, 3).map(toAppointment),
      openRequests: requests.filter((r) => ['submitted', 'in_review', 'in_progress'].includes(r.status))
        .length,
      counts: {
        appointments: appointments.length,
        prescriptions: prescriptions.length,
      },
    };
  },

  async appointments(patientId: string) {
    return (await appointmentRows(patientId)).map(toAppointment);
  },

  async appointment(patientId: string, id: string) {
    const [row] = (await AppDataSource.query(`${APPOINTMENT_SELECT} AND a.id = $2`, [
      patientId,
      id,
    ])) as AppointmentRow[];
    if (!row) throw AppError.notFound('Appointment');
    const rx = row.consultationId
      ? await repo(Prescription).find({
          where: { patientId, consultationId: row.consultationId },
          relations: { doctor: true, items: true },
          order: { date: 'DESC' },
        })
      : [];
    const docs = (await documents(patientId)).filter((d) => d.appointmentId === id);
    return {
      ...toAppointment(row),
      prescriptions: rx.map((p) => toPrescriptionSummary(p, id)),
      documents: docs,
    };
  },

  async prescriptions(patientId: string) {
    const rows = await prescriptionRows(patientId);
    const links = await appointmentIdsByConsultation(
      rows.map((r) => r.consultationId).filter((v): v is string => Boolean(v)),
    );
    return rows.map((rx) =>
      toPrescriptionSummary(rx, rx.consultationId ? (links.get(rx.consultationId) ?? null) : null),
    );
  },

  async prescription(patientId: string, id: string) {
    const rx = await repo(Prescription).findOne({
      where: { id, patientId },
      relations: { doctor: true, items: true },
    });
    if (!rx) throw AppError.notFound('Prescription');
    const links = await appointmentIdsByConsultation(rx.consultationId ? [rx.consultationId] : []);
    return toPrescriptionDetail(rx, rx.consultationId ? (links.get(rx.consultationId) ?? null) : null);
  },

  async history(patientId: string) {
    const [appointments, prescriptions, docs] = await Promise.all([
      appointmentRows(patientId),
      prescriptionRows(patientId),
      documents(patientId),
    ]);
    const links = await appointmentIdsByConsultation(
      prescriptions.map((r) => r.consultationId).filter((v): v is string => Boolean(v)),
    );
    return appointments
      .filter((a) => !isUpcoming(a))
      .map((a) => ({
        ...toAppointment(a),
        prescriptions: prescriptions
          .filter((rx) => rx.consultationId && links.get(rx.consultationId) === a.id)
          .map((rx) => ({ id: rx.id, prescriptionNo: rx.prescriptionNo, diagnosis: rx.diagnosis })),
        documentCount: docs
          .filter((d) => d.appointmentId === a.id)
          .reduce((sum, d) => sum + d.files.length, 0),
      }));
  },

  documents,

  async uploadDocuments(patientId: string, title: string | null, files: Express.Multer.File[]) {
    if (files.length === 0) throw AppError.badRequest('Choose at least one file');
    const branchId = await patientRequestsService.homeBranchOf(patientId);
    const record = await medicalRecordsService.createFromPatient(branchId, patientId, title, files);
    return (await documents(patientId)).find((d) => d.id === record.id) ?? null;
  },

  async documentUrl(patientId: string, fileId: string) {
    const file = await repo(MedicalRecordFile)
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.medicalRecord', 'mr')
      .where('f.id = :fileId', { fileId })
      .andWhere('mr.patientId = :patientId', { patientId })
      .getOne();
    if (!file) throw AppError.notFound('Document');
    return createSignedUrl(BUCKETS.medicalRecords, file.filePath, 120);
  },
};
