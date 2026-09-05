---
title: Deploying Rebase on Fly.io
description: Learn how to deploy Rebase globally or restrict it to European data centers using Fly.io.
sidebar_label: Fly.io
---

Fly.io allows you to host Docker containers close to your users via their global anycast network. Fly is highly configurable regarding data routing, making it an excellent choice for deploying Rebase applications with a strict European data focus.

Fly.io features data centers in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)**, and **Paris (cdg)**. 

## 1. Initialize the Fly App
From your local Rebase repository, after ensuring the Fly CLI (`flyctl`) is installed, run:

```bash
fly launch
```

1. **App Name:** `my-rebase-app`
2. **Organization:** Personal or your corporate Org.
3. **Region:** When prompted for a region, explicitly choose a European datacenter such as **Frankfurt (fra)** or **Paris (cdg)**.
4. **Database:** When prompted to setup a Postgres database, say **Yes**. Fly will automatically create a Postgres cluster in the *same region* and securely inject the `DATABASE_URL` into your app.
5. **Redis:** Say **No**.

*Do not deploy just yet when prompted.* We need to set a critical environment variable first.

## 2. Set Production Secrets
Before your application spins up in production, you must inject the required secrets and configuration.

Run the following command locally:
```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

The last three are how this app gets an administrator at all: in production the
first account to register is not promoted, so nothing else produces the first
signed-in caller. Set them before the first deploy serves traffic — see [Your
first admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets
list` shows only digests, so keep the generated password from this command —
there is no way to read it back.

## 3. Validate Internal Configuration
Fly will have generated a `fly.toml` file at the root of your project. Verify that the internal port explicitly aligns with the Rebase default configuration (`3001`):

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  # The scaffold's Dockerfile lives at backend/Dockerfile, and its build
  # context is the project root (where fly.toml sits) so it can copy
  # pnpm-workspace.yaml, backend/, and config/. Pointing this at a bare
  # "Dockerfile" (repo root) will fail — there is none there.
  dockerfile = "backend/Dockerfile"

[http_service]
  internal_port = 3001 # Make sure this matches your Hono app port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Deploy

Your data is localized, your database is provisioned, and your secrets are injected. Start the deployment:

```bash
fly deploy
```

Once parsing and uploading completes, your application will come online automatically. Run `fly open` to view your deployed app in the browser!

## 5. Create the Database Schema

The app is running, but Rebase only auto-creates the **auth** tables on boot — the tables for your own collections are **not** created automatically. Run this once against the production database, or every collection returns a "missing table" error:

```bash
pnpm run db:push
```

Run it from a checkout of your project (or your CI job) with `DATABASE_URL` set to your Postgres connection string. For a private Fly Postgres, open a tunnel first with `fly proxy 5432 -a <your-db-app>` and point `DATABASE_URL` at `localhost:5432`. The deployed image doesn't include the CLI, so this doesn't run inside the machine and a `release_command` can't call it either. For versioned migrations, commit migration files with `pnpm run db:generate` and run `pnpm run db:migrate` instead.
