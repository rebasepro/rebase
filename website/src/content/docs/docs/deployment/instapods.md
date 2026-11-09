---
title: Deploying Rebase on InstaPods
description: Take a fresh rebase init project to a live HTTPS URL on one InstaPods pod — Node, PostgreSQL and file uploads on the same machine, no Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) runs your app in a persistent container — a *pod* — with Node.js, an optional PostgreSQL service on `localhost`, automatic HTTPS and deploys from a GitHub repository. A Rebase backend is one Node process and a Postgres, so the whole thing fits on one pod: the API, auth, realtime, cron, the admin panel and file storage.

This page takes a project fresh from `rebase init` to a live URL. Everything runs on the pod itself; there is no Docker image and nothing else to provision.

**File uploads can start on the pod's own disk.** A pod's filesystem survives restarts and redeploys, so local storage is safe there, and you can move to an S3-compatible bucket later without changing code. See [File storage](#file-storage).

## What you need

- The **Build** plan or higher ($7/month: 2 vCPU, 2 GB RAM, 25 GB disk). The Launch plan cannot run the PostgreSQL service.
- A GitHub repository for the project.
- The [InstaPods CLI](https://docs.instapods.com/), for the database and environment steps. The dashboard does the same things.

## 1. Create the project and push it

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Commit it and push it to a GitHub repository. `.env` is gitignored, and stays that way: the pod gets its own values in step 4.

## 2. Create the pod

In the InstaPods dashboard, create a pod with the **Node.js** preset on the **Build** plan.

The scaffold declares Node `>=22.22.0` and refuses to install on anything older. Check the pod's version, and move it to Node 24 if its Node 22 is behind:

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. Add PostgreSQL

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

The second command prints the credentials: host `localhost`, port `5432`, user and database `instapod`, and a generated password. Your connection string is:

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Then create the role Rebase runs signed-in requests as. Rebase enforces row-level security by switching each request to a restricted role, `rebase_user`, and the `instapod` user needs permission to switch into it. Create it once as the Postgres superuser, before the first deploy:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

The runtime does the rest at first start: the grants and policies on your tables belong to `instapod`, which owns its database.

Do this even if the runtime could create the role itself. A user that is allowed to create roles but is not a superuser gets, on PostgreSQL 16 and newer, a membership in the role it created that does not let it switch into it. Boot then succeeds, and every signed-in request fails with `DB_PERMISSION_DENIED`. If that has already happened, run `GRANT rebase_user TO instapod WITH SET TRUE;` the same way and restart the app.

## 4. Set the environment

Generate the two secrets with `openssl rand -hex 32` (once for each), then set everything in one call:

```bash
instapods env set my-app \
  DATABASE_URL='postgresql://instapod:<password>@localhost:5432/instapod' \
  ALLOW_LOCALHOST_IN_PRODUCTION=true \
  JWT_SECRET=<first-secret> \
  REBASE_SERVICE_KEY=<second-secret> \
  CORS_ORIGINS=https://my-app.nbg1-1.instapods.app \
  FRONTEND_URL=https://my-app.nbg1-1.instapods.app \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=<at-least-12-characters> \
  STORAGE_TYPE=local \
  STORAGE_PATH=/home/instapod/app/uploads \
  FORCE_LOCAL_STORAGE=true
```

Use your pod's own URL for `CORS_ORIGINS` and `FRONTEND_URL`: the dashboard shows it, and it is the address you will open the admin panel at. Add a custom domain later and put it in both.

What the less obvious lines are for:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** In production the runtime refuses a `DATABASE_URL` that points at `localhost`, because inside a container that address is usually a mistake. On a pod the database really is on the same machine, and this line says so.
- **`REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD`.** In production the first account to register is not made an administrator, so these name the first one. The runtime creates the account once, while the user table is empty. Sign in with it and change the password. See [Your first admin](/docs/getting-started/deployment/#your-first-admin).
- **The three storage lines.** Explained under [File storage](#file-storage).

`instapods env set` writes `/home/instapod/app/.env`, which is the file `rebase start` reads. InstaPods sets `PORT` itself, and the runtime binds to it.

## 5. Connect the repository

On the pod's **Git** tab, connect the repository and branch, then set the commands:

| Field | Value |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(leave empty)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Why each one looks the way it does:

- **Install** runs pnpm through `npx`, because the project ships a `pnpm-lock.yaml` and the pod may not have pnpm installed. `--prod=false` keeps the dev dependencies — the Rebase CLI and TypeScript, which the build needs — even if `NODE_ENV` is already `production` during the install.
- **Build** runs `rebase build`. It compiles your collections, functions and crons into `dist-bundle/`, and builds the admin panel into the same bundle. It peaks at about 1 GB of memory.
- **Start** runs the built bundle. `NODE_ENV=production` is set in the command itself, so the runtime never starts in development mode — where the first stranger to register would become the administrator.

Deploy. Every later push to the branch deploys again.

## 6. Open it

Open the pod's URL. One process serves the admin panel at `/` and the API at `/api`. Sign in with `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD`.

The first start creates every table it needs, your collections' included, along with their row-level security policies. There is no migration to run first.

If the log says `Failed to create the "rebase_user" role`, the step at the end of [Add PostgreSQL](#3-add-postgresql) was skipped: run it, then `instapods pods restart my-app`.

## File storage

Uploads are stored on the pod's disk under `/home/instapod/app/uploads`, a directory the scaffold's `.gitignore` already excludes from the repository.

In production the runtime refuses local storage unless you say the disk is durable, because on most container platforms it is not: the filesystem is replaced on every deploy, and every uploaded file goes with it. A pod is different, because its files persist across restarts and deploys. `FORCE_LOCAL_STORAGE=true` tells the runtime that.

Keeping the directory inside `/home/instapod/app` also puts it inside InstaPods' daily backup of the pod, which covers that directory and dumps the database alongside it.

What local storage does not do:

- **Serve from more than one machine.** The files exist on this pod only. A second instance, or a CDN in front of the files, needs a bucket.
- **Grow past the plan's disk.** Uploads share the 25 GB with the database and the app.

When you outgrow it, attach any S3-compatible bucket and drop the three local lines:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

Files already on the pod do not move by themselves: copy them to the bucket, keeping their keys. Who may read, write and list files is decided by `storageAuthorize` in `config/storage.ts`, whichever backend holds them. See [Storage](/docs/backend/storage).

## The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema. It creates missing tables, columns and enum types and applies their row-level security, so a new collection is live on the next deploy.

`ensure` never changes something that already exists. It does not alter a column type, drop anything, or edit an existing enum's labels, because a deploy must not reshape a schema as a side effect.

Any change that is not purely additive — a renamed column, a narrowed type, a removed field — needs `rebase db push`, run from your machine.

`db push` plans every change in a scratch copy of the schema, in a database named after yours with `_dev_diff` on the end, and the `instapod` user is not allowed to create databases. Create it once as the superuser:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

The pod's Postgres listens on `localhost` only, so reach it through an SSH tunnel, then push:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Read the SQL the dry run prints, then run it again without `--dry-run`. A change that drops data also needs `--allow-destructive`.

For versioned migrations, commit migration files with `rebase db generate` and put `node_modules/.bin/rebase db migrate` in the **Release** field, which InstaPods runs on every deploy.

If your collections declare a `vector` property, the pod's Postgres needs the pgvector extension: installed on the pod, then created by the superuser with `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"`. The scaffold declares none.

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
- [Storage](/docs/backend/storage) — buckets, access rules, and several storage sources at once.
