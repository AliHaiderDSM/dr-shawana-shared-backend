import { Router } from 'express';
import { mountBranchCrud } from '../../lib/crud';
import {
  accountSheetListQuerySchema,
  bankListQuerySchema,
  createAccountSheetSchema,
  createBankSchema,
  updateAccountSheetSchema,
  updateBankSchema,
} from './accounts.schemas';
import { accountSheetsService, banksService } from './accounts.service';

export const accountsRouter = Router();

mountBranchCrud(accountsRouter, {
  path: '/branch/banks',
  module: 'banks',
  service: banksService,
  schemas: { list: bankListQuerySchema, create: createBankSchema, update: updateBankSchema },
});

mountBranchCrud(accountsRouter, {
  path: '/branch/account-sheets',
  module: 'accounts',
  service: accountSheetsService,
  schemas: {
    list: accountSheetListQuerySchema,
    create: createAccountSheetSchema,
    update: updateAccountSheetSchema,
  },
});
