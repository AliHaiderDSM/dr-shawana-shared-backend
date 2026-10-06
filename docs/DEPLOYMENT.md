# Deploying the API on Vercel

The API runs on Vercel as one serverless function:

- `api/index.js` loads the compiled handler from `dist/vercel.js`.
- `vercel.json` sends every path to that function.
- The handler opens the database connection on the first request and reuses it while the instance stays warm.

## 1. Project settings

- **Root Directory:** `backend`
- **Framework Preset:** Other

`vercel.json` already sets the install command (`npm ci`) and the build command (`npm run build`). It also includes `dist/**` and `node_modules/swagger-ui-dist/**` in the function: Vercel's file tracing does not see folders served as static files, so without the second glob `/api/docs` loads blank. `pg` is imported directly in `data-source.ts` for the same reason.

## 2. Environment variables (Production)

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **transaction pooler** URI (port 6543). Serverless opens many short connections. |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `5`. Dashboard and list endpoints run several queries in parallel, and the transaction pooler can take them. |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only) |
| `SUPABASE_ANON_KEY` | Anon key |
| `PATIENT_LINK_SECRET` | Optional, at least 32 characters. Signs the patient history links. If it is not set, the links are signed with a key derived from the service role key, and rotating that key ends every open link. |
| `CORS_ORIGINS` | The dashboard URL(s), comma separated, e.g. `https://dsm-dashboard.vercel.app` |
| `LOG_LEVEL` | `info` |

The app refuses to start in production without the Supabase variables. On Vercel that shows up as `500 FUNCTION_INVOCATION_FAILED`. Check **Deployments → Functions → Logs** for the exact message.

## 3. Database

Migrations do not run on deploy. Run them from your machine against the same database:

```
npm run migration:run
```

## 4. Check

- `https://<api>.vercel.app/api/v1/health` should return `{"data":{"status":"ok","database":"up",...}}`.
- `/` returns `404 NOT_FOUND` JSON. That is expected: the API lives under `/api/v1`.

## 5. Dashboard

Point the dashboard at the API with `VITE_API_BASE_URL=https://<api>.vercel.app/api/v1`, and add the dashboard URL to `CORS_ORIGINS`.

## Limits on Vercel

- **Request body:** about 4.5 MB per request. Uploads above that size (the API allows files up to 10 MB) are rejected by Vercel before they reach the API.
- **Duration:** a function may run for at most `maxDuration`, which is 30 s.

## Region and latency

- `vercel.json` pins the function to `bom1` (Mumbai), next to the Supabase project in `ap-south-1`. Every query is a network round trip, so a function in another region adds that distance to every query. Check the `x-vercel-id` response header: it should read `bom1::bom1`, not `bom1::iad1`.
- Every response carries `Server-Timing: db;dur=…;desc="N queries", app;dur=…, total;dur=…`. Watch for a high query count or high `db` time on a single request.
- The first request after an idle period is a cold start: it loads the function and opens the pool, so it is slower than the requests after it.
