import { Column, Entity } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

@Entity('expense_categories')
export class ExpenseCategory extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;
}
