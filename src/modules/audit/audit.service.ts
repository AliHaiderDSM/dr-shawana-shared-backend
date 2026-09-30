import { type EntityManager } from 'typeorm';
import { repo } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  actor: Actor | null;
  branchId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before?: object | null;
  after?: object | null;
}

function snapshot(value: object | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export const auditService = {
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const logs = repo(AuditLog, manager);
    await logs.save(
      logs.create({
        branchId: entry.branchId,
        actorId: entry.actor?.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: snapshot(entry.before),
        after: snapshot(entry.after),
        ip: entry.actor?.ip ?? null,
      }),
    );
  },
};
