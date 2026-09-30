import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Appointment } from '../appointments/appointment.entity';
import { Patient } from '../patients/patient.entity';
import { MedicalRecordFile } from './medical-record-file.entity';

export const MEDICAL_RECORD_TYPES = ['medical_record', 'imaging'] as const;
export type MedicalRecordType = (typeof MEDICAL_RECORD_TYPES)[number];

@Entity('medical_records')
export class MedicalRecord extends BranchScopedEntity {
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
  @Column({
    type: 'enum',
    enum: MEDICAL_RECORD_TYPES,
    enumName: 'medical_record_type',
    default: 'medical_record',
  })
  type: MedicalRecordType;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  status: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @OneToMany(() => MedicalRecordFile, (file) => file.medicalRecord)
  files?: MedicalRecordFile[];
}
