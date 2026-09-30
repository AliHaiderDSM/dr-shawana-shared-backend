import { type Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { StaffProfile } from '../staff/staff-profile.entity';

export const DOCTOR_STATUSES = ['active', 'inactive'] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

@Entity('doctors')
@Index('UQ_doctors_staff', ['staffId'], { unique: true, where: `"deleted_at" IS NULL` })
export class Doctor extends BranchScopedEntity {
  @Column({ name: 'staff_id', type: 'uuid' })
  staffId: string;

  @ManyToOne(() => StaffProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'staff_id' })
  staff?: StaffProfile;

  @Index()
  @Column({ name: 'display_name', type: 'varchar', length: 150 })
  displayName: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ name: 'consultation_fee', ...moneyColumn({ default: '0' }) })
  consultationFee: Decimal;

  @Column({ name: 'commission_percent', type: 'numeric', precision: 5, scale: 2, default: 3 })
  commissionPercent: string;

  @Column({ name: 'signature_path', type: 'text', nullable: true })
  signaturePath: string | null;

  @Index()
  @Column({ type: 'enum', enum: DOCTOR_STATUSES, enumName: 'doctor_status', default: 'active' })
  status: DoctorStatus;
}
