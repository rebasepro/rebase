---
title: Deploying Rebase on Hostman
description: Deploy a rebase init project on Hostman — App Platform with Managed PostgreSQL and S3 storage, or one cloud server with your project's own Compose file.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) offers two shapes that fit a Rebase backend, with data centers in Europe and the US:

- **App Platform with Managed PostgreSQL.** Hostman builds and runs your app from a GitHub repository and operates the database. Its containers start clean on every deploy, so **file uploads need an S3-compatible bucket from day one**.
- **One cloud server.** Postgres and the runtime on a VPS, under the `docker-compose.yml` your project already has. **Uploads can stay on the server's disk.**

Nothing on this page is Hostman-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs on a laptop, on Rebase Cloud and here.

## App Platform

### 1. Create the database

In the Hostman panel, create a **Managed PostgreSQL** cluster:

- **Version:** 16 or newer.
- **Region:** the one you will run the app in.
- **Network:** a private network. Put the app in the same one in step 4. An app's network is chosen when it is created and cannot be changed afterwards.

The cluster comes with a user, `gen_user`, and a database, `default_db`. From the **Connection** tab, copy the connection string for the **private IP**. It is your `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

If the cluster requires TLS, add `?sslmode=require` to the end.

#### Create the role Rebase switches to

Rebase enforces row-level security by switching each signed-in request to a restricted role, `rebase_user`. `gen_user` has to be allowed to create that role and to switch into it.

1. On the cluster's **Users** tab, give `gen_user` the **CREATE ROLE** privilege. Hostman's smallest configuration (1 CPU, 1 GB RAM, 20 GB) does not allow adding users or databases. If it will not let you grant the privilege, choose the next configuration up.
2. Connect once as `gen_user` with `psql`, before the first deploy, and run:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   The database is on a private network, so run this from a cloud server in the same network, or turn on public access for the duration.

The second statement is the one that matters. On PostgreSQL 16 and newer, a user that creates a role without being a superuser is made a member of it, but not one that may switch into it. If the runtime creates the role itself, boot succeeds and every signed-in request then fails with `DB_PERMISSION_DENIED`. If that has already happened, run the `GRANT` line and restart the app.

If your tables declare a `col.vector()` column, enable **pgvector** under **Configuration → Extensions**. The scaffold declares none.

### 2. Create a bucket

Create an S3-compatible bucket — Hostman's own S3 storage, or any other provider. From the bucket's settings, note the endpoint, region, access key and secret key. Keep the bucket **private**: Rebase signs every download, and `storageAuthorize` in `backend/storage.ts` decides who may read, write and list.

### 3. Add a Dockerfile

App Platform builds from your repository, and `dist-bundle/` is gitignored, so the image builds the bundle itself, then hands it to the published runtime. Commit this at the project root:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.30.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Three details matter here:

- **`node:22`, not `node:22-slim`.** Installing the CLI downloads the Atlas schema engine, which needs `curl` and CA certificates. The slim image has neither, and the install fails.
- **`--chown=node:node`.** The runtime runs as `node` and links its own packages into the bundle at start. A root-owned bundle still serves, but logs a warning for every package it could not link.
- **No source in the final image.** It holds the runtime and your compiled bundle. Upgrading Rebase later is a change to the second `FROM` line.

The runtime image listens on port 8080 and declares it with `EXPOSE`, which is the port App Platform routes to.

### 4. Create the app

In **App Platform**, create a **Backend** app:

1. Connect the GitHub repository and branch.
2. Set **Framework** to **Dockerfile**.
3. Pick the same region as the database, and the database's **private network**.
4. Pick a configuration with **2 GB of RAM**. The bundle builds as part of the image and the build peaks at about 1 GB, so a 1 GB configuration can run out of memory.
5. Set the **health check path** to `/livez`. The default, `/`, works too, but `/livez` answers without touching the database, so a brief database hiccup does not restart a healthy app.

Under **Advanced settings**, add the environment variables:

```env
NODE_ENV=production
DATABASE_URL=postgresql://gen_user:<password>@<private-ip>:5432/default_db
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app-domain>
FRONTEND_URL=https://<your-app-domain>
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

`REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` name the first administrator. In production the first account to register is not promoted, so nothing else produces one. The runtime creates the account once, while the user table is empty. See [Your first admin](/docs/getting-started/deployment/#your-first-admin).

The app's address is not known until it exists. Create the app, read its technical domain from the **Dashboard** tab, then set `CORS_ORIGINS` and `FRONTEND_URL` to it. Saving the settings redeploys the app.

### 5. Open it

Open the app's domain. One container serves the admin panel at `/` and the API at `/api`. Sign in with `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD`, then change the password.

Every push to the branch redeploys. To add your own domain, use **Settings → Domains**. Hostman issues the certificate. Add the new origin to `CORS_ORIGINS` and `FRONTEND_URL`.

## One cloud server

A Hostman cloud server runs the same stack as any VPS: Postgres and the runtime under your project's own `docker-compose.yml`, with Caddy in front for HTTPS. A server with 2 vCPU and 2 GB of RAM is enough to start.

Create it with **Ubuntu 24.04** and your SSH key, then follow the [one-server steps on the Hetzner page](/docs/deployment/hetzner/#one-server-from-your-project). Nothing in them depends on Hetzner.

On a server, uploads stay on its disk: the Compose file keeps them on a named volume and sets `FORCE_LOCAL_STORAGE=true`. They survive restarts and redeploys, but not the loss of the server, so turn on Hostman's server backups or move them to a bucket when they start to matter.

## The schema

<span class="since-badge" data-since="0.31">Since 0.31</span>

**The runtime creates missing tables at boot, including the ones `backend/schema` declares.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema. It creates missing tables, columns and enum types and applies their row-level security, so a new table is live on the next deploy.

`ensure` never changes something that already exists. It does not alter a column type, drop anything, or edit an existing enum's labels, because a deploy must not reshape a schema as a side effect.

Any change that is not purely additive — a renamed column, a narrowed type, a removed field — needs `rebase db push`, run from a checkout:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Read the SQL the dry run prints, then run it again without `--dry-run`. Two things to arrange on Managed PostgreSQL first:

- **Reachability.** A database on a private network is not reachable from your laptop. Enable public access for the duration, or run the command from a server in the same network.
- **The scratch database.** `db push` plans every change in a throwaway copy of the schema, in a database named after yours with `_dev_diff` on the end. Give `gen_user` the **CREATEDB** privilege, or create `default_db_dev_diff` once from the panel. Neither is possible on the smallest configuration.

For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
- [Storage](/docs/backend/storage) — buckets, access rules, and several storage sources at once.
