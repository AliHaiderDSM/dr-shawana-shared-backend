import { Column, Entity, Index } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

@Entity('material_categories')
@Index('UQ_material_categories_branch_name', { synchronize: false })
export class MaterialCategory extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;
}
