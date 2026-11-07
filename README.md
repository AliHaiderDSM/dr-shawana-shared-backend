# DSM Clinic Platform — Backend

This is the multi-branch clinic backend (the rebuild of posSoft), built with Node.js, Express 5, TypeScript, TypeORM and hosted Supabase Postgres.
The project rules are in [CLAUDE.md](CLAUDE.md), the business flow in [docs/BUSINESS_FLOW.md](docs/BUSINESS_FLOW.md), and the build status in [docs/PROGRESS.md](docs/PROGRESS.md).

## Setup

1. Install dependencies with `npm install`. This needs Node 22 or newer.
2. Copy `.env.example` to `.env` and fill it in:
   - `DATABASE_URL`: Supabase → Project Settings → Database → Connection string → **Session pooler**.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`: Supabase → Project Settings → API.
   - `TEST_DATABASE_URL`: a **different** database (a second Supabase project or any Postgres). It is only needed for `npm test`.
3. Apply the schema with `npm run migration:run`.
4. Start the server with `npm run dev`. Then open:
   - http://localhost:4000/api/v1/health
   - http://localhost:4000/api/docs

## Scripts

| Script                                                  | Purpose                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `dev`                                                   | nodemon + ts-node dev server                               |
| `build` / `start`                                       | compile to `dist/` and run it                              |
| `test`                                                  | Jest + supertest against `TEST_DATABASE_URL`               |
| `lint` / `typecheck` / `format`                         | code quality                                               |
| `migration:generate -- src/database/migrations/<Name>`  | generate a migration from entity changes (review it!)      |
| `migration:create -- src/database/migrations/<Name>`    | create an empty migration                                  |
| `migration:run` / `migration:revert` / `migration:show` | apply, undo or list migrations                             |
| `seed`                                                  | run the idempotent seeds                                   |
| `seed:super-admin`                                      | create the Super Admin from `SUPER_ADMIN_EMAIL`/`PASSWORD` |
| `openapi:export`                                        | write `docs/openapi.json`                                  |

## Reset the database (start from zero)

This deletes **every** record and login. Take a backup first (Supabase → Database → Backups) and never do it on a live clinic by mistake.

### 1. Empty the app data (public schema)

Run in Supabase → SQL Editor:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
```

The backend connects as `postgres` and every table has row level security with no policies, so `anon` and `authenticated` get no access, which is what the app expects.

### 2. Logins

Staff logins live in `staff_credentials` and `staff_sessions` in the public schema, so the reset above already removes them. Run `npm run seed:super-admin` again to create the Super Admin.

### 3. Uploaded files (optional)

Files stay in Supabase Storage (medical records, payment proofs, chat voice, signatures, stock files, product images). To remove them, empty each bucket in Supabase → Storage. Keep the buckets themselves.

### 4. Build it again

```bash
npm run migration:run      # tables, views and indexes
npm run seed:super-admin   # Super Admin from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in .env
npm run seed               # company info and the prescription catalogue
```

Then sign in as the Super Admin and add branches, staff, doctors, products and account sheets again. Remove `SUPER_ADMIN_PASSWORD` from `.env` after the seed.
