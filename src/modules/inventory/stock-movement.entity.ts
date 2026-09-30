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
import { moneyColumn, quantityColumn } from '../../database/transformers';
import { Branch } from '../branches/branch.entity';
import { Product } from '../products/product.entity';

export const STOCK_MOVEMENT_TYPES = [
  'purchase_in',
  'stock_in',
  'stock_out',
  'sale',
  'sale_return',
  'sale_edit_adjust',
  'manufacturing_in',
  'adjustment',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

@Entity('stock_movements')
@Index(['branchId', 'productId', 'date'])
@Index(['referenceType', 'referenceId'])
@Check('CHK_stock_movements_qty_not_zero', `"qty" <> 0`)
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Index()
  @Column({ type: 'enum', enum: STOCK_MOVEMENT_TYPES, enumName: 'stock_movement_type' })
  type: StockMovementType;

  @Column(quantityColumn())
  qty: Decimal;

  @Column({ name: 'unit_cost', ...moneyColumn({ nullable: true }) })
  unitCost: Decimal | null;

  @Column({ name: 'reference_type', type: 'varchar', length: 40 })
  referenceType: string;

  @Column({ name: 'reference_id', type: 'uuid' })
  referenceId: string;

  @Index()
  @Column({ name: 'reversal_of_id', type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @ManyToOne(() => StockMovement, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'reversal_of_id' })
  reversalOf?: StockMovement | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
