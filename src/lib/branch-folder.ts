import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../database/data-source';

export async function branchFolder(branchId: string, em?: EntityManager): Promise<string> {
  const [row] = (await (em ?? AppDataSource.manager).query(`SELECT code FROM branches WHERE id = $1`, [
    branchId,
  ])) as { code: string }[];
  return row?.code ?? branchId;
}

export async function doctorBranchFolder(conversationId: string): Promise<string> {
  const [row] = (await AppDataSource.query(
    `SELECT b.code FROM chat_conversations c
       JOIN doctors d ON d.id = c.doctor_id
       JOIN branches b ON b.id = d.branch_id
      WHERE c.id = $1`,
    [conversationId],
  )) as { code: string }[];
  return row?.code ?? 'no-branch';
}
