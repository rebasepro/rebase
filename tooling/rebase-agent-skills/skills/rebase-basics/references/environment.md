# Environment variables

## `loadEnv()` Function

Rebase provides `loadEnv()` from `@rebasepro/server` to validate and load environment variables with Zod. Call it **after** your `.env` file has been loaded (e.g. via `dotenv.config()`). It does NOT load `.env` files itself.

### Behavior

- **Auto-generates** ephemeral `JWT_SECRET` and `REBASE_SERVICE_KEY` in non-production mode so developers can start without manual setup
- **Blocks** auto-generated secrets in production (fails validation)
- Returns a fully typed, validated env object

### Signature

```typescript
import { loadEnv } from "@rebasepro/server";

// Basic — just Rebase env vars:
export const env = loadEnv();

// Extended — add your own typed vars:
import { z } from "zod";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string      (validated, required)
```

### Function Overloads

```typescript no-verify
function loadEnv(): RebaseEnv;
function loadEnv<E extends z.AnyZodObject>(options: { extend: E }): RebaseEnv & z.infer<E>;
```

When `extend` is provided, the base `rebaseEnvSchema` is merged (`.merge()`) with your custom Zod object, so all fields are validated together in a single pass.

### The `loadEnv()` schema

Everything `rebaseEnvSchema` declares — what an **ejected** project's own
`backend/src/env.ts` validates.

> **IMPORTANT FOR AGENTS:** this is not the whole environment a project reads. A
> project booted by the **runtime** (`rebase dev`, `rebase start`, the published
> image — the default, and what `rebase init` scaffolds) uses `loadBootEnv`,
> which extends this schema with the variables the runtime itself owns: `SMTP_*`
> and `APP_NAME`; `REBASE_SERVE_STATIC`, `REBASE_MIGRATE_ON_BOOT`,
> `REBASE_METRICS`, `REBASE_METRICS_TOKEN`, `LOG_LEVEL`; `STORAGE_PUBLIC_READ`
> and `STORAGE_ALLOW_ANY_AUTHENTICATED`; `AUTH_REQUIRE`,
> `AUTH_ALLOW_USER_LOOKUP`, `AUTH_COOKIE_SAME_SITE`, `AUTH_DEFAULT_ROLE`,
> `GITHUB_CLIENT_*`, `MICROSOFT_CLIENT_*`; `REBASE_BASE_PATH`,
> `REBASE_ENABLE_SWAGGER`, `REBASE_MAX_BODY_SIZE`, `REBASE_COMPRESSION`,
> `REBASE_HISTORY`; and the split-deployment set `REBASE_ROLE`,
> `REBASE_CRON_SCHEDULER`, `REBASE_JOB_WORKERS`, `REBASE_FUNCTIONS_ONLY`,
> `REBASE_FUNCTIONS_EXCLUDE`, `REBASE_FUNCTIONS_UPSTREAM`. Do not tell a user a
> variable "is not supported" because it is missing from the table below.

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `NODE_ENV` | `"development" \| "production" \| "test"` | `"development"` | No | Environment mode |
| `PORT` | `string` → `number` | `"3001"` | No | Server port |
| `DATABASE_URL` | `string` (URL) | — | **Yes** | PostgreSQL connection string |
| `DATABASE_DIRECT_URL` | `string` (URL) | — | No | Direct connection (bypasses pooler) |
| `DATABASE_READ_URL` | `string` (URL) | — | No | Read replica connection |
| `ADMIN_CONNECTION_STRING` | `string` (URL) | — | No | Admin-level DB connection |
| `JWT_SECRET` | `string` (≥32 chars) | Auto-generated in dev | **Yes** (prod) | JWT signing secret |
| `JWT_ACCESS_EXPIRES_IN` | `string` | `"1h"` | No | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `string` | `"400d"` | No | Refresh token TTL. Sliding — each rotation re-ups it |
| `JWT_PRIVATE_KEY` | `string` (PEM) | — | No | Sign access tokens asymmetrically (RS256). Accepts a real-newline PEM, a `\n`-escaped PEM, or base64 of the whole PEM |
| `JWT_KEY_ID` | `string` | `"default"` | No | The `kid` naming `JWT_PRIVATE_KEY` in the token header and the JWKS |
| `REBASE_SERVICE_KEY` | `string` | Auto-generated in dev | No | Static key for server-to-server auth |
| `GOOGLE_CLIENT_ID` | `string` | — | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `string` | — | No | Google OAuth client secret |
| `ALLOW_REGISTRATION` | `"true" \| "false"` | `"false"` | No | Allow public user registration. The first user on an empty table is admitted regardless |
| `DISABLE_SELF_REGISTRATION` | `"true" \| "false"` | — | No | Kill switch — also closes the first-user bootstrap window |
| `ALLOW_ANONYMOUS` | `"true" \| "false"` | — | No | Enable `POST /api/auth/anonymous` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | `"true" \| "false"` | — | No | Skip localhost URL checks in production |
| `CORS_ORIGINS` | `string` | — | **Yes** (prod) | Allowed CORS origins (comma-separated) |
| `FRONTEND_URL` | `string` | — | Prod alt | Alternative to CORS_ORIGINS for single frontend |
| `DB_POOL_MAX` | `string` → `number` | `"20"` | No | Max database pool connections |
| `DB_POOL_IDLE_TIMEOUT` | `string` → `number` | `"30000"` | No | Pool idle timeout (ms) |
| `DB_POOL_CONNECT_TIMEOUT` | `string` → `number` | `"10000"` | No | Pool connect timeout (ms) |
| `STORAGE_TYPE` | `"local" \| "s3" \| "gcs"` | `"local"` | No | File storage backend type |
| `STORAGE_PATH` | `string` | — | No | Local storage directory path |
| `FORCE_LOCAL_STORAGE` | `"true" \| "false"` | — | No | Allow `STORAGE_TYPE=local` in production. Without it the local backend is **not registered** — the backend still boots and serves data, auth and realtime, but uploads are refused with `501 STORAGE_NOT_CONFIGURED` rather than landing on a filesystem the next redeploy erases. Set it only when a durable volume really is mounted at `STORAGE_PATH` |
| `S3_BUCKET` | `string` | — | When S3 | S3 bucket name |
| `S3_REGION` | `string` | — | When S3 | S3 region |
| `S3_ACCESS_KEY_ID` | `string` | — | When S3 | S3 access key |
| `S3_SECRET_ACCESS_KEY` | `string` | — | When S3 | S3 secret key |
| `S3_ENDPOINT` | `string` (URL) | — | No | Custom S3 endpoint (MinIO, R2, etc.) |
| `S3_FORCE_PATH_STYLE` | `"true" \| "false"` | — | No | Use path-style S3 URLs |
| `GCS_BUCKET` | `string` | — | When GCS | GCS/Firebase Storage bucket name |
| `GCS_PROJECT_ID` | `string` | — | When GCS | GCP project ID |
| `GCS_KEY_FILENAME` | `string` (path) | — | No | GCP service-account key file. Omit on GCP: Workload Identity/ADC supplies credentials |
| `GOOGLE_APPLICATION_CREDENTIALS` | `string` (path) | — | No | Standard ADC variable, read by the Google SDK itself rather than by `loadEnv()` |

### Production Validations

`loadEnv()` enforces these rules when `NODE_ENV=production`:

1. `CORS_ORIGINS` or `FRONTEND_URL` **must** be set
2. `JWT_SECRET` and `REBASE_SERVICE_KEY` **must** be explicitly set (auto-generation disabled)
3. No environment variable may contain a localhost/loopback URL (unless `ALLOW_LOCALHOST_IN_PRODUCTION=true`)

### Auto-Generated Dev Secrets

In non-production mode, `loadEnv()` automatically generates cryptographically secure random values for `JWT_SECRET` and `REBASE_SERVICE_KEY` using `crypto.randomBytes(48).toString("hex")` when they are not set. This means:

- **Developers can start immediately** without creating a `.env` file
- **Existing JWT tokens are invalidated on every server restart** because the secret changes
- A console warning is emitted: `⚠️ Auto-generated secrets for: JWT_SECRET, REBASE_SERVICE_KEY...`
- To persist sessions across restarts, set these values explicitly in `.env`
