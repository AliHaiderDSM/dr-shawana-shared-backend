import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { AccountSheet } from '../accounts/account-sheet.entity';
import { JournalEntry } from '../journal/journal-entry.entity';
import { ExpenseCategory } from './expense-category.entity';

@Entity('expenses')
@Check('CHK_expenses_amount', `"amount" > 0`)
export class Expense extends BranchScopedEntity {
  @Index()
  @Column({ type: 'date' })
  date: string;

  @Index()
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => ExpenseCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: ExpenseCategory;

  @Column(moneyColumn())
  amount: Decimal;

  @Index()
  @Column({ name: 'account_sheet_id', type: 'uuid' })
  accountSheetId: string;

  @ManyToOne(() => AccountSheet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_sheet_id' })
  accountSheet?: AccountSheet;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @ManyToOne(() => JournalEntry, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry?: JournalEntry;

  @Column({ name: 'attachment_path', type: 'text', nullable: true })
  attachmentPath: string | null;

  @Column({ name: 'attachment_name', type: 'varchar', length: 255, nullable: true })
  attachmentName: string | null;
}
