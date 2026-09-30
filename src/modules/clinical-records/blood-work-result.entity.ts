import { type Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Consultation } from '../consultations/consultation.entity';
import { Patient } from '../patients/patient.entity';

export const BLOOD_TESTS = [
  'fsh',
  'estradiol',
  'testosterone_free',
  'testosterone_total',
  'dhea_s',
  'vit_d3',
  'tsh',
  'ferritin',
  'b12',
] as const;
export type BloodTest = (typeof BLOOD_TESTS)[number];

@Entity('blood_work_results')
@Index(['patientId', 'test', 'testDate'])
export class BloodWorkResult extends BranchScopedEntity {
  @Index()
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Patient;

  @Index()
  @Column({ name: 'consultation_id', type: 'uuid', nullable: true })
  consultationId: string | null;

  @ManyToOne(() => Consultation, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'consultation_id' })
  consultation?: Consultation | null;

  @Column({ type: 'enum', enum: BLOOD_TESTS, enumName: 'blood_test' })
  test: BloodTest;

  @Column(quantityColumn())
  value: Decimal;

  @Column({ type: 'varchar', length: 20 })
  unit: string;

  @Column({ name: 'test_date', type: 'date' })
  testDate: string;
}
