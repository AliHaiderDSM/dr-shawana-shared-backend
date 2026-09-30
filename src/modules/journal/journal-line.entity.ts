import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { AccountSheet } from '../accounts/account-sheet.entity';
import { ExpenseCategory } from '../expenses/expense-category.entity';
import { JournalEntry } from './journal-entry.entity';

@Entity('journal_lines')
@Check('CHK_journal_lines_amounts', `"debit" >= 0 AND "credit" >= 0 AND ("debit" + "credit") > 0`)
@Check('CHK_journal_lines_target', `("account_sheet_id" IS NULL) <> ("expense_category_id" IS NULL)`)
export class JournalLine extends BranchScopedEntity {
  @Index()
  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.lines, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_entry_id' })
  entry?: JournalEntry;

  @Index()
  @Column({ name: 'account_sheet_id', type: 'uuid', nullable: true })
  accountSheetId: string | null;

  @ManyToOne(() => AccountSheet, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'account_sheet_id' })
  accountSheet?: AccountSheet | null;

  @Index()
  @Column({ name: 'expense_category_id', type: 'uuid', nullable: true })
  expenseCategoryId: string | null;

  @ManyToOne(() => ExpenseCategory, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'expense_category_id' })
  expenseCategory?: ExpenseCategory | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column(moneyColumn({ default: '0' }))
  debit: Decimal;

  @Column(moneyColumn({ default: '0' }))
  credit: Decimal;
}
