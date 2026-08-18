---
name: rebase-deployment
description: Guide for deploying Rebase applications. Use this skill when the user needs to deploy to Rebase Cloud, set up Docker, self-host on AWS/GCP/Hetzner, or use a PaaS like Railway or Render.
---

# Rebase Deployment

Rebase supports multiple deployment strategies — from fully managed Rebase Cloud to self-hosted Docker deployments.

## Deployment Options

| Option | Best For | Complexity |
|--------|----------|------------|
| **Rebase Cloud** | Fastest setup, managed infrastructure | ⭐ Easy |
| **Docker (Self-Hosted)** | Full control on any VPS or bare metal | ⭐⭐ Medium |
| **AWS** | ECS/Fargate or EC2 with RDS PostgreSQL | ⭐⭐⭐ Advanced |
| **GCP** | Cloud Run with Cloud SQL PostgreSQL | ⭐⭐⭐ Advanced |
| **Azure** | Container Apps with Azure Database for PostgreSQL | ⭐⭐⭐ Advanced |
| **Scaleway** | Serverless Containers with Managed PostgreSQL (EU-only) | ⭐⭐⭐ Advanced |
| **Hetzner** | Cost-effective VPS with Docker Compose | ⭐⭐ Medium |
| **PaaS** | Railway, Render, Fly.io — Docker-based platforms | ⭐⭐ Medium |
| **Kubernetes** | The `charts/rebase` Helm chart — one process or several | ⭐⭐⭐ Advanced |

## Rebase Cloud

The simplest deployment path. Sign up at [app.rebase.pro](https://app.rebase.pro).

```bash
# 1. Authenticate
rebase cloud login

# 2. Initialize (if new project)
rebase init

# 3. Link this directory to a cloud project
rebase cloud link

# 4. Deploy
rebase cloud deploy

# Deploy and label the release
rebase cloud deploy --message "add search to posts"
```

<!-- docs-verify: ignore -->
> Every cloud command lives under the `cloud` namespace — there is no bare
> `rebase deploy` or `rebase login`, and a mistyped one exits 1. Run
> `rebase cloud --help` for the full list.

### What a Cloud Deployment Serves

`rebase cloud deploy` ships **one container** per project, served at `https://<project>.rebase.website`. That container runs your backend, which handles:

- **`/api/*`** — the data API, auth, realtime, storage
- **everything else** — your built `frontend/` as a static SPA (via `serveSPA()`, see below)

There is **no separate admin URL** — the admin panel is part of your frontend, so where it appears depends on what your frontend is:

| Project type | What the root URL shows | Where the admin is |
|--------------|------------------------|--------------------|
| Default scaffold (`rebase init`) | The admin panel itself (login / bootstrap) | `/` — the frontend **is** the admin |
| Custom product frontend | Your product app | Wherever you mount it — commonly `/admin` (see below) |
| Backend-only (`rebase init --headless`) | Nothing (API only) | Not deployed |

> **IMPORTANT FOR AGENTS:** On the **first visit** to a freshly deployed project's admin, Rebase shows the bootstrap screen ("Create your admin account"). The earliest-registered account receives admin privileges — the project owner should claim it immediately after deploying. Never fill this form on the user's behalf.

**Mounting the admin at `/admin` alongside a product app** — a single Vite entry can serve both, split by URL, so visitors never download the admin bundle:

```tsx
// frontend/src/main.tsx
const isAdmin = window.location.pathname.startsWith("/admin");
const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseAdmin basePath="/admin" .../>

// route "/admin/*" → AdminApp, everything else → ProductApp
```

Set **either** a router `basename="/admin"` **or** `<RebaseAdmin basePath="/admin">` — not both, or the prefix is applied twice.

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

All environment variables are validated at startup via a Zod schema in `loadEnv()` from `@rebasepro/server`. The server **fails immediately** if required variables are missing or invalid.

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Basic — just Rebase env vars:
export const env = loadEnv();
```

> **IMPORTANT FOR AGENTS:** `loadEnv()` does NOT load `.env` files itself. You MUST call `dotenv.config()` (or use `--env-file`, container injection, etc.) **before** calling `loadEnv()`. This is a deployment concern, not a framework concern.

### Extending with Custom Variables

Use the `extend` option to add your own typed env variables on top of the base Rebase schema:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";
import { z } from "zod";

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

```typescript no-verify
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
| `STORAGE_TYPE` | `enum` | No | `"local"` | `"local"`, `"s3"`, or `"gcs"` |
| `STORAGE_PATH` | `string` | No | — | Local file storage directory |
| `FORCE_LOCAL_STORAGE` | `optionalBoolString` | No | `undefined` → `false` | Allow `STORAGE_TYPE=local` in production — **the backend refuses to boot without it** |
| `S3_BUCKET` | `string` | If S3 | — | S3 bucket name |
| `S3_REGION` | `string` | No | — | S3 region |
| `S3_ACCESS_KEY_ID` | `string` | If S3 | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | `string` | If S3 | — | S3 secret key |
| `GCS_BUCKET` | `string` | If GCS | — | GCS bucket name |
| `GCS_PROJECT_ID` | `string` | No | — | GCP project (auto-detected from credentials) |
| `GCS_KEY_FILENAME` | `string` | No | — | Service-account key file; omit on GKE (Workload Identity/ADC) |

> **Deploying with `STORAGE_TYPE=local` fails to boot in production.** Local storage is the container filesystem, so uploads are destroyed on the next restart — silently, with no error at write or read time. Set `STORAGE_TYPE=s3`/`gcs`, or `FORCE_LOCAL_STORAGE=true` if a durable volume really is mounted at `STORAGE_PATH`. A crashed rollout is recoverable; lost user files are not.
| `S3_ENDPOINT` | `string` (URL) | No | — | Custom S3 endpoint (MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | `optionalBoolString` | No | `undefined` → `false` | Use path-style S3 URLs (required for MinIO) |
| `GCS_BUCKET` | `string` | If GCS | — | Google Cloud Storage bucket name |
| `GCS_PROJECT_ID` | `string` | If GCS | — | GCP project ID for GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | `string` | If GCS (non-GCP) | — | Path to GCP service account JSON key file (not needed on GCP with default credentials) |

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
declare function serveSPA<E extends Env>(app: Hono<E>, config: ServeSPAConfig): void;
```

### `ServeSPAConfig` Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `frontendPath` | `string` | — | **Required.** Absolute path to the frontend build directory |
| `basePath` | `string` | `"/"` | Public path prefix this app is served under. No trailing slash unless it *is* `"/"`. Several apps can run in one process — a site at `/`, the admin at `/admin` — so assets and the SPA fallback are scoped here instead of claiming `/*`. |
| `apiBasePath` | `string` | `"/api"` | Base path for API routes (excluded from SPA handling) |
| `excludePaths` | `string[]` | `[]` | Additional paths to exclude from SPA handling (e.g. `["/health", "/ws", "/metrics"]`) |
| `indexFile` | `string` | `"index.html"` | Index file to serve for SPA routes |

### How It Works

1. Serves static files from `frontendPath` using `@hono/node-server/serve-static`
2. For any GET request not matching `apiBasePath` or `excludePaths`, returns `index.html` (SPA fallback)
3. If `frontendPath` doesn't exist, logs a warning and **disables SPA serving** (does not crash)
4. If `index.html` is missing, passes through to the next handler

### Serving several apps from one process

Two rules, and you need **both** — either one alone produces a bug that reads as
an application error rather than a routing one:

1. **Mount longest-path-first.** `/admin` before `/`.
2. **Every app rooted at `/` must list its siblings in `excludePaths`.** Without
   this, a request under `/admin` that misses the admin's files falls through to
   the root app's catch-all and is answered with the *site's* `index.html` at the
   admin's URL.

`excludePaths` matches path *segments*, not string prefixes: `"/admin"` excludes
`/admin` and `/admin/x`, but not `/administrators`.

```typescript
// The admin, mounted under a prefix, first.
serveSPA(app, {
    frontendPath: path.resolve(process.cwd(), "../admin/dist"),
    basePath: "/admin"
});

// Then the site at the root, which must exclude the admin.
serveSPA(app, {
    frontendPath: path.resolve(process.cwd(), "../frontend/dist"),
    excludePaths: ["/health", "/ws", "/admin"]
});
```

> **`basePath` is also a build-time input.** A Vite app built with the default
> `base: "/"` but served under `/admin` loads `index.html` and 404s every asset —
> a blank page with no server error. `rebase build` passes `REBASE_APP_BASE` and
> asserts the emitted HTML honours it.

### Usage Example

```typescript
import { serveSPA } from "@rebasepro/server";
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

## AWS (ECS/Fargate + RDS)

Deploy the Rebase Docker image to AWS using ECS (Fargate) with a managed PostgreSQL database via RDS.

### Architecture

```
Internet → ALB (HTTPS) → ECS Fargate (Rebase container) → RDS PostgreSQL
                                                        → S3 (file storage)
```

### Key Steps

1. **PostgreSQL** — Create an RDS PostgreSQL 16+ instance (or Aurora Serverless v2). Enable automated backups. Place in a private subnet.
2. **Docker Image** — Push the Rebase Docker image to ECR:
   ```bash
   # Build and tag
   docker build -t rebase-backend -f app/backend/Dockerfile .
   docker tag rebase-backend:latest <account-id>.dkr.ecr.<region>.amazonaws.com/rebase-backend:latest

   # Push
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/rebase-backend:latest
   ```
3. **ECS Task Definition** — Define a Fargate task with the container image, port `3001`, and environment variables (see env var reference above). Use AWS Secrets Manager for `JWT_SECRET`, `REBASE_SERVICE_KEY`, and `DATABASE_URL`.
4. **ALB** — Create an Application Load Balancer with HTTPS listener (ACM certificate). Target group pointing to the ECS service on port `3001`. Configure the health check path to `/health`.
5. **File Storage** — Set `STORAGE_TYPE=s3` with an S3 bucket. Grant the ECS task role `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` permissions.

### Key Environment Variables

```bash
DATABASE_URL=postgresql://rebase:<password>@<rds-endpoint>:5432/rebase
JWT_SECRET=<your-secret-min-32-chars>
REBASE_SERVICE_KEY=<your-service-key-min-32-chars>
CORS_ORIGINS=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
NODE_ENV=production
STORAGE_TYPE=s3
S3_BUCKET=your-rebase-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<iam-key-or-use-task-role>
S3_SECRET_ACCESS_KEY=<iam-secret>
```

> **TIP:** Use IAM task roles instead of static access keys for S3. Attach the policy to the ECS task execution role and omit `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — the AWS SDK will use the role credentials automatically.

---

## GCP (Cloud Run + Cloud SQL)

Deploy the Rebase Docker image to Cloud Run with Cloud SQL for PostgreSQL.

### Architecture

```
Internet → Cloud Run (HTTPS, auto-scaling) → Cloud SQL PostgreSQL
                                            → GCS or S3-compatible (file storage)
```

### Key Steps

1. **PostgreSQL** — Create a Cloud SQL for PostgreSQL 16+ instance. Enable private IP or use the Cloud SQL Auth Proxy.
2. **Docker Image** — Push to Artifact Registry:
   ```bash
   # Build and tag
   docker build -t rebase-backend -f app/backend/Dockerfile .
   docker tag rebase-backend:latest <region>-docker.pkg.dev/<project-id>/rebase/backend:latest

   # Push
   gcloud auth configure-docker <region>-docker.pkg.dev
   docker push <region>-docker.pkg.dev/<project-id>/rebase/backend:latest
   ```
3. **Cloud Run Service** — Deploy with the Cloud SQL connection:
   ```bash
   gcloud run deploy rebase-backend \
     --image <region>-docker.pkg.dev/<project-id>/rebase/backend:latest \
     --region <region> \
     --port 3001 \
     --add-cloudsql-instances <project-id>:<region>:<instance-name> \
     --set-env-vars "NODE_ENV=production,CORS_ORIGINS=https://yourdomain.com,FRONTEND_URL=https://yourdomain.com" \
     --set-secrets "DATABASE_URL=rebase-db-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest" \
     --min-instances 1 \
     --memory 512Mi \
     --allow-unauthenticated
   ```
4. **Custom Domain** — Map a custom domain in Cloud Run settings. Cloud Run provides HTTPS automatically.
5. **File Storage** — Use native GCS support with `STORAGE_TYPE=gcs`:
   ```bash
   STORAGE_TYPE=gcs
   GCS_BUCKET=your-rebase-uploads
   GCS_PROJECT_ID=your-gcp-project-id
   ```
   On Cloud Run, the default service account credentials are used automatically — no key file needed. Alternatively, you can fall back to `STORAGE_TYPE=s3` with the GCS S3-compatible interop endpoint.

### Cloud SQL Auth Proxy (Connection String)

When using the Cloud SQL connector in Cloud Run, the database is exposed via a Unix socket:

```bash
DATABASE_URL=postgresql://rebase:<password>@localhost/rebase?host=/cloudsql/<project-id>:<region>:<instance-name>
```

> **WARNING:** Cloud Run has a **request timeout** (default 300s, max 3600s) and can scale to zero. WebSocket connections will be terminated when instances scale down. If you rely on Rebase realtime features, set `--min-instances 1` and increase the request timeout. For heavy realtime usage, consider GCE (Compute Engine) with Docker Compose instead.

---

## Azure (Container Apps + PostgreSQL Flexible Server)

Deploy the Rebase Docker image to Azure Container Apps with Azure Database for PostgreSQL.

### Architecture

```
Internet → Azure Container Apps (HTTPS, auto-scaling) → Azure Database for PostgreSQL
                                                      → Azure Blob Storage (file storage)
```

### Key Steps

1. **PostgreSQL** — Create an Azure Database for PostgreSQL Flexible Server. Choose a Burstable or General Purpose tier. Place in an EU region (West Europe, North Europe, or France Central).
2. **Docker Image** — Push to Azure Container Registry (ACR):
   ```bash
   # Login to ACR
   az acr login --name YourRegistryName

   # Build and push
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest -f app/backend/Dockerfile .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```
3. **Container App** — Create a Container Apps Environment and deploy:
   - Point to your ACR image
   - Set the target port to `3001`
   - Enable Ingress for external traffic
   - Configure environment variables (see below)
4. **Networking** — If the PostgreSQL server uses private networking, configure VNet integration in the Container Apps Environment.
5. **File Storage** — Use `STORAGE_TYPE=s3` with Azure Blob Storage via the S3-compatible API, or use Cloudflare R2.

### Key Environment Variables

```bash
DATABASE_URL=postgresql://rebase_admin:<password>@<server-name>.postgres.database.azure.com:5432/rebase
JWT_SECRET=<your-secret-min-32-chars>
REBASE_SERVICE_KEY=<your-service-key-min-32-chars>
CORS_ORIGINS=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
NODE_ENV=production
ALLOW_REGISTRATION=false
```

> **TIP:** Azure Container Apps provides built-in HTTPS with automatic TLS certificates. Use Managed Identity instead of static credentials for accessing Azure services.

---

## Scaleway (Serverless Containers + Managed PostgreSQL)

Deploy the Rebase Docker image to Scaleway Serverless Containers. Scaleway is a premier European cloud provider with datacenters in Paris, Amsterdam, and Warsaw — ideal for EU data sovereignty.

### Architecture

```
Internet → Scaleway Serverless Container (HTTPS) → Managed PostgreSQL
                                                  → Object Storage (S3-compatible)
```

### Key Steps

1. **PostgreSQL** — Create a Managed Database for PostgreSQL in your preferred EU region (e.g., Paris `fr-par`).
2. **Docker Image** — Push to Scaleway Container Registry:
   ```bash
   # Build and push
   docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest -f app/backend/Dockerfile .
   docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
   ```
3. **Serverless Container** — Deploy from the Scaleway Console or CLI:
   - Select your image from the Container Registry
   - Set the port to `3001`
   - Configure environment variables (see below)
4. **File Storage** — Use `STORAGE_TYPE=s3` with Scaleway Object Storage (natively S3-compatible):
   ```bash
   S3_ENDPOINT=https://s3.fr-par.scw.cloud
   S3_BUCKET=your-rebase-uploads
   S3_REGION=fr-par
   S3_FORCE_PATH_STYLE=true
   ```

### Key Environment Variables

```bash
DATABASE_URL=postgresql://user:<password>@<instance-ip>:5432/rebase
JWT_SECRET=<your-secret-min-32-chars>
REBASE_SERVICE_KEY=<your-service-key-min-32-chars>
CORS_ORIGINS=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
NODE_ENV=production
ALLOW_REGISTRATION=false
STORAGE_TYPE=s3
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_BUCKET=your-rebase-uploads
S3_REGION=fr-par
S3_FORCE_PATH_STYLE=true
```

> **TIP:** Scaleway Object Storage is natively S3-compatible — no interop layer needed. Set `S3_FORCE_PATH_STYLE=true` for compatibility.

---

## Hetzner (VPS + Docker Compose)

The most cost-effective production deployment. A single Hetzner VPS running Docker Compose.

### Architecture

```
Internet → Caddy (HTTPS, auto-TLS) → Rebase container (port 3001)
                                   → PostgreSQL container
                                   → Hetzner Volume (persistent storage)
```

### Setup

1. **Provision a VPS** — A Hetzner CPX21 (3 vCPU, 4 GB RAM, ~€8/mo) handles most workloads. Choose Ubuntu 24.04.
2. **Install Docker** — SSH in and install Docker + Docker Compose:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Clone your project** and copy your `.env` file to the server.
4. **Use the existing `docker-compose.yml`** — the template generated by `rebase init` works out of the box. Just update `.env` with production values:
   ```bash
   DATABASE_PASSWORD=<strong-random-password>
   JWT_SECRET=<your-secret-min-32-chars>
   REBASE_SERVICE_KEY=<your-service-key-min-32-chars>
   CORS_ORIGINS=https://yourdomain.com
   FRONTEND_URL=https://yourdomain.com
   NODE_ENV=production
   ALLOW_REGISTRATION=false
   ```
5. **Reverse Proxy (Caddy)** — Add a Caddy service for automatic HTTPS:
   ```yaml
   # Add to docker-compose.yml
   caddy:
     image: caddy:2-alpine
     restart: unless-stopped
     ports:
       - "80:80"
       - "443:443"
       - "443:443/udp"  # HTTP/3
     volumes:
       - ./Caddyfile:/etc/caddy/Caddyfile
       - caddy_data:/data
       - caddy_config:/config
     depends_on:
       - backend

   # Add to volumes:
   caddy_data:
     driver: local
   caddy_config:
     driver: local
   ```

   Create a `Caddyfile`:
   ```
   yourdomain.com {
       reverse_proxy backend:3001
   }
   ```
6. **Start everything:**
   ```bash
   docker compose up -d
   ```
7. **Persistent Storage** — Attach a Hetzner Volume for the `postgres_data` and `uploads` Docker volumes if you need data to survive server rebuilds.

### Backups

Schedule automated PostgreSQL backups via cron on the host:

```bash
# /etc/cron.d/rebase-backup
0 3 * * * root docker compose -f /path/to/docker-compose.yml exec -T db pg_dump -U rebase rebase | gzip > /backups/rebase-$(date +\%Y\%m\%d).sql.gz
```

> **TIP:** Hetzner also offers managed entities (server-level) and the option to attach a Hetzner Volume for data that survives server rebuilds. For production, strongly consider both.

---

## PaaS (Railway, Render, Fly.io)

Docker-based PaaS platforms that deploy directly from your repo or Docker image.

### General Pattern

All PaaS platforms follow the same workflow:
1. Connect your Git repository or point to a Dockerfile
2. Provision a managed PostgreSQL add-on
3. Set environment variables (see env var reference above)
4. Deploy — the platform builds and runs the Docker image

### Platform-Specific Notes

| Platform | PostgreSQL | Notes |
|----------|-----------|-------|
| **Railway** | Built-in add-on | Connects via `DATABASE_URL` injected automatically. Supports persistent volumes for file uploads. |
| **Render** | Managed PostgreSQL | Use a "Web Service" with Docker runtime. Free tier has cold starts — use paid for production. |
| **Fly.io** | Fly Postgres (community) | Closest to self-hosted — Fly Postgres is a managed wrapper around standard Postgres. Supports persistent volumes via `fly volumes`. |

### Minimum Environment Variables

```bash
DATABASE_URL=<provided-by-platform>
JWT_SECRET=<your-secret-min-32-chars>
REBASE_SERVICE_KEY=<your-service-key-min-32-chars>
CORS_ORIGINS=https://your-app.up.railway.app  # or your custom domain
FRONTEND_URL=https://your-app.up.railway.app
NODE_ENV=production
ALLOW_REGISTRATION=false
```

> **WARNING:** Most PaaS free tiers have ephemeral filesystems — uploaded files will be lost on redeploy. Use `STORAGE_TYPE=s3` with an external object storage provider (Cloudflare R2, AWS S3, MinIO) for production file storage.

---

## Splitting one bundle into several processes

One image and one bundle can boot as several cooperating processes. `REBASE_ROLE`
is the only thing that differs between them:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

Reach for it when a heavy custom function competes with the data API, or when
cron and jobs should not share a process with request serving.

**The settings whose failure mode is silence**, once there is more than one
process:

| Setting | Why |
|---|---|
| `REBASE_MIGRATE_ON_BOOT=none` on all but one | Exactly one process may own DDL, or boots race |
| `REBASE_RATE_LIMIT_STORE=sql` | An in-memory limit counts per process, so N processes grant N× the limit |
| `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` on the api | Otherwise a job runs once per replica |
| `TRUSTED_PROXY_HOPS` on the functions tier | It sits behind another hop |

A wrong `REBASE_ROLE` serves no HTTP while `/health` still answers — readiness
passes and every request 404s. Do not guess it.

**Realtime broadcast and presence do not cross processes** on the default
in-memory bus. With more than one API replica, set
`realtime: { bus: { type: "postgres" } }` in the project config. Ordinary
collection subscriptions are unaffected — those travel through Postgres CDC.

---

## Kubernetes (Helm)

`charts/rebase` is the Kubernetes peer of the self-hosting Compose setup: same
image, same bundle, and upgrading Rebase is a tag change.

```bash
helm install rebase ./charts/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

It deploys the **runtime only** — point `config.databaseUrl` at CloudNativePG, a
managed database, or your own StatefulSet.

Splitting is one value, and the chart then derives every setting from the table
above rather than leaving them to be remembered:

```yaml
split: true
functions: { enabled: true, replicas: 3 }
worker: { enabled: true }
```

A migration Job (`migrationJob.enabled`, on by default) runs `pre-install` and
`pre-upgrade`, so every pod boots with `REBASE_MIGRATE_ON_BOOT=none` and nothing
on the request path owns DDL. `migrationJob.mode: push` also applies collection
schema changes and **is destructive**; it is not the default.

The chart **refuses to render** configurations that would come up and quietly
stop being true — several HTTP processes on a memory rate-limit store, two static
apps claiming one path, `bundle.mode=image` still pointing at the stock image.

> **Maturity:** rendered and linted against Helm v4, with every refusal tested,
> but **not yet exercised against a live cluster**. Prefer the Docker path for
> anything you cannot afford to debug.

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

```typescript no-verify
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
- `rebase cloud deploy` (any variant)
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
- **Env Schema:** `packages/server/src/env.ts`
- **Helm chart:** `charts/rebase` (see `charts/rebase/README.md`)
- **Role resolution:** `packages/server/src/boot/role.ts`
- **serveSPA:** `packages/server/src/serve-spa.ts`
- **Backend Entry:** `app/backend/src/index.ts`
- **.env.example:** `app/.env.example`
