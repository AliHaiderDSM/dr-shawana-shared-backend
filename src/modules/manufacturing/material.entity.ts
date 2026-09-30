import { type Decimal } from 'decimal.js';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { MaterialCategory } from './material-category.entity';

@Entity('materials')
export class Material extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Index()
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => MaterialCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: MaterialCategory;

  @Column({ type: 'varchar', length: 30, default: 'g' })
  unit: string;

  @Column(quantityColumn({ default: '0' }))
  minimum: Decimal;

  @Column({ name: 'bare_minimum', ...quantityColumn({ default: '0' }) })
  bareMinimum: Decimal;
}
