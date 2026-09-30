import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Appointment } from '../appointments/appointment.entity';
import { Patient } from '../patients/patient.entity';

export const BHRT_LOG_STATUSES = ['on', 'off', 'recommended', 'other'] as const;
export type BhrtLogStatus = (typeof BHRT_LOG_STATUSES)[number];

@Entity('bhrt_status_log')
export class BhrtStatusLog extends BranchScopedEntity {
  @Index()
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient;

  @Index()
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId: string | null;

  @ManyToOne(() => Appointment, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment | null;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: BHRT_LOG_STATUSES, enumName: 'bhrt_log_status' })
  status: BhrtLogStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
