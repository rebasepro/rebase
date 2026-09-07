---
title: Deploying Rebase on Hetzner Cloud
description: Deploy Rebase on Hetzner Cloud with Terraform or Docker Compose, for excellent EU-based performance and data sovereignty.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offers an unusually good performance-to-price ratio and is a strong choice for projects that need European data sovereignty, with datacenters in Nuremberg, Falkenstein and Helsinki.

Nothing here is Hetzner-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and on a Hetzner box. Moving between them is a change of infrastructure, not of application.

## The quickest path: Terraform

The `terraform-hcloud-rebase` module provisions the server, a firewall, a stable IP and — the part that matters — a volume that holds Postgres data, so replacing the host does not destroy the database.

```hcl
module "rebase" {
  source = "rebasepro/rebase/hcloud"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]

  bundle_url = "https://storage.example.com/bundles/app-1.4.0.tar.gz"

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

One thing to get right before the first apply: the A record for `domain` must already point at the server, or Caddy's Let's Encrypt challenge fails. The address is created independently of the server, so you can get it first with `terraform apply -target=hcloud_primary_ip.ipv4`, set DNS, then apply properly.

The rest of this page is the same deployment by hand.

## 1. Provision a server

1. In the Hetzner Cloud Console, click **Add Server**.
2. Choose a **Location** — Falkenstein, Nuremberg or Helsinki for EU data residency.
3. Choose an **Image**: Ubuntu 24.04.
4. Choose a **Type**: `CPX21` (3 vCPU / 4GB) is a workable floor, `CX32` (4 vCPU / 8GB) is comfortable for the runtime plus Postgres.
5. Add a **Volume** for the database. Data on the server's own disk dies with the server.
6. Add your SSH key and create it.

## 2. Install Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Get your bundle onto the server

There is no application image to build. `rebase build` produces a `dist-bundle` directory, and the published runtime image runs it:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

For a real deployment, prefer one of the two shapes that do not involve copying files to a box by hand:

- **Bake it into an image** — `FROM rebasepro/server:0.17.3` then `COPY dist-bundle /bundle`, and deploy by changing a tag.
- **Serve it over HTTP** — set `REBASE_BUNDLE_URL` and the runtime fetches and unpacks the bundle on every start. This is what the Terraform module above does, and the same mechanism the Helm chart uses.

## 4. Configure and run

Rebase ships a Compose file for exactly this: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). It is the canonical self-hosting recipe — Postgres and the runtime, with your bundle mounted in — and it is worth reading rather than copying, because its comments explain each choice.

Create the environment it expects:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` are new <span class="since-badge" data-since="0.18">Since 0.18</span>: on 0.17.3
the first account to register becomes the administrator, in production too.

All six are required — the Compose file declares them with `${VAR:?…}` and
refuses to interpolate without them.

The last two are the first administrator. A fresh database has no users, and
outside production the first sign-up is promoted to admin — which is a race the
moment this box answers on a hostname, because Caddy has TLS up before you have
typed anything. So in production that window is shut and the account is named
here instead; the runtime creates it once, while the user table is empty, and
does nothing on every boot after that. Sign in and change the password.

Then bring it up:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

The runtime listens on port 8080 inside the Compose network.

`REBASE_SERVICE_KEY` bypasses row-level security. Treat it as a database superuser credential, not as an API key.

## 5. Terminate TLS with Caddy

Never expose the runtime directly. Caddy provisions Let's Encrypt certificates automatically; running it as another Compose service keeps the whole stack in one file:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

With a `Caddyfile` of:

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Point that domain's A record at the server before starting Caddy, or the certificate request fails.

## Storage is not optional

The runtime **refuses to start in production** with local storage configured, because the container filesystem is destroyed on every restart and a local backend in production is silent data loss.

Hetzner Object Storage is S3-compatible and sits in the same datacenters, so it is the natural pairing:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

If your project stores no uploads at all, set `FORCE_LOCAL_STORAGE=true` to acknowledge that explicitly. See [Storage](/docs/backend/storage) for the full picture.

## What boot does to your schema

With `REBASE_MIGRATE_ON_BOOT` at its default of `ensure`, the runtime provisions your collection tables **and their row-level security policies** at boot, additively. A first start against an empty database comes up serving them — there is no schema step to run before the deployment works.

What boot deliberately never does is anything destructive: it does not alter a column type, drop a column, or edit an existing enum label. A container restart must not be able to reshape a schema as a side effect.

Two things therefore still need [`rebase db push`](/docs/architecture/schema-as-code), run from a checkout or CI where the destructive-change gate and a backup are in reach:

- junction-table RLS for many-to-many relations;
- any change that is not purely additive.

If the module or Compose file bound Postgres to loopback — both do — reach it through an SSH tunnel:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

A database port open to the internet is how a Rebase deployment gets its rows read around row-level security rather than through it.

## Upgrading

Change the image tag and restart. Your bundle is untouched, and every project on that runtime picks up the new engine.

The exception is the Postgres major version: Postgres refuses to start against a data directory written by an older major, so that upgrade is a dump and restore, never in place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```
