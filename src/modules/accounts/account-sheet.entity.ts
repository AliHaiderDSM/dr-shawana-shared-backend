import { type Decimal } from 'decimal.js';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { moneyColumn } from '../../database/transformers';
import { Bank } from './bank.entity';

export const ACCOUNT_TYPES = ['cash', 'bank'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

@Entity('account_sheets')
@Check('CHK_account_sheets_bank_required', `("type" = 'cash') OR ("bank_id" IS NOT NULL)`)
export class AccountSheet extends BranchScopedEntity {
  @Column({ name: 'account_name', type: 'varchar', length: 150 })
  accountName: string;

  @Column({ name: 'account_code', type: 'varchar', length: 100 })
  accountCode: string;

  @Index()
  @Column({ name: 'bank_id', type: 'uuid', nullable: true })
  bankId: string | null;

  @ManyToOne(() => Bank, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'bank_id' })
  bank?: Bank | null;

  @Index()
  @Column({ type: 'enum', enum: ACCOUNT_TYPES, enumName: 'account_type' })
  type: AccountType;

  @Column({ name: 'opening_balance', ...moneyColumn({ default: '0' }) })
  openingBalance: Decimal;

  @Column({ type: 'date' })
  date: string;
}
