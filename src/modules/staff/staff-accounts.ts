import { AppDataSource } from '../../database/data-source';
import { AppError } from '../../lib/errors';
import { getSupabaseAdmin } from '../../lib/supabase';

const PERMANENT_BAN = '876000h';
const PAGE_SIZE = 1000;

async function findAuthUserId(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < PAGE_SIZE) return null;
  }
}

async function hasProfile(userId: string) {
  const rows = (await AppDataSource.query(`SELECT 1 FROM staff_profiles WHERE id = $1 LIMIT 1`, [
    userId,
  ])) as unknown[];
  return rows.length > 0;
}

async function reclaimOrphan(email: string, password: string, metadata: Record<string, unknown>) {
  const userId = await findAuthUserId(email);
  if (!userId || (await hasProfile(userId))) return null;
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    user_metadata: metadata,
    ban_duration: 'none',
  });
  return error ? null : userId;
}

export const staffAccounts = {
  async create(email: string, password: string, metadata: Record<string, unknown>): Promise<string> {
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error || !data.user) {
      if (error?.status === 422 || /already/i.test(error?.message ?? '')) {
        const reclaimed = await reclaimOrphan(email, password, metadata);
        if (reclaimed) return reclaimed;
        throw AppError.conflict('A login with this email already exists');
      }
      throw AppError.badGateway(`Could not create login: ${error?.message ?? 'unknown error'}`);
    }
    return data.user.id;
  },

  async remove(userId: string): Promise<void> {
    await getSupabaseAdmin().auth.admin.deleteUser(userId);
  },

  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, { password });
    if (error) throw AppError.badGateway(`Could not update password: ${error.message}`);
  },

  async setEmail(userId: string, email: string): Promise<void> {
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (error) throw AppError.badGateway(`Could not update login email: ${error.message}`);
  },

  async setBlocked(userId: string, blocked: boolean): Promise<void> {
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
      ban_duration: blocked ? PERMANENT_BAN : 'none',
    });
    if (error) throw AppError.badGateway(`Could not update login status: ${error.message}`);
  },
};
