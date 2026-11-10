---
title: Deploying Rebase on Hetzner Cloud
description: Deploy a Rebase project on one Hetzner Cloud server with its own Docker Compose file and Caddy for HTTPS, or provision it with Terraform, for EU-based hosting.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offers an unusually good performance-to-price ratio and is a strong choice for projects that need European data sovereignty, with data centers in Nuremberg, Falkenstein and Helsinki.

Nothing here is Hetzner-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and on a Hetzner box. Moving between them is a change of infrastructure, not of application.

Two ways to get there:

- **[One server, from your project](#one-server-from-your-project):** the `docker-compose.yml` that `rebase init` wrote, on a server you create by hand. File uploads stay on the server's disk.
- **[Terraform](#terraform):** a module that provisions the server, firewall, IP, TLS and a volume that outlives the host.

## One server, from your project

A project from `rebase init` already has the deployment in it: a `docker-compose.yml` that runs Postgres and the published runtime with your bundle mounted, serves the admin panel at `/` and the API at `/api` from one container, and keeps uploads on a volume. This section puts that file on a server and puts Caddy in front of it for HTTPS.

### 1. Create the server

1. In the Hetzner Cloud Console, click **Add Server**.
2. Choose a **Location**: Falkenstein, Nuremberg or Helsinki for EU data residency.
3. Choose the **Ubuntu 24.04** image.
4. Choose a type with at least **2 vCPU and 4 GB of RAM**. The runtime, Postgres and Caddy share it.
5. Turn on **Backups**. The database and the uploads live on this server's disk, and backups are what survives losing it.
6. Add your SSH key and create it.

Point an A record for your domain — `app.example.com` below — at the server's address now. Caddy needs it to get a certificate.

### 2. Install Docker and Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Build the bundle and copy it up

From your project, on your machine:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compiles your collections, functions and crons into `dist-bundle/`, with their dependencies and the built admin panel. There is no application image to build: the server runs the published runtime image with that directory mounted into it.

### 4. Make the configuration production's

On the server, edit `/opt/my-app/.env`. `rebase init` filled it in for your laptop. Change these lines:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Keep the generated `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` and `REBASE_ADMIN_PASSWORD`, or replace them with fresh values from `openssl rand -hex 32`. The Compose file reads them from here and stops with a message naming any that is missing.

The file passes the `api` service only the variables it names, so the rest of `.env` — `NODE_ENV=development` among them — does not reach the runtime. The service runs with `NODE_ENV=production`. A variable the file does not list goes in the service's `environment:` block.

`REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` are the first administrator. In production the first account to register is not promoted, so the runtime creates this one at first start, while the user table is empty. Sign in with it and change the password. See [Your first admin](/docs/getting-started/deployment/#your-first-admin).

Then, in `/opt/my-app/docker-compose.yml`, bind both published ports to loopback:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

As generated, the file publishes Postgres and the API on every interface, which on a laptop is harmless. On a public server it puts the database on the internet, and Docker publishes ports past `ufw`, so a firewall rule does not close them. With `127.0.0.1`, only Caddy and SSH tunnels reach them.

### 5. Start it

```bash
cd /opt/my-app
docker compose up -d
```

The first start creates every table it needs, your collections' included, along with their row-level security policies.

### 6. Terminate TLS with Caddy

Replace `/etc/caddy/Caddyfile` with:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy gets a Let's Encrypt certificate for the domain and renews it. Open `https://app.example.com` and sign in.

### Deploying again

Rebuild, copy the bundle, restart the runtime:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copying a directory to a box by hand is fine for one server. Past that, use one of the shapes that do not involve it:

- **Bake it into an image.** `FROM rebasepro/server:0.29.2`, then `COPY --chown=node:node dist-bundle /bundle`, and deploy by changing a tag.
- **Serve it over HTTP.** Set `REBASE_BUNDLE_URL` and the runtime fetches and unpacks the bundle on every start. The Terraform module below does this, and the Helm chart uses the same mechanism.

## Terraform

The `terraform-hcloud-rebase` module provisions the server, a firewall, a stable IP and — the part that matters — a volume that holds Postgres data, so replacing the host does not destroy the database. It runs the published runtime under Docker Compose with Caddy in front, and fetches your bundle from a URL.

The module is not on the Terraform Registry. Use it from the Rebase repository, pinned to a release:

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.29.2"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.29.2" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

One thing to get right before the first apply: the A record for `domain` must already point at the server, or Caddy's Let's Encrypt challenge fails. The address is created independently of the server, so you can get it first with `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, set DNS, then apply properly.

The module's [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) lists every variable.

## File storage

**Uploads can stay on the server.** The project's Compose file keeps them on a named volume, mounted at `/storage`, and sets `FORCE_LOCAL_STORAGE=true`. They survive restarts and redeploys. They do not survive losing the server, which is what Hetzner's backups are for.

Without that setting, the runtime refuses local storage in production. On most container platforms the filesystem is replaced on every deploy, so a local backend there is silent data loss. Uploads then answer `501 STORAGE_NOT_CONFIGURED` until a bucket is configured.

When you outgrow one disk, or run a second server, move uploads to Hetzner Object Storage. It is S3-compatible and sits in the same data centers. In the `api` service's `environment:` block, replace `STORAGE_PATH` and `FORCE_LOCAL_STORAGE` with:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

with the two keys in `.env`. Files already on the volume do not move by themselves: copy them to the bucket, keeping their keys.

The Terraform module takes the same choice as variables: an S3 bucket, or `force_local_storage = true`, which keeps uploads on its data volume. See [Storage](/docs/backend/storage) for the full picture.

## What boot does to your schema

With `REBASE_MIGRATE_ON_BOOT` at its default of `ensure`, the runtime provisions your collection tables **and their row-level security policies** at boot, additively. A new collection is live on the next deploy, with no schema step to run first.

What boot deliberately never does is anything destructive: it does not alter a column type, drop a column, or edit an existing enum label. A container restart must not be able to reshape a schema as a side effect.

One thing therefore still needs [`rebase db push`](/docs/architecture/schema-as-code): any change that is not purely additive — a renamed column, a narrowed type, a removed field. Run it from your checkout, through an SSH tunnel to the loopback port:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Read the SQL the dry run prints, then run it again without `--dry-run`. `sslmode=disable` is there because the Compose database has no TLS; the tunnel is what encrypts the connection.

A database port open to the internet is how a Rebase deployment gets its rows read around row-level security rather than through it. Keep it on loopback and use the tunnel.

## Upgrading

Change `REBASE_VERSION` in `.env` and recreate the runtime:

```bash
docker compose pull api && docker compose up -d api
```

Your bundle is untouched.

The exception is the Postgres major version: Postgres refuses to start against a data directory written by an older major, so that upgrade is a dump and restore, never in place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Self-hosting](/docs/deployment/self-hosting) — the same deployment with no scaffold behind it, a connection pooler, and split processes.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
