---
name: rebase-deployment
description: Guide for deploying Rebase applications. Use this skill when the user needs to deploy to Rebase Cloud, set up Docker, configure Firebase Hosting, or self-host Rebase.
---

# Rebase Deployment

Rebase supports multiple deployment strategies — from fully managed Rebase Cloud to self-hosted Docker deployments.

## Deployment Options

| Option | Best For | Complexity |
|--------|----------|------------|
| **Rebase Cloud** | Fastest setup, managed infrastructure | ⭐ Easy |
| **Docker** | Full control, self-hosted | ⭐⭐ Medium |
| **Firebase Hosting** | Static frontend + Cloud Functions backend | ⭐⭐ Medium |
| **Custom** | Any Node.js hosting (Railway, Render, Fly.io, etc.) | ⭐⭐⭐ Advanced |

## Rebase Cloud

The simplest deployment path. Sign up at [app.rebase.pro](https://app.rebase.pro).

```bash
# 1. Authenticate
rebase login

# 2. Initialize (if new project)
rebase init

# 3. Deploy
rebase deploy

# Deploy to dev environment
rebase deploy --env dev
```

---

## Docker (Self-Hosted)

### Production Dockerfile (Multi-Stage)

The production Dockerfile is a **multi-stage build**. The build context is the **monorepo root** (where `pnpm-workspace.yaml` lives), not the app directory.

> **IMPORTANT FOR AGENTS:** The Dockerfile uses `node:22-alpine`, `corepack enable` (NOT `npm install -g pnpm`), and requires the monorepo root as the build context. Never generate a single-stage Dockerfile or use `node:20`.

```dockerfile
# ── Stage 1: Install + Build ─────────────────────────────────────────
FROM node:22-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN corepack enable

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy source packages and app
COPY packages ./packages
COPY app ./app

# Install all dependencies with flat node_modules for Docker compatibility
# (many packages rely on hoisted devDependencies like @vitejs/plugin-react)
RUN pnpm install --shamefully-hoist

# Build all packages using pnpm recursive with --no-bail.
# Some packages may fail tsc declarations — that's fine, we only need vite bundles + esbuild outputs.
RUN pnpm --filter './packages/*' -r --no-bail run build; exit 0

# Build the backend (TypeScript → JavaScript), then resolve ESM import extensions
# 1. tsc compiles TS→JS  2. tsc-alias resolves path aliases  3. sed adds .js to remaining relative imports
RUN cd app/backend && npx tsc -p tsconfig.docker.json && npx tsc-alias -p tsconfig.docker.json -f \
    && find dist -name '*.js' -exec sed -i 's/from "\(\.[^"]*\)"/from "\1.js"/g; s/\.js\.js/.js/g' {} +

# Build frontend (reads .env.production for VITE_API_URL etc.)
RUN cd app/frontend && npx vite build

# Prune devDependencies to reduce image size
RUN pnpm install --shamefully-hoist --prod

# ── Stage 2: Production Runtime ──────────────────────────────────────
FROM node:22-alpine AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

RUN corepack enable

# Security: run as non-root
RUN addgroup -g 1001 rebase && adduser -u 1001 -G rebase -s /bin/sh -D rebase

WORKDIR /app

# Copy only production artifacts (node_modules already pruned of devDependencies)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/app ./app

# Uploads directory with correct ownership
RUN mkdir -p /app/app/uploads && chown -R rebase:rebase /app

ENV STORAGE_PATH=/app/app/uploads

USER rebase

WORKDIR /app/app/backend
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Copy the entrypoint script and drizzle config for auto-migration
COPY --from=builder /app/app/backend/entrypoint.sh ./entrypoint.sh
COPY --from=builder /app/app/backend/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/app/backend/drizzle ./drizzle

# Auto-migrate then start the compiled JavaScript backend
CMD ["sh", "entrypoint.sh"]
```

**Build command** (run from monorepo root):

```bash
docker build -t rebase-backend -f app/backend/Dockerfile .
```

### Docker Entrypoint (Auto-Migration)

The Docker image uses an entrypoint script (`entrypoint.sh`) that **automatically runs database migrations** before starting the server. Migrations are non-fatal — if they fail (e.g. already applied), the server still starts.

```bash
#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx drizzle-kit migrate --config=drizzle.config.ts 2>&1 || echo "⚠️ Migrations skipped or failed (non-fatal)"

echo "🚀 Starting Rebase backend..."
exec node dist/app/backend/src/index.js
```

> **IMPORTANT FOR AGENTS:** The entrypoint runs `drizzle-kit migrate` automatically on container start. Never add manual migration steps to a Dockerfile CMD — they are handled by `entrypoint.sh`.

### Docker Compose (Monorepo)

This is the monorepo-internal Docker Compose (`app/backend/docker-compose.yml`). Note: the build context is `../..` (monorepo root).

```yaml
services:
  db:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: rebase
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-rebasepassword}
      POSTGRES_DB: rebase
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=256MB"
      - "-c"
      - "max_connections=100"
      - "-c"
      - "log_min_duration_statement=1000"

  backend:
    build:
      context: ../..
      dockerfile: app/backend/Dockerfile
    restart: unless-stopped
    ports:
      - "${PORT:-3001}:3001"
    environment:
      DATABASE_URL: postgresql://rebase:${POSTGRES_PASSWORD:-rebasepassword}@db:5432/rebase
      ADMIN_CONNECTION_STRING: postgresql://rebase:${POSTGRES_PASSWORD:-rebasepassword}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:-super-secret-jwt-key-change-in-production}
      NODE_ENV: ${NODE_ENV:-development}
      PORT: "3001"
      ALLOW_REGISTRATION: ${ALLOW_REGISTRATION:-true}
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - uploads:/app/app/backend/uploads

volumes:
  postgres_data:
    driver: local
  uploads:
    driver: local
```

> **WARNING FOR AGENTS:** The build context is `../..` (monorepo root), NOT `.` or `app/backend`. The Dockerfile path is relative to the monorepo root: `app/backend/Dockerfile`. The `depends_on` uses `condition: service_healthy` so the backend waits for postgres to be ready. **Never use `version: '3.8'`** — modern Docker Compose doesn't use the `version` key.

### Docker Compose (User Template)

For user-generated projects (created via `rebase init`), the Docker Compose file is at the project root. It includes separate backend + frontend services:

```yaml
services:
  db:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: rebase
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=256MB"
      - "-c"
      - "max_connections=100"
      - "-c"
      - "work_mem=4MB"
      - "-c"
      - "effective_cache_size=768MB"
      - "-c"
      - "log_min_duration_statement=1000"

  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    restart: unless-stopped
    ports:
      - "${PORT:-3001}:3001"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://rebase:${DATABASE_PASSWORD:-changeme}@db:5432/rebase?options=-c%20search_path=public
      ADMIN_CONNECTION_STRING: postgresql://rebase:${DATABASE_PASSWORD:-changeme}@db:5432/rebase?options=-c%20search_path=public
      NODE_ENV: production
      PORT: "3001"
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - uploads:/app/backend/uploads

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  postgres_data:
    driver: local
  uploads:
    driver: local
```

Key differences from the monorepo compose:
- Build context is `.` (project root), dockerfile is `backend/Dockerfile`
- Uses `env_file: .env` to load all env vars
- Sets `NODE_ENV: production` explicitly
- Includes a separate `frontend` service (nginx)
- Adds Postgres tuning for `work_mem` and `effective_cache_size`

---

## Environment Variables

### `loadEnv()` — Validated Environment Loading

All environment variables are validated at startup via a Zod schema in `loadEnv()` from `@rebasepro/server-core`. The server **fails immediately** if required variables are missing or invalid.

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server-core";

dotenv.config({ path: "../../.env" });

// Basic — just Rebase env vars:
export const env = loadEnv();
```

> **IMPORTANT FOR AGENTS:** `loadEnv()` does NOT load `.env` files itself. You MUST call `dotenv.config()` (or use `--env-file`, container injection, etc.) **before** calling `loadEnv()`. This is a deployment concern, not a framework concern.

### Extending with Custom Variables

Use the `extend` option to add your own typed env variables on top of the base Rebase schema:

```typescript
import dotenv from "dotenv";
import { loadEnv, z } from "@rebasepro/server-core";

dotenv.config({ path: "../../.env" });

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST        → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string             (validated, required)
```

The `extend` schema is merged with the base `rebaseEnvSchema` using Zod's `.merge()`. All base variables remain available alongside your custom ones.

### `loadEnv()` Function Signature

```typescript
function loadEnv(): RebaseEnv;
function loadEnv<E extends z.AnyZodObject>(options: { extend: E }): RebaseEnv & z.infer<E>;
```

### Complete Environment Variable Reference

All variables recognized by the base `rebaseEnvSchema`:

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `DATABASE_URL` | `string` (URL) | ✅ Yes | — | PostgreSQL connection string |
| `ADMIN_CONNECTION_STRING` | `string` (URL) | No | — | Separate admin connection for migrations |
| `JWT_SECRET` | `string` (≥32 chars) | ✅ Yes | Auto-generated (dev only) | JWT signing secret |
| `JWT_ACCESS_EXPIRES_IN` | `string` | No | `"1h"` | JWT access token expiry (e.g. `"1h"`, `"30m"`) |
| `JWT_REFRESH_EXPIRES_IN` | `string` | No | `"30d"` | JWT refresh token expiry |
| `NODE_ENV` | `enum` | No | `"development"` | `"development"`, `"production"`, or `"test"` |
| `PORT` | `string` → `number` | No | `"3001"` → `3001` | Server port (string, transformed to number) |
| `CORS_ORIGINS` | `string` | ⚠️ Prod | — | Comma-separated allowed origins |
| `FRONTEND_URL` | `string` | ⚠️ Prod | — | Frontend URL (CORS fallback, email links) |
| `ALLOW_REGISTRATION` | `boolString` | No | `"false"` → `false` | Enable new user self-registration |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | `optionalBoolString` | No | `undefined` → `false` | Allow localhost URLs in production |
| `GOOGLE_CLIENT_ID` | `string` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `string` | No | — | Google OAuth client secret |
| `REBASE_SERVICE_KEY` | `string` | No | Auto-generated (dev only) | Service-to-service auth key (≥32 chars) |
| `DB_POOL_MAX` | `string` → `number` | No | `"20"` → `20` | Max database pool connections |
| `DB_POOL_IDLE_TIMEOUT` | `string` → `number` | No | `"30000"` → `30000` | Idle connection timeout (ms) |
| `DB_POOL_CONNECT_TIMEOUT` | `string` → `number` | No | `"10000"` → `10000` | Connection timeout (ms) |
| `DATABASE_DIRECT_URL` | `string` (URL) | No | — | Direct database URL (bypasses pooler) |
| `DATABASE_READ_URL` | `string` (URL) | No | — | Read replica database URL |
| `STORAGE_TYPE` | `enum` | No | `"local"` | `"local"` or `"s3"` |
| `STORAGE_PATH` | `string` | No | — | Local file storage directory |
| `FORCE_LOCAL_STORAGE` | `optionalBoolString` | No | `undefined` → `false` | Suppress local-storage-in-production warning |
| `S3_BUCKET` | `string` | If S3 | — | S3 bucket name |
| `S3_REGION` | `string` | No | — | S3 region |
| `S3_ACCESS_KEY_ID` | `string` | If S3 | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | `string` | If S3 | — | S3 secret key |
| `S3_ENDPOINT` | `string` (URL) | No | — | Custom S3 endpoint (MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | `optionalBoolString` | No | `undefined` → `false` | Use path-style S3 URLs (required for MinIO) |

### Zod Type Helpers

| Helper | Accepts | Result |
|--------|---------|--------|
| `boolString` | `"true"`, `"false"`, `""` | Defaults to `"false"`, transforms to `boolean` |
| `optionalBoolString` | `"true"`, `"false"`, `""`, `undefined` | Transforms `"true"` → `true`, everything else → `false` |

### Auto-Generated Secrets (Dev Only)

In non-production mode, `loadEnv()` auto-generates ephemeral secrets for:
- `JWT_SECRET` — if not set
- `REBASE_SERVICE_KEY` — if not set

These are random hex strings generated via `crypto.randomBytes(48)`. A warning is logged:

```
⚠️  Auto-generated secrets for: JWT_SECRET, REBASE_SERVICE_KEY. These are ephemeral — existing tokens will be invalidated on restart. Set them explicitly in .env for persistent sessions.
```

> **WARNING FOR AGENTS:** Auto-generated secrets are **blocked in production**. The server will crash with a Zod validation error if `JWT_SECRET` or `REBASE_SERVICE_KEY` are not explicitly set when `NODE_ENV=production`.

### Production Validations

When `NODE_ENV=production`, `loadEnv()` enforces these additional rules via Zod `.superRefine()`:

| Rule | Error if violated |
|------|-------------------|
| **CORS required** | At least one of `CORS_ORIGINS` or `FRONTEND_URL` must be set |
| **No auto-generated secrets** | `JWT_SECRET` and `REBASE_SERVICE_KEY` must be explicitly set |
| **No localhost URLs** | All URL-type env vars are scanned — any containing `localhost`, `127.0.0.1`, or `::1` will fail validation (unless `ALLOW_LOCALHOST_IN_PRODUCTION=true`) |

The localhost check applies to **all** string env vars (except `CORS_ORIGINS`) using a helper that parses URLs, custom protocols (e.g. `postgres://`), and plain `host:port` formats.

### `.env.example` Reference

Copy the `.env.example` file as a starting point:

```bash
cp .env.example .env
```

The `.env.example` includes all variables with inline documentation. See `app/.env.example` in the repository.

### `.env.production` (Frontend Build)

The `.env.production` file is read by Vite at build time to bake frontend config into the client bundle:

```bash
# API URL: empty string = same-origin (backend + frontend share the same URL)
VITE_API_URL=

# Google OAuth Client ID (public — embedded in client bundle)
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

> **IMPORTANT FOR AGENTS:** `VITE_API_URL=` (empty) means same-origin — the frontend assumes the API is served from the same host. This works when using `serveSPA()` or a reverse proxy. Only set a full URL when the API is on a different domain.

---

## SPA Serving with `serveSPA()`

In production, the backend can serve the frontend SPA directly, eliminating the need for a separate web server or CDN.

### `serveSPA()` Function Signature

```typescript
import { serveSPA } from "@rebasepro/server-core";

function serveSPA<E extends Env>(app: Hono<E>, config: ServeSPAConfig): void;
```

### `ServeSPAConfig` Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `frontendPath` | `string` | — | **Required.** Absolute path to the frontend build directory |
| `apiBasePath` | `string` | `"/api"` | Base path for API routes (excluded from SPA handling) |
| `excludePaths` | `string[]` | `[]` | Additional paths to exclude from SPA handling (e.g. `["/health", "/ws", "/metrics"]`) |
| `indexFile` | `string` | `"index.html"` | Index file to serve for SPA routes |

### How It Works

1. Serves static files from `frontendPath` using `@hono/node-server/serve-static`
2. For any GET request not matching `apiBasePath` or `excludePaths`, returns `index.html` (SPA fallback)
3. If `frontendPath` doesn't exist, logs a warning and **disables SPA serving** (does not crash)
4. If `index.html` is missing, passes through to the next handler

### Usage Example

```typescript
import { serveSPA } from "@rebasepro/server-core";
import path from "path";

const isProduction = env.NODE_ENV === "production";

// ... after initializeRebaseBackend() ...

if (isProduction) {
    serveSPA(app, {
        frontendPath: path.resolve(process.cwd(), "../frontend/dist"),
        // apiBasePath defaults to "/api" — matches the default Rebase basePath
        // excludePaths: ["/health", "/ws"],
    });
}
```

> **IMPORTANT FOR AGENTS:** Call `serveSPA()` **after** `initializeRebaseBackend()` and after mounting the `/health` endpoint. The SPA catch-all route (`*`) must be the last route registered to avoid intercepting API or health check requests.

---

## Firebase Hosting (Frontend)

Deploy the Studio frontend to Firebase Hosting:

```bash
# Build the frontend
cd frontend
pnpm run build

# Deploy to Firebase
npx firebase-tools@latest deploy --only hosting
```

---

## Health Check Endpoint

The Docker `HEALTHCHECK` instruction hits `/health`. Mount it in your backend entry:

```typescript
app.get("/health", async (c) => {
    const result = await backend.healthCheck();
    const status = result.healthy ? 200 : 503;
    return c.json({
        status: result.healthy ? "ok" : "degraded",
        latencyMs: result.latencyMs,
        ...(result.details ? { details: result.details } : {})
    }, status);
});
```

`healthCheck()` runs `SELECT 1` against the database and returns latency. Returns `{ healthy: boolean, latencyMs: number, details?: { error: string } }`.

---

## Graceful Shutdown

The `RebaseBackendInstance` exposes a `shutdown()` method for clean container termination:

```typescript
const backend = await initializeRebaseBackend({ ... });

const gracefulShutdown = async (signal: string) => {
    await backend.shutdown();          // Stops cron, realtime, drains HTTP (15s timeout)
    await postgresResources.pool.end(); // Close database pool
    process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

`shutdown(timeoutMs?: number)`:
- Default timeout: `15000` ms
- Stops cron scheduler
- Destroys realtime services (LISTEN clients, debounce timers)
- Closes HTTP server and drains in-flight requests
- Pass `0` to skip the force-exit timer (useful in tests)

> **WARNING FOR AGENTS:** Do NOT call `server.close()` separately when using `backend.shutdown()` — it already closes the HTTP server internally. Calling `server.close()` twice will deadlock.

---

## ⛔ Agent Deployment Rules

**Agents should NEVER deploy or run deployment commands unless explicitly asked by the user in the current conversation.** This includes:
- `rebase deploy` (any variant)
- `firebase deploy` (any variant)
- `gcloud functions deploy`
- `gcloud run deploy`
- `terraform apply` (any variant that deploys resources)
- `docker compose up` in production
- Any command targeting staging or production environments

**What agents CAN do:**
- Edit source code
- Run builds (`pnpm run build`)
- Run tests (`pnpm test`)
- Run local dev server (`pnpm dev`)
- Check logs (read-only)
- Create or edit Dockerfiles and docker-compose files
- Create or edit `.env` files
- Run deployment commands *only* if the user explicitly asks you to deploy in the current conversation. Otherwise, provide the exact commands for the user to run.

---

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Dockerfile:** `app/backend/Dockerfile`
- **Docker Compose (monorepo):** `app/backend/docker-compose.yml`
- **Docker Compose (template):** `packages/cli/templates/template/docker-compose.yml`
- **Entrypoint:** `app/backend/entrypoint.sh`
- **Env Schema:** `packages/server-core/src/env.ts`
- **serveSPA:** `packages/server-core/src/serve-spa.ts`
- **Backend Entry:** `app/backend/src/index.ts`
- **.env.example:** `app/.env.example`
