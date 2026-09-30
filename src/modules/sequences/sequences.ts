import { type EntityManager } from 'typeorm';

export async function nextSequence(manager: EntityManager, branchId: string, key: string): Promise<number> {
  const rows: { last_value: number }[] = await manager.query(
    `INSERT INTO document_sequences (branch_id, key, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (branch_id, key) DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [branchId, key],
  );
  return Number(rows[0]?.last_value);
}
