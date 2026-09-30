import { type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { AppError } from '../../lib/errors';
import { type Viewer } from '../doctors/doctors.service';
import { Appointment } from './appointment.entity';

export const appointments = branchScopedRepository(Appointment, 'a');

export function visibleTo<T extends SelectQueryBuilder<Appointment>>(qb: T, viewer: Viewer): T {
  if (viewer.doctorId) qb.andWhere('a.doctorId = :viewerDoctorId', { viewerDoctorId: viewer.doctorId });
  return qb;
}

export function appointmentsWithParties(viewer: Viewer, manager?: EntityManager) {
  return visibleTo(
    appointments
      .query(viewer.branchId, manager)
      .leftJoinAndSelect('a.patient', 'patient')
      .leftJoinAndSelect('a.doctor', 'doctor'),
    viewer,
  );
}

export async function getAppointmentRecord(viewer: Viewer, id: string, manager?: EntityManager) {
  const record = await visibleTo(appointments.query(viewer.branchId, manager), viewer)
    .andWhere('a.id = :id', { id })
    .getOne();
  if (!record) throw AppError.notFound('Appointment');
  return record;
}
