import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { JournalLine } from './journal-line.entity';

export const JOURNAL_SOURCES = ['manual', 'expense'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

@Entity('journal_entries')
@Index('UQ_journal_entries_branch_no', ['branchId', 'entrySeq'], { unique: true })
export class JournalEntry extends BranchScopedEntity {
  @Column({ name: 'entry_seq', type: 'integer' })
  entrySeq: number;

  @Index()
  @Column({ name: 'entry_no', type: 'varchar', length: 30 })
  entryNo: string;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text' })
  narration: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  reference: string | null;

  @Index()
  @Column({ type: 'enum', enum: JOURNAL_SOURCES, enumName: 'journal_source', default: 'manual' })
  source: JournalSource;

  @OneToMany(() => JournalLine, (line) => line.entry)
  lines?: JournalLine[];
}
