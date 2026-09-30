import { AppError } from '../../lib/errors';
import { getSupabaseAdmin } from '../../lib/supabase';

const PERMANENT_BAN = '876000h';

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
