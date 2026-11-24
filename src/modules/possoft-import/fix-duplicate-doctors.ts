import type { DataSource } from 'typeorm';

const DOCTOR_REFERENCE_TABLES = ['appointments', 'consultations', 'prescriptions', 'treatment_plans'];

class DryRunRollback extends Error {}

export interface DuplicateDoctorResult {
  groups: number;
  merged: number;
  reassigned: Record<string, number>;
  removedStaff: number;
}

function affected(result: unknown): number {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return (result[0] as unknown[]).length;
    if (typeof result[1] === 'number') return result[1];
    return result.length;
  }
  return 0;
}

export async function fixDuplicateDoctors(
  source: DataSource,
  options: { dryRun?: boolean; onProgress?: (message: string) => void } = {},
): Promise<DuplicateDoctorResult> {
  const report = options.onProgress ?? (() => {});
  const result: DuplicateDoctorResult = {
    groups: 0,
    merged: 0,
    reassigned: Object.fromEntries(DOCTOR_REFERENCE_TABLES.map((t) => [t, 0])),
    removedStaff: 0,
  };

  try {
    await source.transaction(async (em) => {
      const groups = (await em.query(
        `SELECT branch_id, lower(trim(display_name)) AS name, array_agg(id) AS ids
           FROM doctors WHERE deleted_at IS NULL
          GROUP BY branch_id, lower(trim(display_name)) HAVING COUNT(*) > 1`,
      )) as { branch_id: string; name: string; ids: string[] }[];

      for (const group of groups) {
        result.groups += 1;
        const counts = (await em.query(
          `SELECT doctor_id, COUNT(*)::int AS c FROM appointments
            WHERE doctor_id = ANY($1) AND deleted_at IS NULL GROUP BY doctor_id`,
          [group.ids],
        )) as { doctor_id: string; c: number }[];
        const countOf = new Map(counts.map((r) => [r.doctor_id, r.c]));
        const keeper = [...group.ids].sort((a, b) => (countOf.get(b) ?? 0) - (countOf.get(a) ?? 0))[0];
        if (!keeper) continue;
        const dups = group.ids.filter((id) => id !== keeper);
        if (dups.length === 0) continue;

        for (const table of DOCTOR_REFERENCE_TABLES) {
          const moved = affected(
            await em.query(`UPDATE ${table} SET doctor_id = $1 WHERE doctor_id = ANY($2) RETURNING 1`, [
              keeper,
              dups,
            ]),
          );
          result.reassigned[table] = (result.reassigned[table] ?? 0) + moved;
        }

        const staffIds = (
          (await em.query(`SELECT staff_id FROM doctors WHERE id = ANY($1) AND staff_id IS NOT NULL`, [
            dups,
          ])) as { staff_id: string }[]
        ).map((r) => r.staff_id);
        await em.query(`UPDATE doctors SET deleted_at = now(), status = 'inactive' WHERE id = ANY($1)`, [
          dups,
        ]);
        if (staffIds.length > 0) {
          await em.query(
            `UPDATE staff_profiles SET deleted_at = now(), status = 'inactive' WHERE id = ANY($1)`,
            [staffIds],
          );
          result.removedStaff += staffIds.length;
        }
        result.merged += dups.length;
        report(`${group.name}: kept 1, merged ${dups.length} duplicate(s)`);
      }

      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return result;
}
