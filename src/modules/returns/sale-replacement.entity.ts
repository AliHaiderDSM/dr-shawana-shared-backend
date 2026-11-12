import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Sale } from '../sales/sale.entity';
import { SaleReplacementItem } from './sale-replacement-item.entity';
import { SaleReturn } from './sale-return.entity';

export const REPLACEMENT_STATUSES = ['pending', 'sent'] as const;
export type ReplacementStatus = (typeof REPLACEMENT_STATUSES)[number];

@Entity('sale_replacements')
@Index('UQ_sale_replacements_branch_seq', ['branchId', 'replacementSeq'], { unique: true })
@Index(['branchId', 'date'])
export class SaleReplacement extends BranchScopedEntity {
  @Column({ name: 'replacement_seq', type: 'integer' })
  replacementSeq: number;

  @Index()
  @Column({ name: 'replacement_no', type: 'varchar', length: 30 })
  replacementNo: string;

  @Index()
  @Column({ name: 'sale_return_id', type: 'uuid' })
  saleReturnId: string;

  @ManyToOne(() => SaleReturn, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_return_id' })
  saleReturn?: SaleReturn;

  @Index()
  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: REPLACEMENT_STATUSES,
    enumName: 'sale_replacement_status',
    default: 'pending',
  })
  status: ReplacementStatus;

  @Column({ name: 'sent_on', type: 'date', nullable: true })
  sentOn: string | null;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy: string | null;

  @OneToMany(() => SaleReplacementItem, (item) => item.replacement)
  items?: SaleReplacementItem[];
}
