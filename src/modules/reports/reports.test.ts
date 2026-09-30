import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { catalogService } from '../prescriptions/prescriptions.service';

const fake = installFakeSupabase();
const app = createApp();

describe('accounts, expenses, reports and dashboard', () => {
  let admin: { id: string };
  let accountant: { id: string };
  let frontDesk: { id: string };
  let doctorUser: { id: string };
  let islamabadAdmin: { id: string };
  let superAdmin: { id: string };
  let lahoreId: string;
  let cashSheet: string;
  let bankSheet: string;
  let isbCash: string;
  let serum: string;
  let patientId: string;
  let doctorId: string;
  let categoryId: string;
  let journalId: string;
  let expenseId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const report = async (name: string, who: { id: string }, query = '') =>
    api('get', `/branch/reports/${name}${query ? `?${query}` : ''}`, who);

  beforeAll(async () => {
    lahoreId = (await createBranch({ code: 'LHR', city: 'Lahore' })).id;
    const islamabadId = (await createBranch({ code: 'ISB', city: 'Islamabad' })).id;
    await catalogService.seedBranch(lahoreId);
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    accountant = await createStaff(fake, { role: 'accountant', branchId: lahoreId });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahoreId });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabadId });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });

    cashSheet = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Cash',
        accountCode: 'C1',
        type: 'cash',
        openingBalance: '1000',
        date: '2026-08-01',
      })
    ).body.data.id;
    const bankId = (await api('post', '/branch/banks', admin).send({ name: 'Meezan' })).body.data.id;
    bankSheet = (
      await api('post', '/branch/account-sheets', admin).send({
        accountName: 'Bank',
        accountCode: 'B1',
        type: 'bank',
        bankId,
      })
    ).body.data.id;
    isbCash = (
      await api('post', '/branch/account-sheets', islamabadAdmin).send({
        accountName: 'ISB Cash',
        accountCode: 'I1',
        type: 'cash',
      })
    ).body.data.id;

    const supplierId = (
      await api('post', '/branch/suppliers', admin).send({
        name: 'Falcon',
        phone: '923001111111',
        type: 'supplier',
      })
    ).body.data.id;
    const productCategory = (await api('post', '/branch/categories', admin).send({ name: 'Skin' })).body.data
      .id;
    serum = (
      await api('post', '/branch/products', admin).send({
        name: 'Serum',
        categoryId: productCategory,
        initialPurchase: { supplierId, date: '2026-09-01', quantity: '10', unitPrice: '1000' },
      })
    ).body.data.id;
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Ayesha',
        phone: '923001234567',
        city: 'Lahore',
      })
    ).body.data.id;
    doctorId = (
      await api('post', '/branch/doctors', admin).send({
        staffId: doctorUser.id,
        displayName: 'Dr. Shawana',
        commissionPercent: '4',
      })
    ).body.data.id;

    const appointment = await api('post', '/branch/appointments', frontDesk).send({
      patientId,
      doctorId,
      date: '2026-09-05',
      timeFrom: '10:00',
      timeTo: '10:30',
      mode: 'online',
      visitType: 'new',
      payments: [
        { method: 'cash', amount: '3000', date: '2026-09-05', accountSheetId: cashSheet },
        { method: 'online', amount: '2000', date: '2026-09-06', accountSheetId: bankSheet },
      ],
    });
    const consultationId = (
      await api('post', `/branch/appointments/${appointment.body.data.id}/consultation`, doctorUser)
    ).body.data.id;
    await api('put', `/branch/consultations/${consultationId}/sections/mrs_scale`, doctorUser).send({
      date: '2026-09-05',
      hotFlushes: 4,
      irritability: 2,
    });
    await api('put', `/branch/consultations/${consultationId}/sections/clinical_assessment`, doctorUser).send(
      {
        menopauseStage: ['perimenopause'],
      },
    );
    await api('post', `/branch/patients/${patientId}/blood-work`, doctorUser).send({
      results: [{ test: 'fsh', value: '42', testDate: '2026-09-01' }],
    });
    const progest = (await api('get', '/branch/prescription-catalog', doctorUser)).body.data.find(
      (c: { code: string }) => c.code === 'pres_progest1',
    ).id;
    await api('post', '/branch/prescriptions', doctorUser).send({
      consultationId,
      diagnosis: 'Perimenopause',
      items: [{ catalogItemId: progest }],
    });

    await api('post', '/branch/sales', frontDesk).send({
      patientId,
      date: '2026-09-10',
      saleType: 'office',
      items: [{ productId: serum, qty: '2' }],
      payments: [{ method: 'cash', amount: '2000', date: '2026-09-10', accountSheetId: cashSheet }],
    });
  });

  describe('journal', () => {
    it('refuses unbalanced entries, in the service and in the database', async () => {
      const bad = await api('post', '/branch/journal-entries', accountant).send({
        date: '2026-09-15',
        narration: 'Transfer',
        lines: [
          { accountSheetId: cashSheet, debit: '0', credit: '500' },
          { accountSheetId: bankSheet, debit: '400', credit: '0' },
        ],
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.details).toEqual({ debit: '400.00', credit: '500.00' });

      await expect(
        AppDataSource.transaction(async (em) => {
          const [entry] = (await em.query(
            `INSERT INTO journal_entries (branch_id, entry_seq, entry_no, date, narration) VALUES ($1, 999, 'X', '2026-09-15', 'x') RETURNING id`,
            [lahoreId],
          )) as { id: string }[];
          await em.query(
            `INSERT INTO journal_lines (branch_id, journal_entry_id, account_sheet_id, debit, credit) VALUES ($1, $2, $3, 10, 0)`,
            [lahoreId, entry?.id, cashSheet],
          );
        }),
      ).rejects.toThrow(/not balanced/);
    });

    it('posts, numbers, edits and lists balanced entries', async () => {
      const res = await api('post', '/branch/journal-entries', accountant).send({
        date: '2026-09-15',
        narration: 'Cash to bank',
        lines: [
          { accountSheetId: cashSheet, credit: '500', description: 'Deposit' },
          { accountSheetId: bankSheet, debit: '500' },
        ],
      });
      expect(res.status).toBe(201);
      journalId = res.body.data.id;
      expect(res.body.data).toMatchObject({
        entryNo: 'LHR-JV-000001',
        totalDebit: '500.00',
        totalCredit: '500.00',
        source: 'manual',
      });
      expect(
        (await api('patch', `/branch/journal-entries/${journalId}`, accountant).send({ narration: 'x' }))
          .status,
      ).toBe(403);
      const edited = await api('patch', `/branch/journal-entries/${journalId}`, admin).send({
        lines: [
          { accountSheetId: cashSheet, credit: '600' },
          { accountSheetId: bankSheet, debit: '600' },
        ],
      });
      expect(edited.body.data.totalDebit).toBe('600.00');
      const list = await api('get', `/branch/journal-entries?accountSheetId=${bankSheet}`, accountant);
      expect(list.body.meta.totals).toEqual({ debit: '600.00', credit: '600.00' });
      expect((await api('get', '/branch/journal-entries', frontDesk)).status).toBe(403);
    });
  });

  describe('expenses', () => {
    it('posts an expense to the journal and follows its edits', async () => {
      categoryId = (await api('post', '/branch/expense-categories', admin).send({ name: 'Electricity' })).body
        .data.id;
      const res = await request(app)
        .post('/api/v1/branch/expenses')
        .set(bearer(accountant))
        .field(
          'data',
          JSON.stringify({
            date: '2026-09-20',
            categoryId,
            amount: '700',
            accountSheetId: cashSheet,
            note: 'LESCO',
          }),
        )
        .attach('attachment', Buffer.from('%PDF-1.4'), {
          filename: 'bill.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(201);
      expenseId = res.body.data.id;
      expect(res.body.data).toMatchObject({
        amount: '700.00',
        hasAttachment: true,
        category: { name: 'Electricity' },
      });
      const entry = await api('get', `/branch/journal-entries/${res.body.data.journalEntryId}`, admin);
      expect(entry.body.data).toMatchObject({
        source: 'expense',
        totalDebit: '700.00',
        totalCredit: '700.00',
      });
      expect(
        (await api('delete', `/branch/journal-entries/${res.body.data.journalEntryId}`, admin)).status,
      ).toBe(409);

      const edited = await api('patch', `/branch/expenses/${expenseId}`, admin).send({ amount: '750' });
      expect(edited.body.data.amount).toBe('750.00');
      const after = await api('get', `/branch/journal-entries/${res.body.data.journalEntryId}`, admin);
      expect(after.body.data.totalCredit).toBe('750.00');
      expect((await api('get', `/branch/expenses/${expenseId}/attachment-url`, admin)).status).toBe(200);
      expect((await api('delete', `/branch/expense-categories/${categoryId}`, admin)).status).toBe(409);
      const list = await api('get', '/branch/expenses?month=2026-09', accountant);
      expect(list.body.meta.totalAmount).toBe('750.00');
    });
  });

  describe('reports', () => {
    it('computes account balances with the opening balance, sale and appointment payments, journal and expenses', async () => {
      const res = await report('accounts-balance', accountant, 'month=2026-09');
      expect(res.status).toBe(200);
      const cash = res.body.data.rows.find((r: { accountCode: string }) => r.accountCode === 'C1');
      expect(cash).toMatchObject({
        opening: '1000.00',
        debit: '5000.00',
        credit: '1350.00',
        closing: '4650.00',
      });
      const bank = res.body.data.rows.find((r: { accountCode: string }) => r.accountCode === 'B1');
      expect(bank).toMatchObject({ debit: '2600.00', closing: '2600.00' });

      const october = await report('accounts-balance', accountant, 'month=2026-10');
      expect(
        october.body.data.rows.find((r: { accountCode: string }) => r.accountCode === 'C1'),
      ).toMatchObject({
        opening: '4650.00',
        debit: '0.00',
        closing: '4650.00',
      });

      const ledger = await report('accounts-balance', accountant, `accountSheetId=${cashSheet}`);
      expect(ledger.body.data.rows.map((r: { source: string }) => r.source)).toEqual([
        'appointment_payment',
        'sale_payment',
        'journal',
        'journal',
      ]);
      expect(ledger.body.data.summary).toEqual({ opening: '1000.00', closing: '4650.00' });
      expect(ledger.body.data.rows[3].balance).toBe('4650.00');
    });

    it('lists the finance report (journal lines) and the expenses report', async () => {
      const finance = await report('finance', accountant, 'month=2026-09');
      expect(finance.body.data.rows).toHaveLength(4);
      expect(finance.body.data.totals).toEqual({ debit: '1350.00', credit: '1350.00' });
      const expenses = await report('expenses', accountant, 'from=2026-09-01&to=2026-09-30');
      expect(expenses.body.data.summary.byCategory).toEqual([{ category: 'Electricity', amount: '750.00' }]);
    });

    it('builds the sale, purchase and stock reports', async () => {
      const sales = await report('sale-products', frontDesk, 'month=2026-09');
      expect(sales.body.data.rows).toHaveLength(1);
      expect(sales.body.data.rows[0]).toMatchObject({
        product: 'Serum',
        qty: '2.000',
        lineTotal: '2000.00',
        invoiceNo: 'LHR-000001',
      });
      expect(sales.body.data.totals).toMatchObject({ lineTotal: '2000.00', qty: '2.000' });
      const purchases = await report('purchases', accountant, 'month=2026-09');
      expect(purchases.body.data.rows[0]).toMatchObject({
        supplier: 'Falcon',
        qty: '10.000',
        amount: '10000.00',
      });
      const stock = await report('stock', admin, 'month=2026-09');
      expect(stock.body.data.totals).toMatchObject({ bought: '10.000', sold: '2.000' });
      expect((await report('purchases', frontDesk)).status).toBe(403);
    });

    it('builds the appointment, doctor sale and patient history reports', async () => {
      const appointments = await report('appointments', frontDesk, 'month=2026-09');
      expect(appointments.body.data.rows[0]).toMatchObject({
        doctor: 'Dr. Shawana',
        amount: '5000.00',
        methods: 'cash, online',
      });
      const cashOnly = await report('appointments', frontDesk, 'month=2026-09&method=cash');
      expect(cashOnly.body.data.totals.amount).toBe('3000.00');
      const payments = await report('appointment-payments', frontDesk, `accountSheetId=${bankSheet}`);
      expect(payments.body.data.totals.amount).toBe('2000.00');

      const doctorSales = await report('doctor-sales', doctorUser);
      expect(doctorSales.body.data.rows[0]).toMatchObject({
        total: '2000.00',
        commissionPercent: '4.00',
        commission: '80.00',
      });
      expect((await report('doctor-sales', frontDesk)).status).toBe(403);

      const history = await report('patient-history', admin);
      expect(history.body.data.rows[0]).toMatchObject({
        patient: 'Ayesha',
        menopauseStage: 'perimenopause',
        hotFlushes: 4,
        somaticMrs: 4,
        psychologicalMrs: 2,
        totalMrs: 6,
        fsh: '42',
        progesteroneTreatment: 'Take one capsule every day at bed time',
      });
    });

    it('exports CSV', async () => {
      const csv = await report('sale-products', frontDesk, 'month=2026-09&format=csv');
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('sale-products-report.csv');
      const lines = csv.text.replace('﻿', '').trim().split('\r\n');
      expect(lines[0]).toBe(
        'Invoice,Date,Customer,Phone,Sale Type,Sale City,Product,Bundle,Qty,Price,Amount',
      );
      expect(lines[1]).toContain('LHR-000001,2026-09-10,Ayesha');
      expect(lines[2]?.startsWith('Total,')).toBe(true);
    });

    it('keeps branches apart and gives super admin every branch with a breakdown', async () => {
      await api('post', '/branch/journal-entries', islamabadAdmin).send({
        date: '2026-09-15',
        narration: 'Opening cash',
        lines: [
          { accountSheetId: isbCash, debit: '300' },
          { accountSheetId: isbCash, credit: '300' },
        ],
      });
      const own = await report('finance', islamabadAdmin, 'month=2026-09');
      expect(own.body.data.rows).toHaveLength(2);
      const all = await report('finance', superAdmin, 'month=2026-09');
      expect(all.body.data.columns[0]).toEqual({ key: 'branch', label: 'Branch' });
      expect(all.body.data.rows).toHaveLength(6);
      expect(all.body.data.byBranch).toEqual([
        { branch: 'ISB', debit: '300.00', credit: '300.00' },
        { branch: 'LHR', debit: '1350.00', credit: '1350.00' },
      ]);
      const one = await report('finance', superAdmin, `month=2026-09&branchId=${lahoreId}`);
      expect(one.body.data.rows).toHaveLength(4);
    });
  });

  describe('dashboard', () => {
    it('returns the KPIs each role may see', async () => {
      const adminView = await api('get', '/branch/dashboard?year=2026', admin);
      expect(adminView.status).toBe(200);
      expect(adminView.body.data.counts).toEqual({ patients: 1, products: 1 });
      expect(adminView.body.data.charts.salesAmount[8]).toBe('2000.00');
      expect(adminView.body.data.charts.appointmentAmount[8]).toBe('5000.00');
      expect(adminView.body.data.charts.productSales[0]).toMatchObject({ product: 'Serum' });
      expect(adminView.body.data.stock).toBeDefined();
      expect(adminView.body.data.pendingDeliveries).toBe(0);

      const doctorView = await api('get', '/branch/dashboard', doctorUser);
      expect(doctorView.body.data.appointments).toBeDefined();
      expect(doctorView.body.data.sales).toBeUndefined();
      expect(doctorView.body.data.stock).toBeUndefined();

      const all = await api('get', '/branch/dashboard', superAdmin);
      expect(all.body.data.scope).toBe('all_branches');
      expect(all.body.data.byBranch.map((b: { branch: string }) => b.branch)).toEqual(['ISB', 'LHR']);
    });
  });
});
