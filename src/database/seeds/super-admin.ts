import 'reflect-metadata';
import { type User } from '@supabase/supabase-js';
import { env } from '../../config/env';
import { getSupabaseAdmin } from '../../lib/supabase';
import { StaffProfile } from '../../modules/staff/staff-profile.entity';
import { AppDataSource } from '../data-source';

async function findAuthUserByEmail(email: string): Promise<User | null> {
  const admin = getSupabaseAdmin().auth.admin;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
}

async function ensureAuthUser(email: string, password: string): Promise<string> {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log('Auth user already exists; its password now matches SUPER_ADMIN_PASSWORD.');
    return existing.id;
  }
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName: 'Super', lastName: 'Admin', role: 'super_admin' },
  });
  if (error || !data.user) throw error ?? new Error('Supabase did not return a user');
  console.log('Auth user created.');
  return data.user.id;
}

async function main() {
  const email = env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env first');
  if (password.length < 8) throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters');

  await AppDataSource.initialize();
  try {
    const userId = await ensureAuthUser(email, password);
    const profiles = AppDataSource.getRepository(StaffProfile);
    const existing = await profiles.findOne({ where: { id: userId }, withDeleted: true });
    if (existing) {
      await profiles.restore({ id: userId });
      await profiles.update({ id: userId }, { role: 'super_admin', branchId: null, status: 'active' });
      console.log(`Super admin profile already exists for ${email}.`);
      return;
    }
    const username =
      email
        .split('@')[0]
        ?.replace(/[^a-z0-9._-]/g, '')
        .slice(0, 50) || 'superadmin';
    await profiles.save(
      profiles.create({
        id: userId,
        branchId: null,
        role: 'super_admin',
        firstName: 'Super',
        lastName: 'Admin',
        email,
        username,
        status: 'active',
        mustChangePassword: false,
      }),
    );
    console.log(`Super admin ready: ${email} (username: ${username})`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Super admin seed failed:', err);
  process.exit(1);
});
