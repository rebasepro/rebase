---
title: Deploying Rebase on Fly.io
description: Learn how to deploy Rebase globally or restrict it to European data centers using Fly.io.
sidebar_label: Fly.io
---

Fly.io runs Docker containers close to your users on a global anycast network, and is highly configurable about where data lives — a good fit for a Rebase deployment with a strict European focus. Fly has data centers in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)** and **Paris (cdg)**.

Nothing on this page is Fly-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and here.

## 1. Initialize the Fly app

With `flyctl` installed, from your project:

```bash
fly launch --no-deploy
```

1. **App name:** `my-rebase-app`
2. **Organization:** personal, or your corporate org.
3. **Region:** choose a European datacenter — Frankfurt (`fra`) or Paris (`cdg`).
4. **Database:** say **Yes** to a Postgres cluster. Fly creates it in the same region and injects `DATABASE_URL`.
5. **Redis:** say **No**.

`--no-deploy` because the secrets and the bundle have to be in place first.

If your collections declare a `vector` property, enable the extension once against that database: `CREATE EXTENSION vector;`.

## 2. Build the bundle and point fly.toml at the runtime image

There is **no application image to build from your source**. `rebase build` produces a `dist-bundle` directory with your compiled collections, functions, crons and — if your project declares a static app — your built frontend:

```bash
rebase build
```

Commit a three-line `Dockerfile` at the project root:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

And point `fly.toml` at it:

```toml title="fly.toml"
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DISABLE_SELF_REGISTRATION = "true"

[http_service]
  internal_port = 8080          # the port the runtime image listens on
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1      # realtime subscriptions need a machine to stay up

[[http_service.checks]]
  path = "/livez"
```

`/livez` rather than `/health`: the second performs a database round-trip, so a liveness check on it restarts a healthy machine during a brief database hiccup.

`DISABLE_SELF_REGISTRATION` is new <span class="since-badge" data-since="0.18">Since 0.18</span>: on 0.17.3 there is no such
switch, and the first account to register becomes the administrator.

Upgrading Rebase later is a change to that `FROM` line. Your bundle is untouched.

## 3. Set production secrets

```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

The last two are new <span class="since-badge" data-since="0.18">Since 0.18</span>, and are how this app gets an administrator at all: in production the first account to register is not promoted, so nothing else produces the first signed-in caller. Set them before the first deploy serves traffic — see [Your first admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` shows only digests, so keep the generated password from this command; there is no way to read it back.

## 4. Deploy

```bash
fly deploy
```

Then `fly open`.

## 5. The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema — it creates missing tables, columns and enum types and applies their row-level security — so the first start against an empty database comes up serving your collections.

What `ensure` never does is change something that already exists: it does not alter a column type, drop anything, or edit an existing enum's labels, because a machine restarting must not reshape a schema as a side effect of a deploy.

Two things therefore still need the CLI, run from a checkout or a CI job:

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed type, a removed field.

For a private Fly Postgres, open a tunnel with `fly proxy 5432 -a <your-db-app>` and point `DATABASE_URL` at `localhost:5432`. The runtime image ships without the CLI, so this never runs inside the machine and a `release_command` cannot call it either. For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## File storage

A Fly machine's filesystem does not survive a deploy, so local file storage is silent data loss and the runtime refuses it in production. Attach an S3-compatible bucket — Tigris is the one Fly provisions — with `STORAGE_TYPE=s3`. See [Storage](/docs/backend/storage).

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
