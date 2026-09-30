import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import {
  PrescriptionCatalogItem,
  PRESCRIPTION_CATEGORIES,
  type PrescriptionCategory,
} from './prescription-catalog-item.entity';
import { Prescription } from './prescription.entity';

@Entity('prescription_items')
export class PrescriptionItem extends BranchScopedEntity {
  @Index()
  @Column({ name: 'prescription_id', type: 'uuid' })
  prescriptionId: string;

  @ManyToOne(() => Prescription, (prescription) => prescription.items, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'prescription_id' })
  prescription?: Prescription;

  @Index()
  @Column({ name: 'catalog_item_id', type: 'uuid', nullable: true })
  catalogItemId: string | null;

  @ManyToOne(() => PrescriptionCatalogItem, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'catalog_item_id' })
  catalogItem?: PrescriptionCatalogItem | null;

  @Column({
    type: 'enum',
    enum: PRESCRIPTION_CATEGORIES,
    enumName: 'prescription_category',
  })
  category: PrescriptionCategory;

  @Column({ name: 'group_name', type: 'varchar', length: 150 })
  groupName: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  dose: string | null;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Column({ type: 'boolean', default: false })
  optional: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
}
