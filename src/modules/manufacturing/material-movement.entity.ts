import { type Decimal } from 'decimal.js';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { quantityColumn } from '../../database/transformers';
import { Branch } from '../branches/branch.entity';
import { Material } from './material.entity';

export const MATERIAL_LOCATIONS = ['store', 'lab'] as const;
export type MaterialLocation = (typeof MATERIAL_LOCATIONS)[number];

export const MATERIAL_MOVEMENT_TYPES = ['material_in', 'material_out_to_lab', 'used_in_production'] as const;
export type MaterialMovementType = (typeof MATERIAL_MOVEMENT_TYPES)[number];

@Entity('material_movements')
@Index(['branchId', 'materialId', 'location', 'date'])
@Index(['referenceType', 'referenceId'])
@Check('CHK_material_movements_qty_not_zero', `"qty" <> 0`)
export class MaterialMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Index()
  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'material_id' })
  material?: Material;

  @Column({ type: 'enum', enum: MATERIAL_LOCATIONS, enumName: 'material_location' })
  location: MaterialLocation;

  @Index()
  @Column({ type: 'enum', enum: MATERIAL_MOVEMENT_TYPES, enumName: 'material_movement_type' })
  type: MaterialMovementType;

  @Column(quantityColumn())
  qty: Decimal;

  @Column({ name: 'reference_type', type: 'varchar', length: 40 })
  referenceType: string;

  @Column({ name: 'reference_id', type: 'uuid' })
  referenceId: string;

  @Index()
  @Column({ name: 'reversal_of_id', type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @ManyToOne(() => MaterialMovement, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'reversal_of_id' })
  reversalOf?: MaterialMovement | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
