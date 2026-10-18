import webpush from 'web-push';
import { env } from '../../config/env';
import { AppDataSource } from '../../database/data-source';
import { logger } from '../../lib/logger';
import { hasPermission, type Permission, type Role } from '../../lib/permissions';
import { badgeCounts, type BadgeCounts } from '../badges/badges.service';

type BadgeKey = keyof BadgeCounts;

const BADGES: Record<BadgeKey, { label: string; path: string; anyOf: Permission[] | 'doctor' }> = {
  stockRequests: {
    label: 'Stock requests',
    path: '/stock-requests',
    anyOf: ['stock.view', 'inventoryReport.view'],
  },
  incomingStock: {
    label: 'Incoming stock',
    path: '/incoming-stock',
    anyOf: ['stock.view', 'inventoryReport.view'],
  },
  writeOffs: { label: 'Write-offs', path: '/write-offs', anyOf: ['stock.view', 'inventoryReport.view'] },
  discountRequests: { label: 'Discount requests', path: '/discount-requests', anyOf: ['sales.view'] },
  returns: { label: 'Returns', path: '/returns', anyOf: ['returns.view'] },
  stockReceipts: { label: 'Store receipts', path: '/store-receipts', anyOf: ['stock.view'] },
  patientRequests: { label: 'Patient requests', path: '/patient-requests', anyOf: ['patients.view'] },
  patientMessages: { label: 'Patient messages', path: '/messages', anyOf: 'doctor' },
};

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushSender = (target: PushTarget, message: PushMessage) => Promise<void>;

export class ExpiredSubscriptionError extends Error {}

interface Row {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lastCounts: Partial<BadgeCounts> | null;
  staffId: string;
  role: Role;
  branchId: string | null;
}

function configured() {
  return Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY);
}

const webPushSender: PushSender = async (target, message) => {
  try {
    await webpush.sendNotification(target, JSON.stringify(message), {
      TTL: 24 * 60 * 60,
      urgency: 'high',
      vapidDetails: {
        subject: env.WEB_PUSH_SUBJECT || `mailto:${env.SUPER_ADMIN_EMAIL || 'admin@localhost'}`,
        publicKey: env.WEB_PUSH_PUBLIC_KEY as string,
        privateKey: env.WEB_PUSH_PRIVATE_KEY as string,
      },
    });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) throw new ExpiredSubscriptionError();
    throw err;
  }
};

function visible(key: BadgeKey, role: Role) {
  const rule = BADGES[key].anyOf;
  if (rule === 'doctor') return role === 'doctor';
  return role === 'super_admin' || rule.some((permission) => hasPermission(role, permission));
}

const viewerOf = (row: Pick<Row, 'staffId' | 'role' | 'branchId'>) => ({
  isSuperAdmin: row.role === 'super_admin',
  role: row.role,
  userId: row.staffId,
  branchId: row.role === 'super_admin' ? null : row.branchId,
});

export const staffPush = {
  publicKey() {
    return configured() ? (env.WEB_PUSH_PUBLIC_KEY as string) : null;
  },

  async subscribe(
    staff: { id: string; role: Role; branchId: string | null },
    target: PushTarget,
    userAgent: string | null,
  ) {
    const counts = await badgeCounts(
      viewerOf({ staffId: staff.id, role: staff.role, branchId: staff.branchId }),
    );
    await AppDataSource.query(
      `INSERT INTO staff_push_subscriptions (staff_id, endpoint, p256dh, auth, user_agent, last_counts)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET staff_id = EXCLUDED.staff_id, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, last_counts = EXCLUDED.last_counts,
         updated_at = now()`,
      [
        staff.id,
        target.endpoint,
        target.keys.p256dh,
        target.keys.auth,
        userAgent?.slice(0, 300) ?? null,
        counts,
      ],
    );
  },

  async unsubscribe(staffId: string, endpoint: string) {
    await AppDataSource.query(`DELETE FROM staff_push_subscriptions WHERE staff_id = $1 AND endpoint = $2`, [
      staffId,
      endpoint,
    ]);
  },

  async notifyChanges(sender: PushSender | null = null) {
    const send = sender ?? (configured() ? webPushSender : null);
    if (!send) return;
    const rows = (await AppDataSource.query(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.last_counts AS "lastCounts",
              p.id AS "staffId", p.role::text AS role, p.branch_id AS "branchId"
         FROM staff_push_subscriptions s
         JOIN staff_profiles p ON p.id = s.staff_id AND p.status = 'active' AND p.deleted_at IS NULL`,
    )) as Row[];
    const countsByStaff = new Map<string, Promise<BadgeCounts>>();
    for (const row of rows) {
      if (!countsByStaff.has(row.staffId)) countsByStaff.set(row.staffId, badgeCounts(viewerOf(row)));
    }
    await Promise.all(
      rows.map(async (row) => {
        try {
          const counts = await countsByStaff.get(row.staffId)!;
          const before = row.lastCounts ?? counts;
          const risen = (Object.keys(BADGES) as BadgeKey[]).filter(
            (key) => visible(key, row.role) && counts[key] > (before[key] ?? 0),
          );
          await AppDataSource.query(
            `UPDATE staff_push_subscriptions SET last_counts = $2, updated_at = now() WHERE id = $1`,
            [row.id, counts],
          );
          for (const key of risen) {
            await send(
              { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
              {
                title: 'DSM Clinic',
                body: `${BADGES[key].label}: ${counts[key]} waiting`,
                url: BADGES[key].path,
                tag: key,
              },
            );
          }
        } catch (err) {
          if (err instanceof ExpiredSubscriptionError) {
            await AppDataSource.query(`DELETE FROM staff_push_subscriptions WHERE id = $1`, [row.id]);
            return;
          }
          logger.warn({ err }, 'Web push could not be sent');
        }
      }),
    );
  },
};
