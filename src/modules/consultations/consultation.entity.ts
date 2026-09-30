import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Appointment } from '../appointments/appointment.entity';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { ConsultationSection } from './consultation-section.entity';

export const CONSULTATION_STATUSES = ['open', 'completed'] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

@Entity('consultations')
@Index('UQ_consultations_appointment', ['appointmentId'], { unique: true, where: `"deleted_at" IS NULL` })
export class Consultation extends BranchScopedEntity {
  @Index()
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient;

  @Index()
  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  @ManyToOne(() => Appointment, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment;

  @Index()
  @Column({ type: 'enum', enum: CONSULTATION_STATUSES, enumName: 'consultation_status', default: 'open' })
  status: ConsultationStatus;

  @Column({ name: 'discuss_topics', type: 'text', nullable: true })
  discussTopics: string | null;

  @Column({ name: 'major_complaint', type: 'text', nullable: true })
  majorComplaint: string | null;

  @Column({ name: 'current_medications', type: 'text', nullable: true })
  currentMedications: string | null;

  @OneToMany(() => ConsultationSection, (section) => section.consultation)
  sections?: ConsultationSection[];
}
