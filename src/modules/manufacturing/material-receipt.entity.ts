import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Material } from './material.entity';

export const MATERIAL_PLACES = ['falcon', 'pharmacy'] as const;
export type MaterialPlace = (typeof MATERIAL_PLACES)[number];

@Entity('material_receipts')
@Check('CHK_material_receipts_quantity', `"quantity" > 0`)
export class MaterialReceipt extends BranchScopedEntity {
  @Index()
  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'material_id' })
  material?: Material;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column(quantityColumn())
  quantity: Decimal;

  @Column({ type: 'enum', enum: MATERIAL_PLACES, enumName: 'material_place', default: 'falcon' })
  place: MaterialPlace;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
