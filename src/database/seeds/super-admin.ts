import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { StaffProfile } from '../../modules/staff/staff-profile.entity';
import { staffAccounts } from '../../modules/staff/staff-accounts';
import { AppDataSource } from '../data-source';

async function main() {
  const email = env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env first');
  if (password.length < 8) throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters');

  await AppDataSource.initialize();
  try {
    const profiles = AppDataSource.getRepository(StaffProfile);
    const passwordHash = await staffAccounts.hashPassword(password);
    const existing = await profiles.findOne({ where: { email }, withDeleted: true });
    if (existing) {
      await AppDataSource.transaction(async (em) => {
        await em.getRepository(StaffProfile).restore({ id: existing.id });
        await em
          .getRepository(StaffProfile)
          .update({ id: existing.id }, { role: 'super_admin', branchId: null, status: 'active' });
        await staffAccounts.saveHash(existing.id, passwordHash, em);
      });
      console.log(
        `Super admin profile already exists for ${email}; its password now matches SUPER_ADMIN_PASSWORD.`,
      );
      return;
    }
    const username =
      email
        .split('@')[0]
        ?.replace(/[^a-z0-9._-]/g, '')
        .slice(0, 50) || 'superadmin';
    await AppDataSource.transaction(async (em) => {
      const repo = em.getRepository(StaffProfile);
      const profile = await repo.save(
        repo.create({
          id: randomUUID(),
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
      await staffAccounts.saveHash(profile.id, passwordHash, em);
    });
    console.log(`Super admin ready: ${email} (username: ${username})`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Super admin seed failed:', err);
  process.exit(1);
});
