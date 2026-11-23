import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const map = argument('map');
  if (!map) {
    throw new Error(
      'Pass the moves as --map "username:CODE,username:CODE" (only doctors that change branch)',
    );
  }
  const moves = map
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [username, code] = part.split(':').map((s) => s.trim());
      if (!username || !code) throw new Error(`Bad entry "${part}". Use username:CODE`);
      return { username: username.toLowerCase(), code: code.toUpperCase() };
    });

  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (em) => {
      for (const move of moves) {
        const [branch] = (await em.query(
          `SELECT id FROM branches WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
          [move.code],
        )) as { id: string }[];
        if (!branch) {
          console.log(`SKIP ${move.username}: no branch with code ${move.code}`);
          continue;
        }
        const [staff] = (await em.query(
          `SELECT id FROM staff_profiles WHERE username = $1 AND role = 'doctor'`,
          [move.username],
        )) as { id: string }[];
        if (!staff) {
          console.log(`SKIP ${move.username}: no doctor login with that username`);
          continue;
        }
        await em.query(`UPDATE staff_profiles SET branch_id = $2, updated_at = now() WHERE id = $1`, [
          staff.id,
          branch.id,
        ]);
        await em.query(
          `UPDATE doctors SET branch_id = $2, updated_at = now() WHERE staff_id = $1 AND deleted_at IS NULL`,
          [staff.id, branch.id],
        );
        console.log(`${move.username} -> ${move.code}`);
      }
    });
    console.log('Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Fix failed:', err);
  process.exit(1);
});
