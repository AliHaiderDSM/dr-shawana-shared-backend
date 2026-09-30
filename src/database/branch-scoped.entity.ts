import { Column, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Branch } from '../modules/branches/branch.entity';
import { BaseEntity } from './base.entity';

export abstract class BranchScopedEntity extends BaseEntity {
  @Index()
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;
}
