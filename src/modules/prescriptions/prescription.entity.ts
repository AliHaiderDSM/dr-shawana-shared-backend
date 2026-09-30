import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Consultation } from '../consultations/consultation.entity';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { PrescriptionItem } from './prescription-item.entity';

export const TEMPLATE_VERSIONS = ['current', 'previous'] as const;
export type TemplateVersion = (typeof TEMPLATE_VERSIONS)[number];

export interface PrescriptionNotes {
  blood?: string | null;
  imaging?: string | null;
  supplements?: string | null;
  skinCare?: string | null;
  hairCare?: string | null;
}

@Entity('prescriptions')
@Index('UQ_prescriptions_number', ['prescriptionNo'], { unique: true })
export class Prescription extends BranchScopedEntity {
  @Column({ name: 'prescription_no', type: 'integer' })
  @Generated('increment')
  prescriptionNo: number;

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

  @Index()
  @Column({ name: 'consultation_id', type: 'uuid', nullable: true })
  consultationId: string | null;

  @ManyToOne(() => Consultation, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'consultation_id' })
  consultation?: Consultation | null;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text' })
  diagnosis: string;

  @Column({ type: 'jsonb' })
  notes: PrescriptionNotes;

  @Column({ name: 'plan_treatment', type: 'text', nullable: true })
  planTreatment: string | null;

  @Column({ name: 'followup_date', type: 'date', nullable: true })
  followupDate: string | null;

  @Column({
    name: 'template_version',
    type: 'enum',
    enum: TEMPLATE_VERSIONS,
    enumName: 'prescription_template_version',
    default: 'current',
  })
  templateVersion: TemplateVersion;

  @OneToMany(() => PrescriptionItem, (item) => item.prescription)
  items?: PrescriptionItem[];
}
