import { randomUUID } from 'node:crypto';
import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { escapeLike, paginate } from '../../lib/pagination';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { auditService } from '../audit/audit.service';
import { companyService } from '../company/company.service';
import { Consultation } from '../consultations/consultation.entity';
import { Doctor } from '../doctors/doctor.entity';
import { type Viewer } from '../doctors/doctors.service';
import { patientsService } from '../patients/patients.service';
import { CATALOG_SEED } from './catalog-seed';
import {
  PRESCRIPTION_CATEGORIES,
  PrescriptionCatalogItem,
  type PrescriptionCategory,
} from './prescription-catalog-item.entity';
import { PrescriptionItem } from './prescription-item.entity';
import { Prescription, type PrescriptionNotes } from './prescription.entity';
import {
  type CatalogQuery,
  type CreateCatalogItemInput,
  type CreatePrescriptionInput,
  type PrescriptionItemInput,
  type PrescriptionListQuery,
  type UpdateCatalogItemInput,
  type UpdatePrescriptionInput,
} from './prescriptions.schemas';

const catalog = branchScopedRepository(PrescriptionCatalogItem, 'cat');
const prescriptions = branchScopedRepository(Prescription, 'rx');
const items = branchScopedRepository(PrescriptionItem, 'item');

const NOTE_BY_CATEGORY: Partial<Record<PrescriptionCategory, keyof PrescriptionNotes>> = {
  lab: 'blood',
  imaging: 'imaging',
  supplement: 'supplements',
  skin_care: 'skinCare',
  hair_care: 'hairCare',
};

const toCatalogDto = (c: PrescriptionCatalogItem) => ({
  id: c.id,
  code: c.code,
  category: c.category,
  groupName: c.groupName,
  name: c.name,
  defaultDose: c.defaultDose,
  defaultInstructions: c.defaultInstructions,
  productId: c.productId,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
});

const toItemDto = (i: PrescriptionItem) => ({
  id: i.id,
  catalogItemId: i.catalogItemId,
  category: i.category,
  groupName: i.groupName,
  name: i.name,
  dose: i.dose,
  instructions: i.instructions,
  optional: i.optional,
  sortOrder: i.sortOrder,
});

function toPrescriptionDto(rx: Prescription) {
  return {
    id: rx.id,
    prescriptionNo: rx.prescriptionNo,
    branchId: rx.branchId,
    patientId: rx.patientId,
    patient: rx.patient ? { id: rx.patient.id, name: rx.patient.name, phone: rx.patient.phone } : null,
    doctorId: rx.doctorId,
    doctor: rx.doctor ? { id: rx.doctor.id, name: rx.doctor.displayName } : null,
    consultationId: rx.consultationId,
    date: rx.date,
    diagnosis: rx.diagnosis,
    notes: rx.notes,
    planTreatment: rx.planTreatment,
    followupDate: rx.followupDate,
    templateVersion: rx.templateVersion,
    items: [...(rx.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(toItemDto),
    createdBy: rx.createdBy,
    createdAt: rx.createdAt,
    updatedAt: rx.updatedAt,
  };
}

function scoped(viewer: Viewer, manager?: EntityManager) {
  const qb = prescriptions
    .query(viewer.branchId, manager)
    .leftJoinAndSelect('rx.patient', 'patient')
    .leftJoinAndSelect('rx.doctor', 'doctor');
  if (viewer.doctorId) qb.andWhere('rx.doctorId = :viewerDoctorId', { viewerDoctorId: viewer.doctorId });
  return qb;
}

async function getPrescription(viewer: Viewer, id: string, manager?: EntityManager) {
  const rx = await scoped(viewer, manager)
    .leftJoinAndSelect('rx.items', 'item', 'item.deletedAt IS NULL')
    .andWhere('rx.id = :id', { id })
    .getOne();
  if (!rx) throw AppError.notFound('Prescription');
  return rx;
}

async function getCatalogItem(branchId: string, id: string, manager?: EntityManager) {
  const item = await catalog.findById(branchId, id, manager);
  if (!item) throw AppError.notFound('Catalog item');
  return item;
}

async function resolveItems(branchId: string, inputs: PrescriptionItemInput[], manager: EntityManager) {
  const ids = inputs.map((i) => i.catalogItemId).filter((id): id is string => Boolean(id));
  const found = await catalog.findByIds(branchId, ids, manager);
  const byId = new Map(found.map((c) => [c.id, c]));
  return inputs.map((input, index) => {
    const source = input.catalogItemId ? byId.get(input.catalogItemId) : undefined;
    if (input.catalogItemId && !source) {
      throw AppError.badRequest(`Item ${index + 1}: the catalog item was not found in this branch`);
    }
    if (source && !source.isActive)
      throw AppError.badRequest(`Item ${index + 1}: "${source.name}" is no longer offered`);
    return {
      catalogItemId: source?.id ?? null,
      category: (input.category ?? source?.category) as PrescriptionCategory,
      groupName: input.groupName ?? source?.groupName ?? 'Other',
      name: input.name ?? (source?.name as string),
      dose: input.dose !== undefined ? input.dose : (source?.defaultDose ?? null),
      instructions:
        input.instructions !== undefined ? input.instructions : (source?.defaultInstructions ?? null),
      optional: input.optional ?? false,
      sortOrder: source?.sortOrder ?? 100000 + index,
    };
  });
}

async function insertItems(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  prescriptionId: string,
  inputs: PrescriptionItemInput[],
) {
  for (const item of await resolveItems(branchId, inputs, manager)) {
    await items.create(branchId, actor.userId, { ...item, prescriptionId }, manager);
  }
}

async function resolveParties(viewer: Viewer, input: CreatePrescriptionInput, manager: EntityManager) {
  let patientId = input.patientId;
  let doctorId = input.doctorId ?? viewer.doctorId ?? undefined;
  if (input.consultationId) {
    const consultation = await repo(Consultation, manager).findOne({
      where: { id: input.consultationId, branchId: viewer.branchId },
    });
    if (!consultation) throw AppError.badRequest('The consultation was not found in this branch');
    if (patientId && patientId !== consultation.patientId) {
      throw AppError.badRequest('The consultation belongs to another patient');
    }
    patientId = consultation.patientId;
    doctorId = input.doctorId ?? consultation.doctorId;
  }
  if (!doctorId) throw AppError.badRequest('Select the doctor');
  if (viewer.doctorId && doctorId !== viewer.doctorId) {
    throw AppError.forbidden('Doctors can only write their own prescriptions');
  }
  const doctor = await repo(Doctor, manager).findOne({ where: { id: doctorId, branchId: viewer.branchId } });
  if (!doctor) throw AppError.badRequest('The doctor was not found in this branch');
  await patientsService.require(patientId as string, manager);
  return { patientId: patientId as string, doctorId };
}

export const catalogService = {
  async seedBranch(branchId: string, manager?: EntityManager) {
    const repository = repo(PrescriptionCatalogItem, manager);
    const existing = new Set(
      (await repository.find({ where: { branchId }, withDeleted: true, select: { code: true } })).map(
        (c) => c.code,
      ),
    );
    const missing = CATALOG_SEED.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 })).filter(
      (item) => !existing.has(item.code),
    );
    if (missing.length > 0) await repository.insert(missing.map((item) => ({ ...item, branchId })));
    return missing.length;
  },

  async list(branchId: string, query: CatalogQuery) {
    const qb = catalog.query(branchId);
    if (!query.includeInactive) qb.andWhere('cat.isActive = true');
    if (query.category) qb.andWhere('cat.category = :category', { category: query.category });
    const rows = await qb.orderBy('cat.sortOrder', 'ASC').addOrderBy('cat.name', 'ASC').getMany();
    return rows.map(toCatalogDto);
  },

  async create(actor: Actor, branchId: string, input: CreateCatalogItemInput) {
    const max = await catalog
      .query(branchId)
      .select('COALESCE(MAX(cat.sortOrder), 0)', 'max')
      .getRawOne<{ max: number }>();
    const item = await catalog.create(branchId, actor.userId, {
      ...input,
      code: `custom-${randomUUID()}`,
      sortOrder: input.sortOrder ?? Number(max?.max ?? 0) + 10,
      isActive: input.isActive ?? true,
    });
    return toCatalogDto(item);
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateCatalogItemInput) {
    const item = await getCatalogItem(branchId, id);
    Object.assign(item, input, { updatedBy: actor.userId });
    return toCatalogDto(await catalog.save(item));
  },

  async remove(actor: Actor, branchId: string, id: string) {
    const item = await getCatalogItem(branchId, id);
    await catalog.softDelete(item, actor.userId);
  },
};

export const prescriptionsService = {
  async list(viewer: Viewer, query: PrescriptionListQuery) {
    const qb = scoped(viewer).leftJoinAndSelect('rx.items', 'item', 'item.deletedAt IS NULL');
    if (query.patientId) qb.andWhere('rx.patientId = :patientId', { patientId: query.patientId });
    if (query.doctorId) qb.andWhere('rx.doctorId = :doctorId', { doctorId: query.doctorId });
    if (query.consultationId) qb.andWhere('rx.consultationId = :cid', { cid: query.consultationId });
    if (query.templateVersion) qb.andWhere('rx.templateVersion = :tv', { tv: query.templateVersion });
    if (query.from) qb.andWhere('rx.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('rx.date <= :to', { to: query.to });
    if (query.search) {
      qb.andWhere(
        `(CONCAT('PRE#', rx.prescriptionNo) ILIKE :term OR patient.name ILIKE :term OR patient.phone ILIKE :term)`,
        {
          term: `%${escapeLike(query.search)}%`,
        },
      );
    }
    const { items: rows, meta } = await paginate(
      qb,
      { ...query, search: undefined },
      { sortMap: { date: 'rx.date', createdAt: 'rx.createdAt', prescriptionNo: 'rx.prescriptionNo' } },
    );
    return { items: rows.map(toPrescriptionDto), meta };
  },

  async get(viewer: Viewer, id: string) {
    return toPrescriptionDto(await getPrescription(viewer, id));
  },

  async create(actor: Actor, viewer: Viewer, input: CreatePrescriptionInput) {
    return withTransaction(async (em) => {
      const { patientId, doctorId } = await resolveParties(viewer, input, em);
      const rx = await prescriptions.create(
        viewer.branchId,
        actor.userId,
        {
          patientId,
          doctorId,
          consultationId: input.consultationId ?? null,
          date: input.date ?? today(),
          diagnosis: input.diagnosis,
          notes: input.notes,
          planTreatment: input.planTreatment ?? null,
          followupDate: input.followupDate ?? null,
          templateVersion: 'current',
        },
        em,
      );
      await insertItems(em, actor, viewer.branchId, rx.id, input.items);
      const dto = toPrescriptionDto(await getPrescription(viewer, rx.id, em));
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'create',
          entity: 'prescription',
          entityId: rx.id,
          after: dto,
        },
        em,
      );
      return dto;
    });
  },

  async update(actor: Actor, viewer: Viewer, id: string, input: UpdatePrescriptionInput) {
    return withTransaction(async (em) => {
      const rx = await getPrescription(viewer, id, em);
      const before = toPrescriptionDto(rx);
      const { items: newItems, ...fields } = input;
      if (newItems) {
        for (const old of rx.items ?? []) await items.softDelete(old, actor.userId, em);
        await insertItems(em, actor, viewer.branchId, id, newItems);
      }
      Object.assign(rx, fields, { updatedBy: actor.userId });
      delete rx.items;
      delete rx.patient;
      delete rx.doctor;
      await prescriptions.save(rx, em);
      const after = toPrescriptionDto(await getPrescription(viewer, id, em));
      await auditService.record(
        {
          actor,
          branchId: viewer.branchId,
          action: 'update',
          entity: 'prescription',
          entityId: id,
          before,
          after,
        },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, viewer: Viewer, id: string) {
    await withTransaction(async (em) => {
      const rx = await getPrescription(viewer, id, em);
      const before = toPrescriptionDto(rx);
      for (const item of rx.items ?? []) await items.softDelete(item, actor.userId, em);
      await prescriptions.softDelete(rx, actor.userId, em);
      await auditService.record(
        { actor, branchId: viewer.branchId, action: 'delete', entity: 'prescription', entityId: id, before },
        em,
      );
    });
  },

  async print(viewer: Viewer, id: string) {
    const rx = await getPrescription(viewer, id);
    const patient = await patientsService.require(rx.patientId);
    const doctor = rx.doctor;
    const company = await companyService.get().catch(() => null);
    const signatureUrl = doctor?.signaturePath
      ? ((await createSignedUrl(BUCKETS.doctorSignatures, doctor.signaturePath).catch(() => null))?.url ??
        null)
      : null;
    const dto = toPrescriptionDto(rx);
    const sections = PRESCRIPTION_CATEGORIES.map((category) => {
      const inCategory = dto.items.filter((i) => i.category === category);
      const groups = [...new Set(inCategory.map((i) => i.groupName))].map((groupName) => ({
        groupName,
        items: inCategory.filter((i) => i.groupName === groupName),
      }));
      const noteKey = NOTE_BY_CATEGORY[category];
      return { category, note: noteKey ? (rx.notes[noteKey] ?? null) : null, groups };
    }).filter((s) => s.groups.length > 0 || s.note);
    const { items: _items, ...prescription } = dto;
    return {
      company: company ? { name: company.name, phone: company.phone, logoPath: company.logoPath } : null,
      doctor: {
        name: doctor?.displayName ?? '',
        phone: doctor?.phone ?? null,
        details: doctor?.details ?? null,
        signatureUrl,
      },
      patient: {
        name: patient.name,
        phone: patient.phone,
        age: patient.age,
        city: patient.city,
        country: patient.country,
      },
      prescription,
      sections,
    };
  },

  async timeline(branchId: string | null, patientId: string, doctorId: string | null) {
    const where = {
      patientId,
      ...(branchId ? { branchId } : {}),
      ...(doctorId ? { doctorId } : {}),
    };
    const rows = await repo(Prescription).find({
      where,
      relations: { doctor: true, items: true },
      order: { date: 'DESC' },
    });
    return rows.map(toPrescriptionDto);
  },
};
