import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Product } from '../products/product.entity';

export const PRESCRIPTION_CATEGORIES = [
  'lab',
  'imaging',
  'genetic',
  'supplement',
  'medicine',
  'glp',
  'skin_care',
  'hair_care',
  'bhrt',
  'symptom',
] as const;
export type PrescriptionCategory = (typeof PRESCRIPTION_CATEGORIES)[number];

@Entity('prescription_items_catalog')
@Index('UQ_prescription_items_catalog_code', ['branchId', 'code'], {
  unique: true,
  where: `"deleted_at" IS NULL`,
})
@Index(['branchId', 'category', 'sortOrder'])
export class PrescriptionCatalogItem extends BranchScopedEntity {
  @Column({ type: 'varchar', length: 80 })
  code: string;

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

  @Column({ name: 'default_dose', type: 'text', nullable: true })
  defaultDose: string | null;

  @Column({ name: 'default_instructions', type: 'text', nullable: true })
  defaultInstructions: string | null;

  @Index()
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'product_id' })
  product?: Product | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
