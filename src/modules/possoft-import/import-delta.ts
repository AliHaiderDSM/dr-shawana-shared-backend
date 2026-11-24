import type { DataSource } from 'typeorm';
import type { DumpTables } from './dump-reader';
import { diffDump, type DiffStats } from './diff-dump';
import { fixClinicalBranches } from './fix-branches';
import { POSSOFT_CLINICAL_TABLES, importPossoftClinical, type ClinicalSummary } from './import-clinical';
import { POSSOFT_SALES_TABLES, importPossoftSales, type ImportSummary } from './import-sales';

export const POSSOFT_DELTA_TABLES = Array.from(
  new Set([...POSSOFT_SALES_TABLES, ...POSSOFT_CLINICAL_TABLES]),
);

export interface DeltaSummary {
  diff: DiffStats;
  sales: ImportSummary;
  clinical: ClinicalSummary;
  branchFixes: Record<string, number>;
}

export async function importPossoftDelta(
  source: DataSource,
  oldDump: DumpTables,
  newDump: DumpTables,
  options: { dryRun?: boolean; password: string },
): Promise<DeltaSummary> {
  const { delta, stats } = diffDump(oldDump, newDump);
  const sales = await importPossoftSales(source, delta, { dryRun: options.dryRun, append: true });
  const clinical = await importPossoftClinical(source, delta, {
    dryRun: options.dryRun,
    append: true,
    password: options.password,
  });
  const branchFixes = await fixClinicalBranches(source, { dryRun: options.dryRun });
  return { diff: stats, sales, clinical, branchFixes };
}
