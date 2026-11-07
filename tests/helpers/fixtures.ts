import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../../src/database/data-source';
import { signAccessToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { type Role } from '../../src/lib/permissions';
import { Branch, type BranchStatus } from '../../src/modules/branches/branch.entity';
import { StaffProfile, type StaffStatus } from '../../src/modules/staff/staff-profile.entity';
import { staffAccounts } from '../../src/modules/staff/staff-accounts';
import { type FakeSupabase } from './supabase-fake';

export const TEST_PASSWORD = 'Passw0rd!';

let sequence = 0;
let passwordHash: Promise<string> | null = null;
const next = () => (sequence += 1);

export async function ageBatch(batchNo: string, expiryDate: string) {
  await AppDataSource.query(`UPDATE product_batches SET expiry_date = $2 WHERE batch_no = $1`, [
    batchNo,
    expiryDate,
  ]);
  await AppDataSource.query(`UPDATE stock_ins SET expiry_date = $2 WHERE batch = $1`, [batchNo, expiryDate]);
}

export async function createBranch(overrides: Partial<Branch> & { status?: BranchStatus } = {}) {
  const n = next();
  const branches = AppDataSource.getRepository(Branch);
  return branches.save(
    branches.create({
      name: `Branch ${n}`,
      code: `B${n}`,
      city: 'Lahore',
      status: 'active',
      onlineSales: true,
      ...overrides,
    }),
  );
}

export async function createStaff(
  _storage: FakeSupabase,
  options: { role: Role; branchId: string | null; status?: StaffStatus; username?: string },
) {
  const n = next();
  const username = options.username ?? `user${n}`;
  const email = `${username}@test.dsm`;
  const id = randomUUID();
  const profiles = AppDataSource.getRepository(StaffProfile);
  const profile = await profiles.save(
    profiles.create({
      id,
      branchId: options.branchId,
      role: options.role,
      firstName: 'Test',
      lastName: `User ${n}`,
      email,
      username,
      status: options.status ?? 'active',
      mustChangePassword: false,
    }),
  );
  passwordHash ??= hashPassword(TEST_PASSWORD);
  await staffAccounts.saveHash(id, await passwordHash);
  await openTestSession(id);
  return profile;
}

export async function openTestSession(staffId: string) {
  await AppDataSource.query(
    `INSERT INTO staff_sessions (id, staff_id, refresh_hash, expires_at, absolute_expires_at)
     VALUES ($1, $1, encode(gen_random_bytes(32), 'hex'), now() + interval '1 day', now() + interval '1 day')
     ON CONFLICT (id) DO NOTHING`,
    [staffId],
  );
}

export const tokenFor = (staff: { id: string }, sessionId = staff.id) =>
  signAccessToken(staff.id, sessionId).token;

export const bearer = (staff: { id: string }) => ({ Authorization: `Bearer ${tokenFor(staff)}` });
