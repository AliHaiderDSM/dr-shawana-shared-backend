import { Router } from 'express';
import { mountBranchCrud } from '../../lib/crud';
import {
  accountSheetListQuerySchema,
  createAccountSheetSchema,
  updateAccountSheetSchema,
} from './accounts.schemas';
import { accountSheetsService } from './accounts.service';

export const accountsRouter = Router();

mountBranchCrud(accountsRouter, {
  path: '/branch/account-sheets',
  module: 'accounts',
  service: accountSheetsService,
  optionsAlsoFor: [
    'appointmentPayments.create',
    'appointmentPayments.update',
    'sales.create',
    'sales.update',
  ],
  schemas: {
    list: accountSheetListQuerySchema,
    create: createAccountSheetSchema,
    update: updateAccountSheetSchema,
  },
});
