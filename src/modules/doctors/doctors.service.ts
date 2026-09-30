import { type EntityManager } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { repo, withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { paginate } from '../../lib/pagination';
import { BUCKETS, createSignedUrl, replaceFile } from '../../lib/storage';
import { Appointment } from '../appointments/appointment.entity';
import { auditService } from '../audit/audit.service';
import { type StaffProfile } from '../staff/staff-profile.entity';
import { assertCanManage, getInBranch as getStaffInBranch, staffService } from '../staff/staff.service';
import { Doctor } from './doctor.entity';
import { type CreateDoctorInput, type DoctorListQuery, type UpdateDoctorInput } from './doctors.schemas';

export interface Viewer {
  branchId: string;
  doctorId: string | null;
}

const doctors = branchScopedRepository(Doctor, 'doc');

export function toDoctorDto(doctor: Doctor) {
  const { staff, signaturePath, ...rest } = withoutInternals(doctor);
  return {
    ...rest,
    hasSignature: signaturePath !== null,
    staff: staff
      ? { id: staff.id, username: staff.username, email: staff.email, status: staff.status }
      : null,
  };
}

function withStaff(branchId: string, manager?: EntityManager) {
  return doctors.query(branchId, manager).leftJoinAndSelect('doc.staff', 'staff');
}

async function getDoctor(branchId: string, id: string, manager?: EntityManager) {
  const doctor = await withStaff(branchId, manager).andWhere('doc.id = :id', { id }).getOne();
  if (!doctor) throw AppError.notFound('Doctor');
  return doctor;
}

async function assertStaffLinkable(branchId: string, staff: StaffProfile, manager: EntityManager) {
  if (staff.role !== 'doctor')
    throw AppError.badRequest('The selected staff member does not have the doctor role');
  const existing = await doctors.findOneBy(branchId, { staffId: staff.id }, manager);
  if (existing) throw AppError.conflict('This staff member already has a doctor profile');
}

async function insertDoctor(
  manager: EntityManager,
  actor: Actor,
  branchId: string,
  staff: StaffProfile,
  input: CreateDoctorInput,
) {
  const { staffId: _staffId, account: _account, ...fields } = input;
  const doctor = await doctors.create(
    branchId,
    actor.userId,
    {
      ...fields,
      staffId: staff.id,
      displayName: fields.displayName ?? `${staff.firstName} ${staff.lastName}`,
      phone: fields.phone ?? staff.phone,
      email: fields.email ?? staff.email,
    } as Partial<Doctor>,
    manager,
  );
  const dto = toDoctorDto(await getDoctor(branchId, doctor.id, manager));
  await auditService.record(
    { actor, branchId, action: 'create', entity: 'doctor', entityId: doctor.id, after: dto },
    manager,
  );
  return dto;
}

export const doctorsService = {
  async list(branchId: string, query: DoctorListQuery) {
    const qb = withStaff(branchId);
    if (query.status) qb.andWhere('doc.status = :status', { status: query.status });
    const { items, meta } = await paginate(qb, query, {
      searchColumns: ['doc.displayName', 'doc.phone', 'doc.email', 'staff.username'],
      sortMap: { displayName: 'doc.displayName', createdAt: 'doc.createdAt' },
    });
    return { items: items.map(toDoctorDto), meta };
  },

  async options(branchId: string) {
    const rows = await doctors
      .query(branchId)
      .andWhere("doc.status = 'active'")
      .orderBy('doc.displayName', 'ASC')
      .getMany();
    return rows.map((d) => ({
      id: d.id,
      name: d.displayName,
      phone: d.phone,
      consultationFee: d.consultationFee,
    }));
  },

  async get(branchId: string, id: string) {
    return toDoctorDto(await getDoctor(branchId, id));
  },

  async create(actor: Actor, branchId: string, input: CreateDoctorInput) {
    if (input.account) {
      assertCanManage(actor, 'doctor');
      let created: ReturnType<typeof toDoctorDto> | undefined;
      await staffService.createAccount(
        actor,
        branchId,
        { ...input.account, role: 'doctor' },
        async (em, staff) => {
          created = await insertDoctor(em, actor, branchId, staff, input);
        },
      );
      return created;
    }
    return withTransaction(async (em) => {
      const staff = await getStaffInBranch(branchId, input.staffId as string, em);
      await assertStaffLinkable(branchId, staff, em);
      return insertDoctor(em, actor, branchId, staff, input);
    });
  },

  async update(actor: Actor, branchId: string, id: string, input: UpdateDoctorInput) {
    return withTransaction(async (em) => {
      const doctor = await getDoctor(branchId, id, em);
      const before = toDoctorDto(doctor);
      Object.assign(doctor, input, { updatedBy: actor.userId });
      delete doctor.staff;
      await doctors.save(doctor, em);
      const after = toDoctorDto(await getDoctor(branchId, id, em));
      await auditService.record(
        { actor, branchId, action: 'update', entity: 'doctor', entityId: id, before, after },
        em,
      );
      return after;
    });
  },

  async remove(actor: Actor, branchId: string, id: string) {
    await withTransaction(async (em) => {
      const doctor = await getDoctor(branchId, id, em);
      await doctors.softDelete(doctor, actor.userId, em);
      await auditService.record(
        { actor, branchId, action: 'delete', entity: 'doctor', entityId: id, before: toDoctorDto(doctor) },
        em,
      );
    });
  },

  async setSignature(actor: Actor, branchId: string, id: string, file: Express.Multer.File) {
    const doctor = await getDoctor(branchId, id);
    const { path } = await replaceFile(
      {
        bucket: BUCKETS.doctorSignatures,
        prefix: `${branchId}/${id}`,
        originalName: file.originalname,
        buffer: file.buffer,
        contentType: file.mimetype,
      },
      doctor.signaturePath,
    );
    doctor.signaturePath = path;
    doctor.updatedBy = actor.userId;
    delete doctor.staff;
    await doctors.save(doctor);
    await auditService.record({ actor, branchId, action: 'set_signature', entity: 'doctor', entityId: id });
    return toDoctorDto(await getDoctor(branchId, id));
  },

  async signatureUrl(branchId: string, id: string) {
    const doctor = await getDoctor(branchId, id);
    if (!doctor.signaturePath) throw AppError.notFound('Signature');
    return createSignedUrl(BUCKETS.doctorSignatures, doctor.signaturePath);
  },

  async forStaff(branchId: string, staffId: string, manager?: EntityManager) {
    return doctors.findOneBy(branchId, { staffId }, manager);
  },

  async me(actor: Actor, branchId: string) {
    const doctor = await this.forStaff(branchId, actor.userId);
    if (!doctor) throw AppError.notFound('Doctor profile');
    return toDoctorDto(await getDoctor(branchId, doctor.id));
  },

  async viewer(actor: Actor, branchId: string): Promise<Viewer> {
    if (actor.role !== 'doctor') return { branchId, doctorId: null };
    const doctor = await this.forStaff(branchId, actor.userId);
    if (!doctor) throw AppError.forbidden('No doctor profile is linked to your account');
    return { branchId, doctorId: doctor.id };
  },

  async lockBookable(branchId: string, id: string, manager: EntityManager) {
    const doctor = await doctors
      .query(branchId, manager)
      .andWhere('doc.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!doctor) throw AppError.notFound('Doctor');
    if (doctor.status !== 'active') throw AppError.badRequest('This doctor is inactive and cannot be booked');
    return doctor;
  },

  async slots(viewer: Viewer, doctorId: string, date: string) {
    if (viewer.doctorId && viewer.doctorId !== doctorId) throw AppError.notFound('Doctor');
    await getDoctor(viewer.branchId, doctorId);
    const rows = await repo(Appointment)
      .createQueryBuilder('a')
      .where('a.branchId = :branchId', { branchId: viewer.branchId })
      .andWhere('a.doctorId = :doctorId', { doctorId })
      .andWhere('a.date = :date', { date })
      .orderBy('a.timeFrom', 'ASC')
      .getMany();
    return rows.map((a) => ({
      appointmentId: a.id,
      appointmentNo: a.appointmentNo,
      timeFrom: a.timeFrom,
      timeTo: a.timeTo,
      status: a.status,
    }));
  },
};
