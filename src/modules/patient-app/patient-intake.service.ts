import { AppDataSource } from '../../database/data-source';
import { repo } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { today } from '../../lib/validation';
import { type SectionKey } from '../consultations/consultation-section.entity';
import { consultationsService } from '../consultations/consultations.service';
import { mergeIntake, PUBLIC_SECTIONS, type PublicSectionKey } from '../patient-links/patient-links.service';
import { Patient } from '../patients/patient.entity';
import { Prescription } from '../prescriptions/prescription.entity';

export const MEDICINE_CATEGORIES = ['medicine', 'supplement'] as const;

const PATIENT_FIELDS: Record<PublicSectionKey, readonly string[]> = {
  basic_info: [
    'name',
    'age',
    'city',
    'country',
    'weightKg',
    'heightFeet',
    'waistCircumference',
    'maritalStatus',
    'marriedYears',
    'hasKids',
    'kidsDetails',
    'education',
    'occupation',
  ],
  medical_history: [
    'majorComplaint',
    'hormoneTherapy',
    'hormonesUsed',
    'contraception',
    'havingPeriods',
    'lastPeriodDate',
    'cycle',
    'flow',
    'dub',
    'oligomenorrhea',
    'periodsNote',
    'menopauseDiagnosed',
    'menopauseDiagnosedAge',
    'conditions',
    'otherConditions',
    'surgeries',
    'otherSurgery',
    'familyHistory',
    'currentMedications',
    'hasAllergies',
    'allergies',
    'alcohol',
    'smoking',
    'exercise',
    'followsDiet',
    'dietName',
    'relationship',
    'relationshipSituation',
  ],
  additional_symptoms: ['symptoms'],
};

interface VisitRow {
  id: string;
  branchId: string;
  appointmentNo: number;
  repeatNo: number | null;
  date: string;
  timeFrom: string;
  status: string;
  doctor: string | null;
  consultationStatus: string | null;
}

const editable = (v: VisitRow) => v.status === 'booked' && v.consultationStatus !== 'completed';

export async function targetVisit(patientId: string) {
  const rows = (await AppDataSource.query(
    `SELECT a.id, a.branch_id AS "branchId", a.appointment_no AS "appointmentNo", a.repeat_no AS "repeatNo",
            a.date::text AS date, a.time_from::text AS "timeFrom", a.status::text AS status,
            d.display_name AS doctor, c.status::text AS "consultationStatus"
       FROM appointments a
       LEFT JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN consultations c ON c.appointment_id = a.id AND c.deleted_at IS NULL
      WHERE a.patient_id = $1 AND a.deleted_at IS NULL AND a.status <> 'cancelled'
      ORDER BY a.date, a.time_from`,
    [patientId],
  )) as VisitRow[];
  const now = today();
  return (
    rows.find((v) => editable(v) && v.date >= now) ??
    [...rows].reverse().find(editable) ??
    [...rows].reverse().find((v) => v.status === 'completed') ??
    null
  );
}

const pick = (key: PublicSectionKey, body: unknown) => {
  const source =
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return Object.fromEntries(PATIENT_FIELDS[key].filter((f) => f in source).map((f) => [f, source[f]]));
};

export const patientIntakeService = {
  async get(patientId: string) {
    const [visit, patient] = await Promise.all([
      targetVisit(patientId),
      repo(Patient).findOne({ where: { id: patientId } }),
    ]);
    if (!patient) throw AppError.notFound('Patient');
    const defaults = { name: patient.name, age: patient.age, city: patient.city, country: patient.country };
    if (!visit) return { appointment: null, editable: false, defaults, sections: emptySections() };
    const viewer = { branchId: visit.branchId, doctorId: null };
    const consultation = await consultationsService.forAppointment(viewer, visit.id).catch(() => null);
    return {
      appointment: {
        id: visit.id,
        appointmentNo: visit.appointmentNo,
        repeatNo: visit.repeatNo,
        date: visit.date,
        timeFrom: visit.timeFrom.slice(0, 5),
        doctor: visit.doctor,
        status: visit.status,
      },
      editable: editable(visit),
      defaults,
      sections: Object.fromEntries(
        PUBLIC_SECTIONS.map((key) => [key, consultation?.sections[key]?.data ?? null]),
      ) as Record<PublicSectionKey, Record<string, unknown> | null>,
    };
  },

  async save(patientId: string, key: PublicSectionKey, body: unknown) {
    const visit = await targetVisit(patientId);
    if (!visit) throw AppError.unprocessable('Book an appointment first. The form is filled for a visit.');
    if (!editable(visit)) {
      throw AppError.conflict('Your doctor has completed this visit, so this form can no longer be changed.');
    }
    const viewer = { branchId: visit.branchId, doctorId: null };
    const opened = await consultationsService.open(null, viewer, visit.id);
    if (opened.consultation.status === 'completed') {
      throw AppError.conflict('Your doctor has completed this visit, so this form can no longer be changed.');
    }
    const saved = (opened.consultation.sections[key]?.data ?? {}) as Record<string, unknown>;
    const next = pick(key, body);
    await consultationsService.saveSection(
      null,
      viewer,
      opened.consultation.id,
      key as SectionKey,
      mergeIntake(key, saved, next),
    );
    return this.get(patientId);
  },

  async medicines(patientId: string) {
    const rows = await repo(Prescription)
      .createQueryBuilder('rx')
      .leftJoinAndSelect('rx.doctor', 'doctor')
      .leftJoinAndSelect('rx.items', 'items')
      .where('rx.patientId = :patientId', { patientId })
      .orderBy('rx.date', 'DESC')
      .addOrderBy('rx.createdAt', 'DESC')
      .getMany();
    return rows
      .map((rx) => ({
        prescriptionId: rx.id,
        prescriptionNo: rx.prescriptionNo,
        date: rx.date,
        doctor: rx.doctor?.displayName ?? null,
        diagnosis: rx.diagnosis,
        items: [...(rx.items ?? [])]
          .filter((i) => (MEDICINE_CATEGORIES as readonly string[]).includes(i.category))
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
      }))
      .filter((rx) => rx.items.length > 0);
  },
};

function emptySections() {
  return Object.fromEntries(PUBLIC_SECTIONS.map((key) => [key, null])) as Record<
    PublicSectionKey,
    Record<string, unknown> | null
  >;
}
