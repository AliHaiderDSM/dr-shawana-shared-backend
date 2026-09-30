import { Column, Entity, Index } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

@Entity('banks')
@Index('UQ_banks_branch_name', { synchronize: false })
export class Bank extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;
}
