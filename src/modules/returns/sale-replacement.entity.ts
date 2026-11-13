import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { Sale } from '../sales/sale.entity';
import { SaleReplacementFile } from './sale-replacement-file.entity';
import { SaleReplacementItem } from './sale-replacement-item.entity';
import { RETURN_REASONS, SaleReturn, type ReturnReason } from './sale-return.entity';

export const REPLACEMENT_STATUSES = ['pending_approval', 'approved', 'rejected', 'sent'] as const;
export type ReplacementStatus = (typeof REPLACEMENT_STATUSES)[number];

@Entity('sale_replacements')
@Index('UQ_sale_replacements_sale_seq', ['saleId', 'replacementSeq'], { unique: true })
@Index(['branchId', 'date'])
export class SaleReplacement extends BranchScopedEntity {
  @Column({ name: 'replacement_seq', type: 'integer' })
  replacementSeq: number;

  @Index()
  @Column({ name: 'replacement_no', type: 'varchar', length: 40 })
  replacementNo: string;

  @Index()
  @Column({ name: 'sale_return_id', type: 'uuid', nullable: true })
  saleReturnId: string | null;

  @ManyToOne(() => SaleReturn, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_return_id' })
  saleReturn?: SaleReturn | null;

  @Index()
  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @ManyToOne(() => Sale, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_id' })
  sale?: Sale;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: RETURN_REASONS, enumName: 'sale_return_reason' })
  reason: ReturnReason;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: REPLACEMENT_STATUSES,
    enumName: 'sale_replacement_status',
    default: 'pending_approval',
  })
  status: ReplacementStatus;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'sent_on', type: 'date', nullable: true })
  sentOn: string | null;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy: string | null;

  @OneToMany(() => SaleReplacementItem, (item) => item.replacement)
  items?: SaleReplacementItem[];

  @OneToMany(() => SaleReplacementFile, (file) => file.replacement)
  files?: SaleReplacementFile[];
}
