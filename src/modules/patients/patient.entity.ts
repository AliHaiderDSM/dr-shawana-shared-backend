import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';
import { Branch } from '../branches/branch.entity';

export const BHRT_STATUSES = ['none', 'on', 'off', 'recommended'] as const;
export type BhrtStatus = (typeof BHRT_STATUSES)[number];

@Entity('patients')
@Index('UQ_patients_phone_last9', ['phoneLast9'], { unique: true, where: `"deleted_at" IS NULL` })
@Check('CHK_patients_age', `"age" IS NULL OR ("age" >= 0 AND "age" <= 150)`)
export class Patient extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  phone: string;

  @Index()
  @Column({ name: 'phone_normalized', type: 'varchar', length: 20 })
  phoneNormalized: string;

  @Column({ name: 'phone_last9', type: 'varchar', length: 9 })
  phoneLast9: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'smallint', nullable: true })
  age: number | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Index()
  @Column({
    name: 'bhrt_status',
    type: 'enum',
    enum: BHRT_STATUSES,
    enumName: 'bhrt_status',
    default: 'none',
  })
  bhrtStatus: BhrtStatus;

  @Index()
  @Column({ name: 'created_in_branch_id', type: 'uuid', nullable: true })
  createdInBranchId: string | null;

  @ManyToOne(() => Branch, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_in_branch_id' })
  createdInBranch?: Branch | null;
}
