import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../database/base.entity';

export const BRANCH_STATUSES = ['active', 'inactive'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const BRANCH_KINDS = ['branch', 'warehouse'] as const;
export type BranchKind = (typeof BRANCH_KINDS)[number];

@Entity('branches')
@Check('CHK_branches_code_format', `"code" ~ '^[A-Z0-9]{2,10}$'`)
@Index('UQ_branches_code', ['code'], { unique: true, where: '"deleted_at" IS NULL' })
@Index('UQ_branches_single_warehouse', ['kind'], {
  unique: true,
  where: `"kind" = 'warehouse' AND "deleted_at" IS NULL`,
})
export class Branch extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ name: 'logo_path', type: 'text', nullable: true })
  logoPath: string | null;

  @Column({ type: 'enum', enum: BRANCH_KINDS, enumName: 'branch_kind', default: 'branch' })
  kind: BranchKind;

  @Index()
  @Column({ type: 'enum', enum: BRANCH_STATUSES, enumName: 'branch_status', default: 'active' })
  status: BranchStatus;
}
