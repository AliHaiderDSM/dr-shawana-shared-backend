# Deploying the API on Vercel

The API runs on Vercel as one serverless function:

- `api/index.js` loads the compiled handler from `dist/vercel.js`.
- `vercel.json` sends every path to that function.
- The handler opens the database connection on the first request and reuses it while the instance stays warm.

## 1. Project settings

- **Root Directory:** `backend`
- **Framework Preset:** Other

`vercel.json` already sets the install command (`npm ci`), the build command (`npm run build`) and includes `dist/**` in the function.

## 2. Environment variables (Production)

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **transaction pooler** URI (port 6543). Serverless opens many short connections. |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `2` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only) |
| `SUPABASE_ANON_KEY` | Anon key |
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
