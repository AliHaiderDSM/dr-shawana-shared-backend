import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
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
  mrsScores,
  PATIENT_FIELDS_BY_SECTION,
  SECTION_SCHEMAS,
  SHARED_TOPIC_FIELDS,
} from './section-schemas';

const consultations = branchScopedRepository(Consultation, 'c');
const sections = branchScopedRepository(ConsultationSection, 's');

type SectionMap = Partial<Record<SectionKey, ConsultationSection>>;

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
  if (key === 'medical_history' || key === 'follow_up') {
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

  get: (viewer: Viewer, id: string) => toDetail(viewer, id),

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
      .innerJoin('s.consultation', 'c')
      .andWhere('c.patientId = :patientId', { patientId })
      .andWhere("s.sectionKey = 'mrs_scale'");
    if (viewer.doctorId) qb.andWhere('c.doctorId = :doctorId', { doctorId: viewer.doctorId });
    const rows = await qb.getMany();
    return rows
      .map((r) => ({
        consultationId: r.consultationId,
        date: r.data.date as string,
        scores: mrsScores(r.data),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
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
