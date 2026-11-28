import type { DataSource } from 'typeorm';
import type { DumpTables } from './dump-reader';
import { enteredByNames, isActive, text, timestampOf } from './possoft-values';

export const POSSOFT_ENTERED_BY_TABLES = ['appointments', 'wt_users'];

export interface EnteredBySummary {
  appointments: number;
  updated: number;
  withoutUser: number;
}

class DryRunRollback extends Error {}

export async function backfillEnteredBy(
  source: DataSource,
  dump: DumpTables,
  options: { dryRun?: boolean } = {},
): Promise<EnteredBySummary> {
  const enteredBy = enteredByNames(dump.get('wt_users') ?? []);
  const appIds: string[] = [];
  const names: (string | null)[] = [];
  const times: (string | null)[] = [];
  const summary: EnteredBySummary = { appointments: 0, updated: 0, withoutUser: 0 };

  for (const appt of dump.get('appointments') ?? []) {
    if (!isActive(appt)) continue;
    const name = enteredBy(appt.entry_by);
    if (!name) summary.withoutUser += 1;
    appIds.push(text(appt.app_id));
    names.push(name);
    times.push(timestampOf(appt.crt_date));
  }
  summary.appointments = appIds.length;

  try {
    await source.transaction(async (em) => {
      const updated = (await em.query(
        `UPDATE appointments a
            SET entered_by_name = coalesce(v.name, a.entered_by_name),
                created_at = coalesce(v.at, a.created_at)
           FROM unnest($1::text[], $2::text[], $3::timestamptz[]) AS v(app_id, name, at)
          WHERE a.source_app_id = v.app_id AND a.created_by IS NULL AND a.deleted_at IS NULL
        RETURNING a.id`,
        [appIds, names, times],
      )) as { id: string }[];
      summary.updated = updated.length;
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return summary;
}
