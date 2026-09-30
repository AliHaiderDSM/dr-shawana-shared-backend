import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../../src/database/data-source';
import { type Role } from '../../src/lib/permissions';
import { Branch, type BranchStatus } from '../../src/modules/branches/branch.entity';
import { StaffProfile, type StaffStatus } from '../../src/modules/staff/staff-profile.entity';
import { type FakeSupabase } from './supabase-fake';

export const TEST_PASSWORD = 'Passw0rd!';

let sequence = 0;
const next = () => (sequence += 1);

export async function createBranch(overrides: Partial<Branch> & { status?: BranchStatus } = {}) {
  const n = next();
  const branches = AppDataSource.getRepository(Branch);
  return branches.save(
    branches.create({
      name: `Branch ${n}`,
      code: `B${n}`,
      city: 'Lahore',
      isHeadOffice: false,
      status: 'active',
      ...overrides,
    }),
  );
}

export async function createStaff(
  fake: FakeSupabase,
  options: { role: Role; branchId: string | null; status?: StaffStatus; username?: string },
) {
  const n = next();
  const username = options.username ?? `user${n}`;
  const email = `${username}@test.dsm`;
  const id = fake.addUser(email, TEST_PASSWORD, randomUUID());
  const profiles = AppDataSource.getRepository(StaffProfile);
  return profiles.save(
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
}

export const bearer = (staff: { id: string }) => ({ Authorization: `Bearer ${staff.id}` });
