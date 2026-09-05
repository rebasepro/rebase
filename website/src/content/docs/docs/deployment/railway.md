---
title: Deploying Rebase on Railway
description: Deploy Rebase on Railway from the published runtime image and your project bundle. Maintain EU focus.
sidebar_label: Railway
---

Railway is a modern PaaS that takes the pain out of DevOps, and it supports European deployment regions (Amsterdam), so you keep regional hosting compliance.

Nothing on this page is Railway-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and here.

## 1. Create a project and an EU region

1. Log in to your [Railway account](https://railway.app/).
2. Click **New Project**.
3. Go to **Settings → Default Region** and set it to **Europe (Amsterdam)**. Doing this *after* creating services means migrating them by hand.

## 2. Provision PostgreSQL

1. Inside your project, click **New → Database → Add PostgreSQL**.
2. Wait for it to provision.
3. Railway exposes an internal `DATABASE_URL` variable on the Postgres widget's **Variables** tab.

If your collections declare a `vector` property, enable the extension once against that database: `CREATE EXTENSION vector;`.

## 3. Build the bundle and bake it into an image

There is **no application image to build from your source**. `rebase build` produces a `dist-bundle` directory with your compiled collections, functions, crons and — if your project declares a static app — your built frontend. The published runtime image runs it:

```bash
rebase build
```

Commit a three-line `Dockerfile` at the repository root, so Railway's build step is a copy rather than a compilation:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Build the bundle in CI and commit or upload it as part of your release, or run `rebase build` before pushing. Either way the image Railway builds contains no toolchain and no source — upgrading Rebase later is a change to that `FROM` line, with your bundle untouched.

Then: **New → GitHub Repo**, select your repository, and let Railway detect the Dockerfile at the root.

## 4. Set environment variables

<span class="since-badge" data-since="0.18">Since 0.18</span>

1. Click the service card.
2. Go to the **Variables** tab.
3. Add:
   - `JWT_SECRET`: a secure 32+ character random string.
   - `REBASE_SERVICE_KEY`: another secure 32+ character random string.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: your frontend domain (e.g. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: same as `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: the first administrator's address
   - `REBASE_ADMIN_PASSWORD`: at least 12 characters

   The last three are how this service gets an administrator at all: in production the first account to register is not promoted, so nothing else produces the first signed-in caller. Set them before the service first serves traffic — see [Your first admin](/docs/getting-started/deployment/#your-first-admin).

4. Click **Reference Variable** and select `DATABASE_URL` from the PostgreSQL service. Railway injects the internal Postgres URL at runtime.

Railway sets `PORT` and the runtime binds to it, so there is no port to configure. Point the health check at `/livez` rather than `/health`: the second performs a database round-trip, so a liveness probe on it restarts a healthy container during a brief database hiccup.

## 5. Expose the domain

1. In the service card, go to **Settings → Networking**.
2. Under **Public Networking**, click **Generate Domain** for a `.up.railway.app` URL, or attach a custom domain.

## 6. The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema — it creates missing tables, columns and enum types and applies their row-level security — so the first start against an empty database comes up serving your collections.

What `ensure` never does is change something that already exists: it does not alter a column type, drop anything, or edit an existing enum's labels, because a container restart must not reshape a schema as a side effect of a deploy.

Two things therefore still need the CLI, run from a checkout or a CI job:

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed type, a removed field.

Point `DATABASE_URL` at your Postgres service's **public** connection string (Postgres widget → **Connect**); the referenced internal URL is only reachable from inside Railway. The runtime image ships without the CLI, so this never runs inside the container. For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## File storage

Railway containers are replaced on every deploy, so local file storage is silent data loss and the runtime refuses it in production. Attach an S3-compatible bucket with `STORAGE_TYPE=s3` — see [Storage](/docs/backend/storage).

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
