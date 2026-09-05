---
title: Deploying Rebase on Scaleway
description: Learn how to deploy Rebase on Scaleway for secure, French-based cloud infrastructure using Serverless Containers.
sidebar_label: Scaleway
---

Scaleway is a European cloud provider based in France, with datacenters in Paris, Amsterdam and Warsaw — an excellent choice for organizations prioritizing EU data sovereignty.

Use Scaleway's **Managed Database** for Postgres and **Serverless Containers** for the runtime.

Nothing on this page is Scaleway-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and here.

## 1. Create a Managed Postgres Database

1. In the Scaleway Console, go to **PostgreSQL**.
2. Click **Create a Database Instance**.
3. Choose a Region (e.g. Paris — `PAR1`).
4. Select a Node Type (**Play2-Pico** or **Pro2-XXS** works well).
5. Add a database name (`rebase_db`) and a strong user password.
6. Once deployed, note the **Connection string** (URI) from the dashboard:
   `postgres://user:password@ip:port/rebase_db`

If your collections declare a `vector` property, enable the extension once: `CREATE EXTENSION vector;` against the database.

## 2. Build the bundle and bake it into an image

There is **no application image to build from your source**. `rebase build` produces a `dist-bundle` directory with your compiled collections, functions, crons and — if your project declares a static app — your built frontend. The published runtime image runs it:

```bash
rebase build
```

Serverless Containers pulls from a registry, so bake the bundle into a derived image. Three lines, and it pins exactly what runs:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

1. Go to **Container Registry** in the Scaleway Console and create a namespace (e.g. `rebase-apps`).
2. Log in to the registry from your terminal using the instructions it shows.
3. Build and push, from the project root:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Upgrading Rebase later is a change to that `FROM` line. Your bundle is untouched.

## 3. Deploy the Serverless Container

<span class="since-badge" data-since="0.18">Since 0.18</span>

1. Navigate to **Serverless Containers**.
2. Click **Create a Container**.
3. Choose the image you just pushed.
4. Set the Port to **8080** — the port the runtime image listens on unless `PORT` says otherwise.
5. Under Environment Variables, add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | The URI from your Managed Postgres step |
| `JWT_SECRET` | A secure 32+ character random string for signing auth tokens |
| `REBASE_SERVICE_KEY` | A secure 32+ character random string |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Your frontend domain (e.g., `https://yourdomain.com`) |
| `FRONTEND_URL` | Your frontend URL (used for email links and CORS fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | The first administrator's address, set **before the first boot** |
| `REBASE_ADMIN_PASSWORD` | At least 12 characters |

The last three are how this deployment gets an administrator at all: in production the first account to register is not promoted, so nothing else produces the first signed-in caller. See [Your first admin](/docs/getting-started/deployment/#your-first-admin). Mark the secrets as secret environment variables rather than plain ones.

6. Point the health check at `/livez`. Not `/health`: that one performs a database round-trip, so a liveness probe on it restarts a healthy container during a brief database hiccup.
7. Click **Deploy Container**.

Scaleway provisions the container and gives you a public endpoint (e.g. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*For strict data compliance, verify that your Scaleway Organization details reflect your European corporate entity.*

## 4. The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema — it creates missing tables, columns and enum types and applies their row-level security — so the first start against an empty database comes up serving your collections.

What `ensure` never does is change something that already exists: it does not alter a column type, drop anything, or edit an existing enum's labels, because a container restart must not reshape a schema as a side effect of a deploy.

Two things therefore still need the CLI, run from a checkout or a CI job with `DATABASE_URL` pointed at your Managed Database:

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed type, a removed field.

The runtime image ships without the CLI, so this never runs inside the container. For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## File storage

Serverless Containers have no durable disk, so local file storage is silent data loss and the runtime refuses it in production. Scaleway Object Storage is S3-compatible and sits in the same datacenters:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

See [Storage](/docs/backend/storage) for the full picture.

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
