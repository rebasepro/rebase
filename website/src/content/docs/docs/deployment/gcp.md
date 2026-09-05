---
title: Deploying Rebase on Google Cloud Platform
description: Deploy your Rebase instance securely on GCP using Cloud SQL and Cloud Run, focusing on EU data center regions.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offers a seamless developer experience for containerized applications. For a robust production setup, use **Cloud SQL** for the database and **Cloud Run** for the runtime.

To maintain strict European data compliance, operate entirely within an EU region such as **europe-west3 (Frankfurt)**, **europe-west9 (Paris)**, or **europe-west1 (Belgium)**.

Nothing on this page is GCP-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and here.

## 1. Provision Cloud SQL (PostgreSQL)

1. Navigate to the **Cloud SQL** console in your preferred EU region.
2. Click **Create Instance** and select **PostgreSQL**.
3. Set your Instance ID and generate a secure password for the `postgres` user.
4. Expand **Configuration Options** to choose a machine type (two vCPUs is a good start).
5. Configure Private IP or an authorized public network, depending on how Cloud Run will reach it.
6. Assemble your connection URI:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

If your collections declare a `vector` property, enable the extension once: `CREATE EXTENSION vector;` against the database.

## 2. Build the bundle and bake it into an image

There is **no application image to build from your source**. `rebase build` produces a `dist-bundle` directory with your compiled collections, functions, crons and — if your project declares a static app — your built frontend. The published runtime image runs it:

```bash
rebase build
```

Cloud Run pulls from a registry, so bake the bundle into a derived image. Three lines, and it pins exactly what runs:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Create an Artifact Registry repository (one-time)
gcloud artifacts repositories create rebase --repository-format=docker --location=europe-west3

# Authenticate Docker to Artifact Registry (one-time)
gcloud auth configure-docker europe-west3-docker.pkg.dev

# Build from the project root and push
docker build -t europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest .
docker push europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest
```

Upgrading Rebase later is a change to that `FROM` line. Your bundle is untouched.

## 3. Deploy to Cloud Run

<span class="since-badge" data-since="0.18">Since 0.18</span>

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injects `PORT` and the runtime binds to it, so there is no port to configure. Point the startup probe at `/livez` rather than `/health`: the second performs a database round-trip, so a liveness probe on it restarts a healthy revision during a brief database hiccup.

`REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` are how this service gets an administrator at all: in production the first account to register is not promoted, so nothing else produces the first signed-in caller. Set them before the first revision serves traffic — see [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` replaces the **whole** environment block on every deploy, so a later deploy that omits a variable silently unsets it. Keep the full list in your deploy script.

Reaching a private Cloud SQL instance needs `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` and a socket-style `DATABASE_URL`; a public instance with an authorized network needs neither.

## 4. The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema — it creates missing tables, columns and enum types and applies their row-level security — so the first start against an empty instance comes up serving your collections.

What `ensure` never does is change something that already exists: it does not alter a column type, drop anything, or edit an existing enum's labels, because a revision starting must not reshape a schema as a side effect of a deploy.

Two things therefore still need the CLI, run from a checkout or a CI job:

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed type, a removed field.

From your machine, connect through the [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) and point `DATABASE_URL` at `localhost`. The runtime image ships without the CLI, so this never runs inside the Cloud Run container. For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## File storage

Cloud Run instances are stateless and ephemeral, so local file storage is silent data loss and the runtime refuses it in production.

1. Create a private Google Cloud Storage bucket in your chosen EU region.
2. Set `STORAGE_TYPE=gcs` and its bucket — see [Storage](/docs/backend/storage). On Cloud Run the ambient service account supplies the credentials, so there is nothing else to set.

:::caution
Cloud Run scales to zero. If your project uses realtime subscriptions, set `--min-instances 1` — WebSocket connections are terminated when an instance is scaled down.
:::

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
