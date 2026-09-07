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
| **Kubernetes** | The `infra/charts/rebase` Helm chart — one process or several | ⭐⭐⭐ Advanced |

## Rebase Cloud

The simplest deployment path — a managed project at
`https://<subdomain>.rebase.website`, with a managed PostgreSQL database, TLS,
custom domains and rollbacks. Sign up at
[app.rebase.pro](https://app.rebase.pro).

```bash
rebase cloud login
rebase cloud projects create --name "My App" --subdomain my-app --link
rebase cloud deploy
```

> **📖 Use the `rebase-cloud` skill for anything hosted.** It carries the first-deploy
> sequence, what a managed database actually is and when it comes into
> existence, `blockedOn`/`nextAction`, build-time vs run-time variables,
> extensions on a shared pool, domains, logs, rollbacks, and how to tell a
> platform failure from a project one. This section is a pointer on purpose:
> two copies of that material would drift, and the version an agent reads
> decides whether a deploy takes four minutes or forty.

Everything below this line is for **self-hosting** — Docker, Kubernetes, and
running the image yourself on a cloud provider.

---
## Docker (Self-Hosted)

**There is no application image to build.** A Rebase project travels as a
*bundle*; the runtime is the published `rebasepro/server` image. Upgrading
Rebase is a tag change, not a rebuild, and the artifact you self-host is the
artifact Rebase Cloud runs.

> **IMPORTANT FOR AGENTS:** never write a multi-stage build that compiles the
> project into an image. That was how this worked before the bundle contract,
> and a generated one will not boot: the runtime looks for `/bundle`, not for a
> compiled `backend/dist`. If you find yourself writing `corepack enable` or
> `pnpm build` inside a container recipe, stop — you are solving a problem that
> no longer exists.

### The whole of it

`rebase init` writes `docker-compose.yml` at the project root, with two
services: `pgvector/pgvector:pg18` and `rebasepro/server:${REBASE_VERSION:-latest}`
with `./dist-bundle` mounted at `/bundle`.

```bash
rebase build              # produces ./dist-bundle
docker compose up -d db
docker compose up         # boot creates the tables it is missing
```

One container then serves the API at `/api` and the admin at `/` — same origin,
so there is no CORS between them and no second web server.

### The version pin

`REBASE_VERSION` in `.env` chooses the runtime:

```bash
REBASE_VERSION=0.17.3     # unset means :latest, which is not a pin
```

To upgrade Rebase, change that line and restart. The bundle is untouched. Pin it
for anything that is not a laptop: `latest` means "whatever was published this
morning", and a restart is enough to move a production deployment onto it.

### The four values the stack refuses to start without

```bash
DATABASE_PASSWORD=...     # the Postgres password
JWT_SECRET=...            # signs every session; rotating it signs everybody out
REBASE_SERVICE_KEY=...    # the server-to-server credential — treat it as root
CORS_ORIGINS=...          # the origin you browse to, e.g. http://localhost:3001
```

`rebase init` generates the three secrets. Each must be at least 32 characters.
The compose file declares them with `${VAR:?…}`, so a missing one stops the
stack with a message naming it rather than starting something half-configured.

### Schema

`REBASE_MIGRATE_ON_BOOT` defaults to `ensure`: the runtime creates missing
tables, columns and enum types at boot, including your collections', and applies
their row-level security. It never alters, narrows or drops anything that
already exists — a container restart must not be able to reshape a schema.

`rebase db push` remains the step for the rest: junction-table RLS on
many-to-many relations, and any change that is not purely additive.

### Uploads

Local storage in production is refused unless the path is a durable mount,
because a container filesystem is destroyed on the next deploy. The generated
compose file mounts a named volume and sets `FORCE_LOCAL_STORAGE=true` to
acknowledge that. Moving storage off-box means `STORAGE_TYPE=s3` (or `gcs`) and
dropping both lines.

### Owning the server code instead

`rebase eject` writes the entrypoint, a Dockerfile and a compose file that
builds them. That is the supported way to take over the boot path — and the only
reason to have a build recipe of your own.

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
| `FORCE_LOCAL_STORAGE` | `optionalBoolString` | No | `undefined` → `false` | Allow `STORAGE_TYPE=local` in production. Without it the local backend is not registered — the backend still boots, but uploads answer `501 STORAGE_NOT_CONFIGURED` |
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

The `.env.example` includes all variables with inline documentation. `rebase init` writes one at the project root and copies it to `.env`.

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

### Serving a product app and the admin from one frontend

A single Vite entry can serve both, split by URL, so visitors never download the
admin bundle:

```tsx no-verify
// frontend/src/main.tsx
const isAdmin = window.location.pathname.startsWith("/admin");
const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseCMS basePath="/admin" .../>

// route "/admin/*" → AdminApp, everything else → ProductApp
```

Set **either** a router `basename="/admin"` **or** `<RebaseCMS basePath="/admin">` — not both, or the prefix is applied twice.

---

## The image every managed platform wants

AWS, GCP, Azure, Scaleway and the PaaS platforms all want a registry tag rather
than a mounted volume. There is still nothing of yours to compile — the image is
the published runtime with the bundle copied in, two lines at the project root:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

`rebase build` first, then `docker build`. Baking the bundle in also pins exactly
what runs, which is what a rollback needs. Everything below assumes this shape;
where a section says "build and push", that is what it is building.

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
2. **Image** — there is nothing of yours to compile. `rebase build` produces
   `dist-bundle`; bake it into the published runtime the way
   [Self-Hosting](https://rebase.pro/docs/deployment/self-hosting) shows, tag
   that, and push it to ECR:
   ```bash
   rebase build
   docker build -t <account-id>.dkr.ecr.<region>.amazonaws.com/rebase-backend:latest .
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
   rebase build && docker build -t rebase-backend .
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
   rebase build && docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
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
   rebase build && docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
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
1. Connect your Git repository, or point the platform at an image that bakes `dist-bundle` into `rebasepro/server`
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

`infra/charts/rebase` is the Kubernetes peer of the self-hosting Compose setup: same
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
on the request path owns DDL. `ensure` is the only mode the runtime
image accepts — it creates missing tables, columns and enum types additively.
`push`, which also applies collection schema changes, is **refused at boot**:
run `rebase db push` from a checkout or CI for those, where it dry-runs the
change, refuses destructive ones without confirmation, and can back up first.

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
- Create or edit container and docker-compose files
- Create or edit `.env` files
- Run deployment commands *only* if the user explicitly asks you to deploy in the current conversation. Otherwise, provide the exact commands for the user to run.

---

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Self-hosting guide:** [rebase.pro/docs/deployment/self-hosting](https://rebase.pro/docs/deployment/self-hosting)
- **Compose file a project gets:** `packages/cli/templates/template/docker-compose.yml`
- **Compose file the acceptance gate boots:** `infra/docker/docker-compose.selfhost.yml`
- **Env Schema:** `packages/server/src/env.ts`
- **Helm chart:** `infra/charts/rebase` (see `infra/charts/rebase/README.md`)
- **Role resolution:** `packages/server/src/boot/role.ts`
- **serveSPA:** `packages/server/src/serve-spa.ts`
- **.env.example:** the project root`s own `.env.example`, written by `rebase init`
