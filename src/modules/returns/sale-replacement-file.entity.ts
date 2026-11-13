import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { SaleReplacement } from './sale-replacement.entity';

@Entity('sale_replacement_files')
export class SaleReplacementFile extends BranchScopedEntity {
  @Index()
  @Column({ name: 'sale_replacement_id', type: 'uuid' })
  saleReplacementId: string;

  @ManyToOne(() => SaleReplacement, (r) => r.files, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_replacement_id' })
  replacement?: SaleReplacement;

  @Column({ name: 'file_path', type: 'text' })
  filePath: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'integer', default: 0 })
  sizeBytes: number;
}
