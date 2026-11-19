import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';

@Entity('treatment_plans')
export class TreatmentPlan extends BranchScopedEntity {
  @Index()
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id', foreignKeyConstraintName: 'FK_treatment_plans_patient' })
  patient?: Patient;

  @Index()
  @Column({ name: 'doctor_id', type: 'uuid' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'doctor_id', foreignKeyConstraintName: 'FK_treatment_plans_doctor' })
  doctor?: Doctor;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text' })
  plan: string;
}
