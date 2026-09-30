import { type Decimal } from 'decimal.js';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { Material } from './material.entity';

export const BATCH_STAGES = ['pharmacy_lab', 'finished_product'] as const;
export type BatchStage = (typeof BATCH_STAGES)[number];

@Entity('material_batches')
@Index('UQ_material_batches_lab_batch_no', ['branchId', 'batchNo'], {
  unique: true,
  where: `"stage" = 'pharmacy_lab' AND "deleted_at" IS NULL`,
})
@Check(
  'CHK_material_batches_stage_links',
  `("stage" = 'pharmacy_lab' AND "lab_batch_id" IS NULL AND "product_id" IS NULL) OR ("stage" = 'finished_product' AND "lab_batch_id" IS NOT NULL)`,
)
@Check(
  'CHK_material_batches_output',
  `("product_id" IS NULL) = ("produced_qty" IS NULL) AND ("produced_qty" IS NULL OR "produced_qty" > 0)`,
)
export class MaterialBatch extends BranchScopedEntity {
  @Index()
  @Column({ name: 'batch_no', type: 'varchar', length: 100 })
  batchNo: string;

  @Index()
  @Column({ type: 'enum', enum: BATCH_STAGES, enumName: 'material_batch_stage' })
  stage: BatchStage;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({ name: 'lab_batch_id', type: 'uuid', nullable: true })
  labBatchId: string | null;

  @ManyToOne(() => MaterialBatch, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'lab_batch_id' })
  labBatch?: MaterialBatch | null;

  @Index()
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'product_id' })
  product?: Product | null;

  @Column({ name: 'produced_qty', ...quantityColumn({ nullable: true }) })
  producedQty: Decimal | null;

  @OneToMany(() => MaterialBatchItem, (item) => item.batch)
  items?: MaterialBatchItem[];
}

@Entity('material_batch_items')
@Index('UQ_material_batch_items_batch_material', ['batchId', 'materialId'], { unique: true })
@Check('CHK_material_batch_items_qty', `"qty" > 0`)
export class MaterialBatchItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @ManyToOne(() => MaterialBatch, (batch) => batch.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch?: MaterialBatch;

  @Index()
  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'material_id' })
  material?: Material;

  @Column(quantityColumn())
  qty: Decimal;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
