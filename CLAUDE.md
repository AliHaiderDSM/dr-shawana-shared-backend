# DSM Clinic Platform — Backend

This is the multi-branch rebuild of the old PHP system **posSoft**, built one phase at a time from `../progress/backend.md`.

## Before any work

- **Where things are:**
  - Build plan and phase prompts: `../progress/backend.md`.
  - Current phase: `docs/PROGRESS.md`. Implement ONLY the next phase, or the one the user names.
  - Business rules (the source of truth for WHAT to build): `docs/BUSINESS_FLOW.md`. Phases refer to its sections.
  - Summary of posSoft's structure, rules and bugs: `docs/POSSOFT_ANALYSIS.md`.
- **When a phase is done:**
  1. Run `npm run lint`, `npm run typecheck` and `npm test`.
  2. Mark the phase done in `docs/PROGRESS.md` with the date and a summary.
  3. Update `docs/API.md` and run `npm run openapi:export`.
  4. STOP and report. Do not start the next phase until asked.
- If a phase is unclear or conflicts with BUSINESS_FLOW, ask before building.

## Code style (user requirement)

- Write clean, self-explanatory code. Do NOT add comments (no JSDoc, no `//` notes) in source, test or script files. Explain through names and small functions; put explanations in docs/*.md instead.
- Follow posSoft's business flow exactly. The only addition is multi-branch scoping plus role-based routes.

## Hard boundaries

- `../posSoft` is a READ-ONLY reference. Use it only to understand business rules, fields, statuses and screens. Never copy its code or patterns: it uses raw SQL string building, MD5 passwords and varchar money, and has missing auth checks. Its full schema is `../posSoft/backup/pos_dsm.sql`.
- Never modify `../posSoft` or any project outside `backend/`. The public website (dr-shawan) is out of scope and must not be touched or connected.

## Stack (fixed)

- **Runtime:** Node.js 22 LTS or newer, Express 5, TypeScript (strict), compiled to CommonJS. CommonJS is required for TypeORM decorators and the CLI.
  - TypeScript is pinned to 5.9, because ts-jest and typescript-eslint do not support TS 6.1+ or 7.
- **Database:** hosted Supabase Postgres, connected ONLY through `DATABASE_URL` (the Session pooler URI), with SSL on. Do NOT use the Supabase CLI, `supabase init`, `supabase start` or Docker.
- **ORM:** TypeORM (1.x) with the `pg` driver.
  - One DataSource: `AppDataSource` in `src/database/data-source.ts`, used by the app, the tests and the CLI. That file must export exactly one DataSource.
  - `synchronize: false` ALWAYS. `uuidExtension: 'pgcrypto'`, so uuid defaults are `gen_random_uuid()`.
  - Entities live next to their module (`src/modules/<m>/<m>.entity.ts`) or in `src/database/entities`. Every column declares its `type` explicitly.
  - `experimentalDecorators` and `emitDecoratorMetadata` are on, and `reflect-metadata` is imported at every entry point.
- **Migrations:** files in `src/database/migrations` are the ONLY way the schema changes. Never edit tables by hand in the Supabase dashboard.
  - Generate one with `npm run migration:generate -- src/database/migrations/<Name>`, then REVIEW the file.
  - Create an empty one with `npm run migration:create -- src/database/migrations/<Name>`.
  - Other scripts: `migration:run`, `migration:revert`, `migration:show`.
  - Put raw SQL in the migration for anything TypeORM cannot express: enabling RLS, views, functions, triggers, and FKs to Supabase's `auth.users`.
  - CHECK constraints: write them in the migration AND declare them on the entity with `@Check('<same name>', ...)`, otherwise the next generate drops them. Raw-SQL indexes need `@Index('<same name>', { synchronize: false })`.
  - The FK to `auth.users` is added only when `auth.users` exists (a DO block), so migrations also run on a plain Postgres test DB.
  - When generating against Supabase, TypeORM adds a DROP + ADD of `FK_staff_profiles_auth_user`. Delete those two lines from the generated file.
  - After generating, run `migration:generate` once more: it must report "No changes".
  - The migrations table is `typeorm_migrations`.
- **Tests without a second Supabase project:** start any throwaway Postgres (e.g. embedded-postgres outside the repo) and pass `TEST_DATABASE_URL=... DATABASE_SSL=false` on the command line only. The user does not keep `TEST_DATABASE_URL` in `.env`.
- **Supabase Auth and Storage:** accessed through `@supabase/supabase-js`, SERVER-SIDE ONLY (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, in `src/lib/supabase.ts`).
  - Used to verify access tokens, create staff users, upload files and issue signed URLs.
  - The service-role key never leaves the backend.
- **Validation:** Zod (v4) for every request and for env (`src/config/env.ts`). Add new env vars to both `env.ts` and `.env.example`.
- **HTTP middleware:** pino logging (`src/lib/logger.ts`; never use `console` in `src/`), helmet, cors with an allowlist from `CORS_ORIGINS`, and express-rate-limit.
- **Tests:** Jest + ts-jest + supertest, against a SEPARATE database (`TEST_DATABASE_URL`).
  - Global setup runs the migrations. Each suite truncates all tables.
  - Tests refuse to run if `TEST_DATABASE_URL` equals `DATABASE_URL`.
- **OpenAPI:** generated from the Zod schemas with `@asteasolutions/zod-to-openapi`. It is served at `/api/docs`, and `npm run openapi:export` writes it to `docs/openapi.json`. The dashboard and the mobile app use it.
- **Dev server:** nodemon + ts-node. Do not use tsx or esbuild: they do not emit decorator metadata.
  - `tsconfig.json` sets `"ts-node": { "files": true }` so that `src/types/*.d.ts` is loaded.

## Project layout

```
src/
  config/env.ts              zod-validated env; exports env, databaseUrl (test DB under NODE_ENV=test)
  database/
    data-source.ts           AppDataSource
    base.entity.ts           AuditedEntity (timestamps, by, soft delete), BaseEntity (+ uuid id)
    branch-scoped.entity.ts  BranchScopedEntity (branchId + FK to branches)
    transformers.ts          decimalTransformer, moneyColumn(), quantityColumn(), toMoney(), Decimal
    transaction.ts           withTransaction(work, em?), repo(Entity, em?)
    migrations/              TypeORM migrations
    seeds/                   run-seeds.ts (npm run seed), development.seeds.ts, super-admin.ts (npm run seed:super-admin)
  lib/                       supabase, storage, errors (AppError), logger, pagination, http (envelopes + OpenAPI helpers), openapi, permissions, actor
  middleware/                auth, requireRole, requirePermission, branchScope, validate, errorHandler, requestId
  modules/<module>/          <module>.entity.ts .routes.ts .controller.ts .service.ts .repository.ts .schemas.ts .test.ts
  types/express.d.ts         req.auth, req.branchId, req.valid, req.id
  routes.ts                  mounts module routers under /api/v1
  docs.ts                    imports every module's .schemas.ts (OpenAPI registration)
  app.ts, server.ts
tests/                       global setup, per-suite DB setup, helpers (truncate, fixtures, supabase-fake)
docs/                        BUSINESS_FLOW, PROGRESS, API, POSSOFT_ANALYSIS, openapi.json
```

## HTTP conventions

- Every route lives under `/api/v1`. The namespaces are `/auth`, `/admin` (super_admin), `/branch` (staff) and `/app` (patients).
- **Response format:**
  - Success: `{ data, meta? }`, sent with `sendOk` / `sendCreated` from `lib/http`.
  - Error: `{ error: { code, message, details?, requestId } }`.
- **Errors:** services throw `AppError` (e.g. `AppError.notFound('Product')`). The one central `errorHandler` maps AppError, ZodError, and TypeORM/Postgres errors:
  - unique violation → 409
  - FK violation → 400, or 409 when the row is still referenced
  - not-null, check or format violations → 400
  - Unknown errors → 500, with no internals leaked.
- **Async handlers:** Express 5 forwards rejected promises to the error handler, so no `asyncHandler` wrapper is needed.
- **Validation:** `validate({ body, query, params })` stores the parsed values in `req.valid`. Read them with `validBody(req, schema)`, `validQuery(...)` or `validParams(...)`. Express 5's `req.query` is read-only, so never use it after validation.
- **List endpoints:**
  - Build the query schema with `listQuerySchema([...sortable])`, extended with filters.
  - Use `paginate(qb, query, { searchColumns, sortMap })` and return `sendOk(res, items, meta)`.
- **Route middleware order:** `authenticate`, then `branchScope()` (branch routes), then `requirePermission('<module>.<action>')` or `requireRole(...)`, then `validate(...)`, then the controller.
- **Auth context:**
  - `authenticate` verifies the Supabase token, then `authService.resolveContext` loads staff_profiles: unknown profile → 401, inactive staff or inactive/deleted branch → 403.
  - The result is `req.auth = { userId, role, branchId, isSuperAdmin }`.
- **Permissions:** `src/lib/permissions.ts` is the single role → permission matrix, built from the posSoft menus of each role folder. Permissions are `<module>.<view|create|update|delete>`. `/auth/me` returns them for the dashboard menu. The accountant gets view + create only, because posSoft hides edit and delete buttons from everyone except admin.
- **Roles:** super_admin passes every `requireRole` check and has every permission. Branch-scoped routes still make them pick a branch with `?branchId=`, unless `branchScope({ allowAllForSuperAdmin: true })` is set, e.g. for reports.
- **Adding a module:** mount its router in `src/routes.ts` AND import its `.schemas.ts` in `src/docs.ts`.

## MODULE CHECKLIST (every module must follow it)

- Entity + migration:
  - Entities extend BaseEntity, or BranchScopedEntity for branch-owned tables.
  - uuid primary keys.
  - Money is numeric(12,2) and quantities are numeric(12,3), both with the decimal transformer (`moneyColumn()` / `quantityColumn()`). Never varchar. Never use JS floats for money math; use `Decimal`.
  - Real foreign keys, plus indexes on foreign keys and common filters.
  - Enums as Postgres enums or CHECK constraints.
  - Generate the migration, review it, and add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for every new table.
- RLS is ENABLED on every table with NO policies, so the Supabase anon/authenticated keys can never read the DB directly. Only the backend connection can.
- Repository methods for branch-owned data ALWAYS take branchId as a required argument and include it in the WHERE clause. There are no unscoped queries, except in Super Admin services that are explicitly named as such.
- branchId comes from req.auth (set by the auth middleware) through `branchScope` → `req.branchId`. It is NEVER taken from the body or query, except for super_admin, who may pass ?branchId=.
- Every route declares its access with requirePermission('<module>.<action>') (from the matrix in src/lib/permissions.ts), or requireRole(...) for role-specific namespaces such as /admin.
- Zod schemas are used both for validation and for the OpenAPI output (register them in `<module>.schemas.ts` with `registry`).
- Multi-table writes run in ONE transaction, using the EntityManager from the transaction helper (`withTransaction`). Every repository method accepts an optional `EntityManager`.
- Use the QueryBuilder or raw SQL for reports; do not load large relations into memory.
- Sensitive changes (prescriptions, stock, payments, permissions, deletes) write a row to audit_logs.
- Tests cover the happy path, validation failures, wrong role gets 403, and "a user of branch A cannot read or update branch B data".
- Update the docs/API.md module list when done.

## Other rules

- Controllers build the actor with `actorFrom(req)` (userId, role, branchId, ip) and pass it to services for audit logs.
- Soft delete everywhere: use `softDelete` and set `deletedBy`. This replaces posSoft's `close`/`del_by`/`del_date`. Set `createdBy`/`updatedBy` from `req.auth.userId`.
- Files go to Supabase Storage through `lib/storage`.
  - `product-images` is the only public bucket.
  - Object paths are `<branchId>/<ownerId>/<uuid>.<ext>`.
  - Downloads go through the backend, which checks access and returns a short-lived signed URL.
- Seeds must be idempotent.
- **Branch-owned repositories:** build them with `branchScopedRepository(Entity, alias)` (src/database/branch-scoped.repository.ts). Its `create`/`save` reload the row, so numeric columns are real `Decimal` values; plain TypeORM `save()` returns the raw input.
- **Standard CRUD:** use `mountBranchCrud` (src/lib/crud.ts) for routes and `registerCrudDocs` (src/lib/openapi-crud.ts) for OpenAPI. Shared input helpers are in src/lib/validation.ts (`moneyInput`, `quantityInput`, `dateInput`, …).
- **Stock and material ledgers** (`stockLedger`, `materialLedger`):
  - Never write `stock_movements` / `material_movements` directly. Use `apply` (new document), `replace` (edit: reverses the document's movements, then posts new ones) or `reverse` (delete). Each document is one reference (`referenceType` + `referenceId`).
  - The ledgers lock the rows and refuse negative stock.
  - Both tables are append-only (DB trigger).
- **Money and quantities in JSON:** always fixed-scale strings (`"1500.00"`, `"20.000"`). Use `toMoney`/`toQuantity` for computed values.
- **Views** must be created `WITH (security_invoker = true)`, with SELECT revoked from anon/authenticated. A test fails otherwise, and it also fails for any public table without RLS.
- **Uploads:** `imageUpload` / `documentsUpload` / `documentFieldsUpload` (src/lib/upload.ts). Multipart creates send JSON in a `data` field (`jsonDataField`). Upload to storage first with `uploadMany`, then run the DB work inside `withUploads` (src/lib/file-uploads.ts) so the files are removed if it fails.
- **Patients are global** (no branch_id). Every other clinical record is branch-owned and carries `patient_id`. Show a patient's records only for the current branch.
- **Consultation sections** are validated by the schemas in src/modules/consultations/section-schemas.ts, which follow docs/CLINICAL_FIELDS.md. Change both together. Optional section fields default to `null`.
- **Update schemas** must not use `.default()` on fields, or an omitted field overwrites stored data.
- **Prescription catalog** seed data is src/modules/prescriptions/catalog-seed.ts; `code` is the posSoft column name. New branches are seeded in `branchesService.create`, existing ones by `npm run seed`.
- **Document numbers** (invoices, journal entries) come from `nextSequence(manager, branchId, key)` inside the same transaction.
- **Sales:** never trust client prices or totals. Use `saleTotals` and the stock ledger. Front Desk and Team Manager may change only sales they created.
- **Money that moves an account** goes through `journalService.post` (balanced lines). Account balances read the `account_movements` view.
- **Reports** return a `Report` (src/lib/report.ts) and support `format=csv`. Build SQL with `SqlFilter`; never concatenate values. A `null` branch scope means every branch (super_admin).
- **Doctor-role users** only see their own appointments: resolve a `Viewer` with `doctorsService.viewer(actor, branchId)` and filter by `viewer.doctorId`.
- **Debug logging in tests:** `TEST_LOG_LEVEL=error npm test` prints server errors.
- Timezone: posSoft ran on Asia/Karachi. Store `timestamptz`, and use `date` columns for business dates.

## Commands

```
npm run dev              # nodemon + ts-node
npm run build && npm start
npm test                 # needs TEST_DATABASE_URL (a separate DB)
npm run lint / typecheck / format
npm run migration:run | migration:show | migration:revert
npm run migration:generate -- src/database/migrations/<Name>
npm run seed
npm run seed:super-admin  # needs SUPER_ADMIN_EMAIL/PASSWORD + Supabase keys
npm run openapi:export
npm run storage:setup    # creates/updates Supabase buckets (idempotent)
```
