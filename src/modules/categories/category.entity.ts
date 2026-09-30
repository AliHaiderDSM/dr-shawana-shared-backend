import { Column, Entity, Index } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

@Entity('categories')
@Index('UQ_categories_branch_name', { synchronize: false })
export class Category extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'image_path', type: 'text', nullable: true })
  imagePath: string | null;
}
