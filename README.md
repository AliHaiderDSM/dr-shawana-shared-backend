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

| Script                                                  | Purpose                                               |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `dev`                                                   | nodemon + ts-node dev server                          |
| `build` / `start`                                       | compile to `dist/` and run it                         |
| `test`                                                  | Jest + supertest against `TEST_DATABASE_URL`          |
| `lint` / `typecheck` / `format`                         | code quality                                          |
| `migration:generate -- src/database/migrations/<Name>`  | generate a migration from entity changes (review it!) |
| `migration:create -- src/database/migrations/<Name>`    | create an empty migration                             |
| `migration:run` / `migration:revert` / `migration:show` | apply, undo or list migrations                        |
| `seed`                                                  | run the idempotent seeds                              |
| `openapi:export`                                        | write `docs/openapi.json`                             |
