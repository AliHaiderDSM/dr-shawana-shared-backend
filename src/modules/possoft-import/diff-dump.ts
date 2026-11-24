import type { DumpRow, DumpTables } from './dump-reader';
import { text } from './possoft-values';

export interface DiffStats {
  newSales: number;
  newAppointments: number;
  newPrescriptions: number;
}

const idSet = (rows: DumpRow[], column: string) => {
  const set = new Set<string>();
  for (const row of rows) {
    const id = text(row[column]);
    if (id) set.add(id);
  }
  return set;
};

const keepByOwnId = (rows: DumpRow[], column: string, seen: Set<string>) =>
  rows.filter((row) => !seen.has(text(row[column])));

const keepByParent = (rows: DumpRow[], column: string, parents: Set<string>) =>
  rows.filter((row) => parents.has(text(row[column])));

export function diffDump(oldDump: DumpTables, newDump: DumpTables): { delta: DumpTables; stats: DiffStats } {
  const delta: DumpTables = new Map(newDump);
  const get = (dump: DumpTables, table: string) => dump.get(table) ?? [];

  const oldSales = idSet(get(oldDump, 'sales'), 'sale_id');
  const oldAppts = idSet(get(oldDump, 'appointments'), 'app_id');
  const oldPres = idSet(get(oldDump, 'prescriptions'), 'pres_id');

  const newSales = keepByOwnId(get(newDump, 'sales'), 'sale_id', oldSales);
  const newAppts = keepByOwnId(get(newDump, 'appointments'), 'app_id', oldAppts);
  const newPres = keepByOwnId(get(newDump, 'prescriptions'), 'pres_id', oldPres);

  delta.set('sales', newSales);
  delta.set('appointments', newAppts);
  delta.set('prescriptions', newPres);

  const newSaleIds = idSet(newSales, 'sale_id');
  const newApptIds = idSet(newAppts, 'app_id');

  delta.set('sale_products', keepByParent(get(newDump, 'sale_products'), 'sp_sale_id', newSaleIds));
  delta.set('sale_payments', keepByParent(get(newDump, 'sale_payments'), 'spay_sale_id', newSaleIds));
  delta.set(
    'appointment_payments',
    keepByParent(get(newDump, 'appointment_payments'), 'appoint_id', newApptIds),
  );

  return {
    delta,
    stats: { newSales: newSales.length, newAppointments: newAppts.length, newPrescriptions: newPres.length },
  };
}
