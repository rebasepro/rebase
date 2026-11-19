---
title: Deploying Rebase on Out Plane
description: Deploy a rebase init project on Out Plane — one app built from your repository, Out Plane's managed PostgreSQL, and file uploads in an Out Plane bucket.
sidebar_label: Out Plane
---

[Out Plane](https://outplane.com) builds and runs apps from a GitHub repository, with managed PostgreSQL and S3-compatible buckets in the same console, in Germany. A Rebase backend is one container and a Postgres, so it maps onto three Out Plane resources: an **app**, a **database** and a **bucket**.

This page takes a project fresh from `rebase init` to a live URL, on one instance.

**Written for Rebase 0.32.0.** The version is pinned in the Dockerfile in step 3; upgrading later is a change to that one line.

**File uploads go to a bucket from day one.** An Out Plane app's filesystem is reset on every redeploy, so files written to its disk would be lost on the next push. See [File storage](#file-storage).

## What you need

- An Out Plane account. The **Starter** plan covers this page: one app, one managed database and one bucket.
- A GitHub repository for the project.
- Optionally, the [`outplane` CLI](https://docs.outplane.com). Every step below can be done in the console; the CLI equivalents are given where they save time.

## 1. Create the project and push it

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Commit it and push it to a GitHub repository. `.env` is gitignored, and stays that way: the app gets its own values in step 5.

## 2. Create the database

In the console, choose **Create → Database**:

- **Version:** 17 (the default) or 16. Anything from 16 up works.
- **Region:** Frankfurt, next to your app.

```bash
outplane db create my-app-db --region aws-eu-central-1
```

From the database's **Connection** panel, copy the connection string (the `psql` format), or print it with `outplane db url my-app-db`. Out Plane requires SSL on every connection. Your `DATABASE_URL` is that string with `sslmode=no-verify` on the end, in place of any `sslmode` it already has:

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
```

**Use `no-verify`, not `require`.** Both encrypt the connection. To `psql`, `require` also means "do not check the certificate against a public authority", but the Postgres driver Rebase runs on reads it as "check it", and a database certificate that is not publicly signed then fails the first connection with `self-signed certificate`. `no-verify` is the driver's spelling of what `require` means everywhere else. Out Plane's own Node.js guide turns the check off for the same reason. The same URL works for `rebase db push` from your machine: the CLI passes it to the Atlas schema engine as `sslmode=require`.

### The role Rebase switches to

Rebase enforces row-level security by switching each signed-in request to a restricted role, `rebase_user`. At first start the runtime creates that role, grants the role in your connection string the right to switch into it, and proves the switch works before it serves anything. There is nothing to run by hand.

If the first start stops with an `AppRoleSetupError` naming `rebase_user`, the role in your connection string is not allowed to create roles or to grant itself the switch. The error prints the SQL to run instead: run it once, as a role on the database that may create roles, then redeploy.

If your tables declare a `col.vector()` column, the database needs the pgvector extension. The scaffold declares none.

## 3. Create a bucket

Under **Buckets → Create bucket**, create one and keep it **private** (the default). Rebase serves every download through its own API, and `storageAuthorize` in `backend/storage.ts` decides who may read, write and list.

Out Plane adds a random suffix to the name. Use the **full** name it shows, not the short one you typed.

On the bucket's **Access** tab, create a key with **Read and write** permission. The secret is shown once: copy it now.

```bash
outplane bucket create my-app-uploads
outplane bucket key create my-app-uploads
```

Out Plane's notes on browser uploads needing a CORS rule do not apply here: the Rebase admin panel and SDK upload through the API, and the runtime writes to the bucket from the server.

## 4. Add a Dockerfile

Out Plane builds either from a Dockerfile or with Buildpacks. Use a Dockerfile: the project installs with pnpm, and the image builds the bundle itself, then hands it to the published runtime. Commit this at the project root:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.34.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Three details matter here:

- **`node:22`, not `node:22-slim`.** Installing the CLI downloads the Atlas schema engine, which needs `curl` and CA certificates. The slim image has neither, and the install fails.
- **`--chown=node:node`.** The runtime runs as `node` and links its own packages into the bundle at start. A root-owned bundle still serves, but logs a warning for every package it could not link.
- **No source in the final image.** It holds the runtime and your compiled bundle, and `dist-bundle/` stays gitignored.

The runtime image listens on port **8080** and declares it with `EXPOSE`, so Out Plane prefills the port when it reads the Dockerfile.

## 5. Create the app

Create an application from the console, connect the repository and branch, and set:

| Field | Value |
| --- | --- |
| Build method | **Dockerfile** |
| Root directory | `/` |
| Port | `8080`, **HTTP**, **public** |
| Start command | *(leave empty — the image's own)* |

```bash
outplane app create my-app --repo <owner>/<repo> --branch main --port 8080:http:public
```

Under **Settings → Environment**, choose **Edit as .env** and paste:

```env
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app>.outplane.app
FRONTEND_URL=https://<your-app>.outplane.app
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<full bucket name, with its suffix>
S3_REGION=auto
S3_ENDPOINT=https://obj.outplane.dev
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
```

Then **Save & deploy**. Out Plane applies environment changes on the next deployment only. With the CLI, put the same lines in a file and run `outplane env push --app my-app --deploy`.

What the less obvious lines are for:

- **`NODE_ENV=production`.** Out Plane does not set it. Without it the runtime starts in development mode, where the first stranger to register becomes the administrator.
- **`REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD`.** In production the first account to register is not promoted, so these name the first administrator. The runtime creates the account once, while the user table is empty. See [Your first admin](/docs/getting-started/deployment/#your-first-admin).
- **`S3_FORCE_PATH_STYLE=false`.** Rebase addresses a custom S3 endpoint path-style by default, because MinIO and most self-hosted stores need it. Out Plane buckets accept virtual-hosted requests only (`https://<bucket>.obj.outplane.dev/…`), and path-style requests fail. This line is required.
- **`S3_REGION=auto`.** Out Plane buckets are global, and clients sign with `auto`.

The app's `outplane.app` address appears once the app exists. If it differs from what you guessed, correct `CORS_ORIGINS` and `FRONTEND_URL` and **Save & deploy** again.

## 6. Open it

Open the app's URL. One container serves the admin panel at `/` and the API at `/api`. Sign in with `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD`, then change the password.

The first start creates every table it needs, your tables included, along with their row-level security policies. There is no migration to run first. Upload a file from the admin panel to confirm the bucket settings: an error there almost always means the bucket name is missing its suffix, or `S3_FORCE_PATH_STYLE=false` is missing.

Every push to the branch redeploys. To use your own domain, add it under **Domains**, connect it to the app's port 8080, and create the CNAME (or, for a root domain, the A record) the console shows. HTTPS is issued once the record resolves. Then add the new origin to `CORS_ORIGINS` and `FRONTEND_URL`.

## One instance

This page runs **one instance**, which is Out Plane's default and the Starter plan's limit. One container serves the API, the admin panel, realtime, cron and the job queue.

Scheduled jobs would stay correct with more: every cron run is claimed in Postgres before it starts, so a slot runs once however many instances fire for it. Other things are per instance — rate limiters, image-transform caches, resumable uploads in progress — so read [More than one instance](/docs/deployment/multiple-instances/) before raising the count under **Settings → Scale**.

## File storage

Uploads live in the Out Plane bucket from step 3, so they survive redeploys, and the app's own disk holds nothing that matters.

To rotate the key: create a new one on the bucket's **Access** tab, set it as `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, **Save & deploy**, then delete the old key. Out Plane notes that a deleted key can keep working for up to 15 minutes.

Who may read, write and list files is decided by `storageAuthorize` in `backend/storage.ts`, whichever bucket holds them. See [Storage](/docs/backend/storage).

## The schema

**The runtime creates missing tables at boot, including the ones `backend/schema` declares.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema. It creates missing tables, columns and enum types and applies their row-level security, so a new table is live on the next deploy.

`ensure` never changes something that already exists. It does not alter a column type, drop anything, or edit an existing enum's labels, because a deploy must not reshape a schema as a side effect.

Any change that is not purely additive — a renamed column, a narrowed type, a removed field — needs `rebase db push`, run from a checkout:

```bash
pnpm exec rebase db push --dry-run --database-url '<your DATABASE_URL>'
```

Read the SQL the dry run prints, then run it again without `--dry-run`. A change that drops data also needs `--allow-destructive`.

`db push` plans every change in a scratch copy of the schema, in a database named after yours with `_dev_diff` on the end. Create it once on the database's **Access** tab, owned by the same role as your database.

For versioned migrations, commit migration files with `rebase db generate` and run `pnpm exec rebase db migrate --database-url '<your DATABASE_URL>'` from a checkout before you push. Out Plane has no release step that runs before a deploy.

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
- [Storage](/docs/backend/storage) — buckets, access rules, and several storage sources at once.
