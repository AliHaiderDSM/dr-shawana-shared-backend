import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { InventoryItem } from './inventory-item.entity';

export const ITEM_EVENTS = [
  'received',
  'produced',
  'labelled',
  'sold',
  'sale_edited',
  'sale_deleted',
  'returned',
  'return_cancelled',
  'quarantined',
  'restocked',
  'damaged',
  'expired',
  'supplier_returned',
  'dispatched',
  'dispatch_cancelled',
  'written_off',
] as const;
export type ItemEventType = (typeof ITEM_EVENTS)[number];

@Entity('inventory_item_events')
@Index(['itemId', 'createdAt'])
export class InventoryItemEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ManyToOne(() => InventoryItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: InventoryItem;

  @Index()
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch;

  @Column({ type: 'enum', enum: ITEM_EVENTS, enumName: 'inventory_item_event_type' })
  type: ItemEventType;

  @Column({ name: 'reference_type', type: 'varchar', length: 40, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ name: 'reference_label', type: 'varchar', length: 60, nullable: true })
  referenceLabel: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
