import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { AppDataSource } from '../../database/data-source';
import { repo, withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { paginate } from '../../lib/pagination';
import { getAppointmentRecord } from '../appointments/appointment-access';
import { auditService } from '../audit/audit.service';
import { companyService } from '../company/company.service';
import { type Viewer } from '../doctors/doctors.service';
import { patientsService } from '../patients/patients.service';
import { type Patient } from '../patients/patient.entity';
import { ConsultationSection, SECTION_KEYS, type SectionKey } from './consultation-section.entity';
import { Consultation, type ConsultationStatus } from './consultation.entity';
import { type ConsultationListQuery } from './consultations.schemas';
import {
  bmiOf,
  MRS_ITEMS,
  mrsScores,
  PATIENT_FIELDS_BY_SECTION,
  SECTION_SCHEMAS,
  MEDICAL_HISTORY_TOPICS,
  SHARED_TOPIC_FIELDS,
} from './section-schemas';

const consultations = branchScopedRepository(Consultation, 'c');
const sections = branchScopedRepository(ConsultationSection, 's');

type SectionMap = Partial<Record<SectionKey, ConsultationSection>>;

const MRS_KEYS = [...MRS_ITEMS.somatic, ...MRS_ITEMS.psychological, ...MRS_ITEMS.urogenital];

function scoped(viewer: Viewer, manager?: EntityManager) {
  const qb = consultations
    .query(viewer.branchId, manager)
    .leftJoinAndSelect('c.patient', 'patient')
    .leftJoinAndSelect('c.doctor', 'doctor')
    .leftJoinAndSelect('c.appointment', 'appointment');
  if (viewer.doctorId) qb.andWhere('c.doctorId = :viewerDoctorId', { viewerDoctorId: viewer.doctorId });
  return qb;
}

async function getConsultation(viewer: Viewer, id: string, manager?: EntityManager) {
  const record = await scoped(viewer, manager).andWhere('c.id = :id', { id }).getOne();
  if (!record) throw AppError.notFound('Consultation');
  return record;
}

async function sectionsOf(
  branchId: string,
  consultationId: string,
  manager?: EntityManager,
): Promise<SectionMap> {
  const rows = await sections
    .query(branchId, manager)
    .andWhere('s.consultationId = :consultationId', { consultationId })
    .getMany();
  return Object.fromEntries(rows.map((r) => [r.sectionKey, r]));
}

function availableSections(consultation: Consultation, map: SectionMap): SectionKey[] {
  const referred = (map.clinical_assessment?.data.treatmentPlan as string[] | undefined)?.includes(
    'referred_to_specialist',
  );
  return SECTION_KEYS.filter((key) => {
    if (key === 'follow_up') return consultation.appointment?.visitType === 'followup';
    if (key === 'referral') return referred === true || map.referral !== undefined;
    return true;
  });
}

function patientValues(patient: Patient | undefined, key: SectionKey) {
  if (!patient) return {};
  if (key === 'basic_info') {
    return { name: patient.name, age: patient.age, city: patient.city, country: patient.country };
  }
  if (key === 'referral') return { name: patient.name, dateOfBirth: patient.dateOfBirth };
  return {};
}

function sectionView(consultation: Consultation, key: SectionKey, row: ConsultationSection | undefined) {
  if (!row) return null;
  const data: Record<string, unknown> = { ...row.data, ...patientValues(consultation.patient, key) };
  if (key === 'medical_history') {
    for (const field of MEDICAL_HISTORY_TOPICS) data[field] = consultation[field];
  }
  if (key === 'follow_up') {
    for (const field of SHARED_TOPIC_FIELDS) data[field] = consultation[field];
  }
  return {
    data,
    ...(key === 'mrs_scale' ? { scores: mrsScores(row.data) } : {}),
    updatedBy: row.updatedBy ?? row.createdBy,
    updatedAt: row.updatedAt,
  };
}

function toSummary(c: Consultation) {
  return {
    id: c.id,
    branchId: c.branchId,
    status: c.status,
    appointmentId: c.appointmentId,
    appointment: c.appointment
      ? {
          id: c.appointment.id,
          appointmentNo: c.appointment.appointmentNo,
          date: c.appointment.date,
          timeFrom: c.appointment.timeFrom,
          visitType: c.appointment.visitType,
          mode: c.appointment.mode,
          status: c.appointment.status,
        }
      : null,
    patientId: c.patientId,
    patient: c.patient
      ? {
          id: c.patient.id,
          name: c.patient.name,
          phone: c.patient.phone,
          age: c.patient.age,
          city: c.patient.city,
          bhrtStatus: c.patient.bhrtStatus,
        }
      : null,
    doctorId: c.doctorId,
    doctor: c.doctor ? { id: c.doctor.id, name: c.doctor.displayName } : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function toDetail(viewer: Viewer, id: string, manager?: EntityManager) {
  const consultation = await getConsultation(viewer, id, manager);
  const map = await sectionsOf(viewer.branchId, id, manager);
  return {
    ...toSummary(consultation),
    availableSections: availableSections(consultation, map),
    sections: Object.fromEntries(SECTION_KEYS.map((key) => [key, sectionView(consultation, key, map[key])])),
  };
}

function prepareData(key: SectionKey, parsed: Record<string, unknown>) {
  const patientFields = PATIENT_FIELDS_BY_SECTION[key] ?? [];
  const patient: Record<string, unknown> = {};
  const shared: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parsed)) {
    if (patientFields.includes(field)) patient[field] = value;
    else if ((SHARED_TOPIC_FIELDS as readonly string[]).includes(field)) shared[field] = value ?? null;
    else data[field] = value ?? null;
  }
  if (key === 'basic_info') Object.assign(data, bmiOf(Number(data.weightKg), Number(data.heightFeet)));
  return { patient, shared, data };
}

export const consultationsService = {
  async list(viewer: Viewer, query: ConsultationListQuery) {
    const qb = scoped(viewer);
    if (query.patientId) qb.andWhere('c.patientId = :patientId', { patientId: query.patientId });
    if (query.doctorId) qb.andWhere('c.doctorId = :doctorId', { doctorId: query.doctorId });
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.from) qb.andWhere('appointment.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('appointment.date <= :to', { to: query.to });
    const { items, meta } = await paginate(qb, query, {
      searchColumns: ['patient.name', 'patient.phone'],
      sortMap: { date: 'appointment.date', createdAt: 'c.createdAt' },
    });
    return { items: items.map(toSummary), meta };
  },

  async report(viewer: Viewer, query: ConsultationListQuery) {
    const { items, meta } = await this.list(viewer, query);
    const ids = items.map((c) => c.id);
    if (ids.length === 0) return { items: [], meta };
    const [sections, patients, blood, treatments] = await Promise.all([
      AppDataSource.query(
        `SELECT consultation_id AS id, section_key AS key, data FROM consultation_sections
          WHERE consultation_id = ANY($1::uuid[]) AND deleted_at IS NULL
            AND section_key IN ('basic_info', 'medical_history', 'mrs_scale', 'clinical_assessment', 'additional_symptoms')`,
        [ids],
      ) as Promise<{ id: string; key: string; data: Record<string, unknown> }[]>,
      AppDataSource.query(
        `SELECT p.id, p.age, p.city, p.country FROM patients p
          WHERE p.id = ANY($1::uuid[])`,
        [[...new Set(items.map((c) => c.patientId))]],
      ) as Promise<{ id: string; age: number | null; city: string; country: string | null }[]>,
      AppDataSource.query(
        `SELECT DISTINCT ON (consultation_id, test) consultation_id AS id, test, value::text AS value, unit
           FROM blood_work_results
          WHERE consultation_id = ANY($1::uuid[]) AND deleted_at IS NULL
            AND test IN ('fsh', 'estradiol', 'testosterone_total')
          ORDER BY consultation_id, test, test_date DESC`,
        [ids],
      ) as Promise<{ id: string; test: string; value: string; unit: string | null }[]>,
      AppDataSource.query(
        `SELECT p.consultation_id AS id, i.group_name AS "group", i.name, i.dose
           FROM prescriptions p
           JOIN prescription_items i ON i.prescription_id = p.id AND i.deleted_at IS NULL
          WHERE p.consultation_id = ANY($1::uuid[]) AND p.deleted_at IS NULL AND i.category = 'bhrt'`,
        [ids],
      ) as Promise<{ id: string; group: string; name: string; dose: string | null }[]>,
    ]);
    const sectionOf = (id: string, key: string) =>
      sections.find((s) => s.id === id && s.key === key)?.data ?? {};
    const TREATMENTS: Record<string, string[]> = {
      progesterone: ['Serenogest 100mg'],
      estradiol: ['Estradiol BHRT'],
      vaginal: ['DSM Vaginal Estradiol', 'DSM Vaginal DHEA', 'DSM Mixed Vaginal Therapy'],
      testosterone: ['Testofeme'],
    };
    return {
      items: items.map((c) => {
        const basic = sectionOf(c.id, 'basic_info');
        const history = sectionOf(c.id, 'medical_history');
        const mrs = sectionOf(c.id, 'mrs_scale');
        const clinical = sectionOf(c.id, 'clinical_assessment');
        const symptoms = sectionOf(c.id, 'additional_symptoms');
        const ticked = Array.isArray(symptoms.symptoms) ? (symptoms.symptoms as string[]) : [];
        const severity = (symptoms.severity ?? {}) as Record<string, number | null>;
        const hasMrs = Object.keys(mrs).length > 0;
        const patient = patients.find((p) => p.id === c.patientId);
        const value = (test: string) => {
          const row = blood.find((b) => b.id === c.id && b.test === test);
          return row ? `${Number(row.value)}${row.unit ? ` ${row.unit}` : ''}` : null;
        };
        const items = treatments.filter((t) => t.id === c.id);
        const treatment = (kind: string) =>
          items.filter((t) => TREATMENTS[kind]!.includes(t.group)).map((t) => t.dose || t.name);
        const therapy = history.hormoneTherapy;
        return {
          ...c,
          report: {
            age: patient?.age ?? null,
            city: patient?.city ?? null,
            country: patient?.country ?? null,
            bmi: (basic.bmi as number | undefined) ?? null,
            bmiCategory: (basic.bmiCategory as string | undefined) ?? null,
            menopauseStage: (clinical.menopauseStage as string[] | undefined) ?? [],
            menopauseType: (clinical.menopauseType as string[] | undefined) ?? [],
            ageAtMenopause: (history.menopauseDiagnosedAge as string | undefined) ?? null,
            mrs: hasMrs
              ? Object.fromEntries(MRS_KEYS.map((k) => [k, (mrs[k] as number | null) ?? null]))
              : null,
            mrsScores: hasMrs ? mrsScores(mrs) : null,
            fsh: value('fsh'),
            estradiol: value('estradiol'),
            totalTestosterone: value('testosterone_total'),
            progesterone: treatment('progesterone'),
            estradiolTreatment: treatment('estradiol'),
            vaginal: treatment('vaginal'),
            testosterone: treatment('testosterone'),
            symptoms: Object.fromEntries(ticked.map((s) => [s, severity[s] ?? null])),
            stillOnTreatment:
              therapy === 'currently_using'
                ? 'yes'
                : therapy === 'never' || therapy === 'previously_used'
                  ? 'no'
                  : null,
          },
        };
      }),
      meta,
    };
  },

  get: (viewer: Viewer, id: string) => toDetail(viewer, id),

  async history(viewer: Viewer, id: string) {
    const consultation = await getConsultation(viewer, id);
    const date = consultation.appointment?.date ?? null;
    const [visits, prescriptions, previous] = await Promise.all([
      AppDataSource.query(
        `SELECT a.id, a.appointment_no AS "appointmentNo", to_char(a.date, 'YYYY-MM-DD') AS date,
                a.visit_type AS "visitType", a.status, a.issues, a.remark, d.display_name AS doctor,
                NULLIF(TRIM(cs.data->>'plan'), '') AS plan, (a.id = $2) AS "thisVisit"
           FROM appointments a
           LEFT JOIN doctors d ON d.id = a.doctor_id
           LEFT JOIN consultations c ON c.appointment_id = a.id AND c.deleted_at IS NULL
           LEFT JOIN consultation_sections cs ON cs.consultation_id = c.id
                 AND cs.section_key = 'clinical_assessment' AND cs.deleted_at IS NULL
          WHERE a.patient_id = $1 AND a.deleted_at IS NULL AND (a.status <> 'cancelled' OR a.id = $2)
          ORDER BY a.date DESC, a.time_from DESC
          LIMIT 30`,
        [consultation.patientId, consultation.appointmentId],
      ) as Promise<Record<string, unknown>[]>,
      AppDataSource.query(
        `SELECT p.id, p.prescription_no AS "prescriptionNo", to_char(p.date, 'YYYY-MM-DD') AS date,
                d.display_name AS doctor, (p.consultation_id = $2) AS "thisVisit"
           FROM prescriptions p
           LEFT JOIN doctors d ON d.id = p.doctor_id
          WHERE p.patient_id = $1 AND p.deleted_at IS NULL
          ORDER BY p.date DESC, p.prescription_no DESC`,
        [consultation.patientId, id],
      ) as Promise<
        { id: string; prescriptionNo: number; date: string; doctor: string | null; thisVisit: boolean }[]
      >,
      AppDataSource.query(
        `SELECT cs.data, a.appointment_no AS "appointmentNo", to_char(a.date, 'YYYY-MM-DD') AS date
           FROM consultation_sections cs
           JOIN consultations c ON c.id = cs.consultation_id AND c.deleted_at IS NULL
           JOIN appointments a ON a.id = c.appointment_id
          WHERE c.patient_id = $1 AND c.id <> $2 AND cs.section_key = 'additional_symptoms'
            AND cs.deleted_at IS NULL AND ($3::date IS NULL OR a.date <= $3::date)
          ORDER BY a.date DESC, a.time_from DESC
          LIMIT 1`,
        [consultation.patientId, id, date],
      ) as Promise<{ data: Record<string, unknown>; appointmentNo: number; date: string }[]>,
    ]);
    return {
      visits,
      prescriptions: prescriptions.map((p) => ({
        ...p,
        thisVisit: p.thisVisit === true,
        previous: p.thisVisit !== true && (date === null || p.date < date),
      })),
      previousSymptoms: previous[0]
        ? {
            appointmentNo: previous[0].appointmentNo,
            date: previous[0].date,
            symptoms: (previous[0].data.symptoms as string[] | undefined) ?? [],
            severity: (previous[0].data.severity as Record<string, number> | undefined) ?? {},
          }
        : null,
    };
  },

  async previous(viewer: Viewer, id: string) {
    const consultation = await getConsultation(viewer, id);
    const date = consultation.appointment?.date ?? null;
    const rows = (await AppDataSource.query(
      `SELECT cs.section_key AS key, cs.data, c.id AS "consultationId", a.appointment_no AS "appointmentNo",
              to_char(a.date, 'YYYY-MM-DD') AS date, c.discuss_topics AS "discussTopics",
              c.major_complaint AS "majorComplaint", c.current_medications AS "currentMedications"
         FROM consultation_sections cs
         JOIN consultations c ON c.id = cs.consultation_id AND c.deleted_at IS NULL
         JOIN appointments a ON a.id = c.appointment_id AND a.deleted_at IS NULL
        WHERE c.patient_id = $1 AND c.id <> $2 AND cs.deleted_at IS NULL
          AND ($3::date IS NULL OR a.date <= $3::date)
        ORDER BY a.date DESC, a.time_from DESC
        LIMIT 300`,
      [consultation.patientId, id, date],
    )) as {
      key: SectionKey;
      data: Record<string, unknown>;
      consultationId: string;
      appointmentNo: number;
      date: string;
      discussTopics: string | null;
      majorComplaint: string | null;
      currentMedications: string | null;
    }[];
    const sections: Partial<Record<SectionKey, unknown[]>> = {};
    for (const row of rows) {
      const list = (sections[row.key] ??= []);
      if (list.length >= 20) continue;
      const shared =
        row.key === 'medical_history' || row.key === 'follow_up'
          ? {
              discussTopics: row.discussTopics,
              majorComplaint: row.majorComplaint,
              currentMedications: row.currentMedications,
            }
          : {};
      list.push({
        consultationId: row.consultationId,
        appointmentNo: row.appointmentNo,
        date: row.date,
        data: { ...row.data, ...shared },
      });
    }
    return { sections };
  },

  async open(actor: Actor, viewer: Viewer, appointmentId: string) {
    return withTransaction(async (em) => {
      const appointment = await getAppointmentRecord(viewer, appointmentId, em);
      const existing = await consultations.findOneBy(viewer.branchId, { appointmentId }, em);
      if (existing) return { created: false, consultation: await toDetail(viewer, existing.id, em) };
      const created = await consultations.create(
        viewer.branchId,
        actor.userId,
        {
          appointmentId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          status: 'open',
        },
        em,
      );
      await auditService.record(
        { actor, branchId: viewer.branchId, action: 'create', entity: 'consultation', entityId: created.id },
        em,
      );
      return { created: true, consultation: await toDetail(viewer, created.id, em) };
    });
  },

  async forAppointment(viewer: Viewer, appointmentId: string) {
    await getAppointmentRecord(viewer, appointmentId);
    const existing = await consultations.findOneBy(viewer.branchId, { appointmentId });
    if (!existing) throw AppError.notFound('Consultation');
    return toDetail(viewer, existing.id);
  },

  async saveSection(actor: Actor, viewer: Viewer, id: string, key: SectionKey, body: unknown) {
    const parsed = SECTION_SCHEMAS[key].safeParse(body);
    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((i) => ({
          path: `body.${i.path.join('.')}`,
          message: i.message,
          code: i.code,
        })),
      );
    }
    return withTransaction(async (em) => {
      const consultation = await getConsultation(viewer, id, em);
      const map = await sectionsOf(viewer.branchId, id, em);
      if (key === 'follow_up' && consultation.appointment?.visitType !== 'followup') {
        throw AppError.unprocessable('The follow up form is only for follow up appointments');
      }
      if (key === 'referral' && !availableSections(consultation, map).includes('referral')) {
        throw AppError.unprocessable('Tick "Referred to specialist" in the clinical assessment first');
      }

      const { patient, shared, data } = prepareData(key, parsed.data as Record<string, unknown>);
      if (Object.keys(patient).length > 0) {
        await patientsService.update(actor, viewer.branchId, consultation.patientId, patient as never, em);
      }
      if (Object.keys(shared).length > 0) {
        Object.assign(consultation, shared, { updatedBy: actor.userId });
        delete consultation.patient;
        delete consultation.doctor;
        delete consultation.appointment;
        await consultations.save(consultation, em);
      }

      const existing = map[key];
      const before = existing?.data ?? null;
      if (existing) {
        existing.data = data;
        existing.updatedBy = actor.userId;
        await sections.save(existing, em);
      } else {
        await sections.create(
          viewer.branchId,
          actor.userId,
          { consultationId: id, sectionKey: key, data },
          em,
        );
      }
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: `save_section:${key}`,
          entity: 'consultation',
          entityId: id,
          before,
          after: data,
        },
        em,
      );
      const detail = await toDetail(viewer, id, em);
      return { key, section: detail.sections[key], availableSections: detail.availableSections };
    });
  },

  async setStatus(actor: Actor, viewer: Viewer, id: string, status: ConsultationStatus) {
    return withTransaction(async (em) => {
      const consultation = await getConsultation(viewer, id, em);
      const before = consultation.status;
      consultation.status = status;
      consultation.updatedBy = actor.userId;
      delete consultation.patient;
      delete consultation.doctor;
      delete consultation.appointment;
      await consultations.save(consultation, em);
      if (consultation.appointmentId && before !== status) {
        const [from, to] = status === 'completed' ? ['booked', 'completed'] : ['completed', 'booked'];
        await em.query(
          `UPDATE appointments SET status = $3, updated_by = $4, updated_at = now()
            WHERE id = $1 AND status = $2 AND deleted_at IS NULL`,
          [consultation.appointmentId, from, to, actor.userId],
        );
      }
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'status',
          entity: 'consultation',
          entityId: id,
          before: { status: before },
          after: { status },
        },
        em,
      );
      return toDetail(viewer, id, em);
    });
  },

  async remove(actor: Actor, viewer: Viewer, id: string) {
    await withTransaction(async (em) => {
      const before = await toDetail(viewer, id, em);
      const consultation = await getConsultation(viewer, id, em);
      for (const row of Object.values(await sectionsOf(viewer.branchId, id, em))) {
        await sections.softDelete(row, actor.userId, em);
      }
      await consultations.softDelete(consultation, actor.userId, em);
      await auditService.record(
        { actor, branchId: viewer.branchId, action: 'delete', entity: 'consultation', entityId: id, before },
        em,
      );
    });
  },

  async referralLetter(viewer: Viewer, id: string) {
    const consultation = await getConsultation(viewer, id);
    const referral = (await sectionsOf(viewer.branchId, id)).referral;
    if (!referral) throw AppError.notFound('Referral');
    const company = await companyService.get().catch(() => null);
    return {
      company: company
        ? { name: company.name, phone: company.phone, email: company.email, logoPath: company.logoPath }
        : null,
      referral: referral.data,
      patient: {
        name: consultation.patient?.name ?? '',
        phone: consultation.patient?.phone ?? '',
        dateOfBirth: consultation.patient?.dateOfBirth ?? null,
      },
      doctor: consultation.doctor
        ? { id: consultation.doctor.id, name: consultation.doctor.displayName }
        : null,
    };
  },

  async mrsHistory(viewer: Viewer, patientId: string) {
    const qb = sections
      .query(viewer.branchId)
      .innerJoinAndSelect('s.consultation', 'c')
      .leftJoinAndSelect('c.appointment', 'appointment')
      .andWhere('c.patientId = :patientId', { patientId })
      .andWhere("s.sectionKey IN ('mrs_scale', 'additional_symptoms')");
    if (viewer.doctorId) qb.andWhere('c.doctorId = :doctorId', { doctorId: viewer.doctorId });
    const rows = await qb.getMany();
    const visits = new Map<
      string,
      {
        consultationId: string;
        date: string;
        scores: ReturnType<typeof mrsScores> | null;
        symptoms: { key: string; severity: number | null }[];
        otherSymptoms: string | null;
      }
    >();
    for (const r of rows) {
      const visit = visits.get(r.consultationId) ?? {
        consultationId: r.consultationId,
        date: r.consultation?.appointment?.date ?? r.createdAt.toISOString().slice(0, 10),
        scores: null,
        symptoms: [],
        otherSymptoms: null,
      };
      if (r.sectionKey === 'mrs_scale') {
        visit.scores = mrsScores(r.data);
        if (typeof r.data.date === 'string') visit.date = r.data.date;
      } else {
        const ticked = Array.isArray(r.data.symptoms) ? (r.data.symptoms as string[]) : [];
        const severity = (r.data.severity ?? {}) as Record<string, number>;
        visit.symptoms = ticked.map((key) => ({ key, severity: severity[key] ?? null }));
        visit.otherSymptoms = typeof r.data.other === 'string' && r.data.other ? r.data.other : null;
      }
      visits.set(r.consultationId, visit);
    }
    return [...visits.values()].sort((a, b) => a.date.localeCompare(b.date));
  },

  async timelineEntries(branchId: string | null, patientId: string, doctorId: string | null) {
    const qb = repo(Consultation)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.doctor', 'doctor')
      .leftJoinAndSelect('c.appointment', 'appointment')
      .leftJoinAndSelect('c.sections', 'section')
      .where('c.patientId = :patientId', { patientId });
    if (branchId) qb.andWhere('c.branchId = :branchId', { branchId });
    if (doctorId) qb.andWhere('c.doctorId = :doctorId', { doctorId });
    const rows = await qb.orderBy('appointment.date', 'DESC').getMany();
    return rows.map((c) => ({
      ...toSummary(c),
      sections: Object.fromEntries(
        (c.sections ?? []).map((s) => [s.sectionKey, sectionView(c, s.sectionKey, s)]),
      ),
    }));
  },
};
