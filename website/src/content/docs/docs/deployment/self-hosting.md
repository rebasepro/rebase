---
title: Self-Hosting
sidebar_label: Self-Hosting
description: Run Rebase anywhere with the official runtime image and your project bundle — Docker Compose, Fly, Railway, or a plain VPS.
---

## Overview

Self-hosting Rebase means running two things: a Postgres database, and the
official `rebasepro/server` image with your project's bundle mounted into it.

There is **no application image to build**. Your project travels as a bundle,
the runtime is published, and upgrading Rebase is a tag change rather than a
rebuild. See [Runtime and bundles](/docs/architecture/runtime-and-bundles/) for
why it is split that way.

## Docker Compose

**If your project came from `rebase init`, use its own `docker-compose.yml`.**
It is in your repository, `init` filled in its secrets, its first admin account
and its pinned runtime version, and it is the file
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
describes:

```bash
rebase build
docker compose up -d
```

The rest of this page is the same deployment without a scaffold behind it —
somebody else's project, a bundle built in CI, or the two things the generated
file deliberately leaves out: a connection pooler and the split-process shapes.
That one lives in the repository, at
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use it rather than copying a snippet out of this page: both files are booted by
the project's own acceptance gate on every push, so neither can drift from what
actually works.

The two agree on every environment variable except the database password, and
that is because each is written for its own writer: this one reads
`POSTGRES_PASSWORD`, which `quickstart.sh` generates; the generated one reads
`DATABASE_PASSWORD`, which `rebase init` also embeds in the `DATABASE_URL` it
writes into your `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` is one command doing two obvious things and printing both. The
long form, if you would rather own each step:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

You do not need to start the database separately — `api` waits on its
healthcheck.

### The six values it needs

`quickstart.sh` generates these for you. To write the `.env` yourself:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Three secrets, one fact, and the account you sign in with:

- **`POSTGRES_PASSWORD`** — the database password. Changing it later means
  changing it in the volume too, so pick it once.
- **`JWT_SECRET`** — signs every session. Rotating it signs everybody out.
- **`REBASE_SERVICE_KEY`** — the credential that bypasses row-level security for
  server-to-server calls. Treat it like a root password: anything holding it can
  read every row.
- **`CORS_ORIGINS`** — the origins your frontend is served from, comma-separated.
  Not a secret, and not optional: the runtime refuses to start in production
  without it rather than guessing, because an API that guesses its allowed
  origins eventually allows the wrong one.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — the first
  administrator. A fresh database has no users, and outside production the
  registration policy admits the first sign-up and promotes it to admin —
  otherwise an empty database is a dead end, because bootstrapping an admin
  needs a caller who is already signed in. The moment this stack answers on a
  hostname that convenience is a race the operator can lose, so in production
  the window is shut and the account is named here instead. The runtime creates
  it once, while the user table is empty, and does nothing on every boot after
  that.

Each of the three secrets must be at least 32 characters, and the admin password
at least 12. Use an address with a dot in its domain: `POST /auth/login` parses
its body with `z.string().email()`, so `admin@localhost` would seed an account
and then refuse every attempt to use it. The compose file declares all six with
`${VAR:?…}`, so a missing one stops the stack with a message naming it rather
than starting something half-configured — and self-registration ships off
(`DISABLE_SELF_REGISTRATION`, default `true`), so nothing is left to be claimed.

Sign in with those credentials and change the password: they are sitting in a
file on the host.

## Dependencies

`rebase build` **installs your project's dependencies into the bundle** by
default, so `dist-bundle` arrives with a `node_modules` and a `package-lock.json`
beside its `package.json`. A vendored bundle starts in about five seconds.

Because they are already there, you can mount the bundle read-only — worth
doing, since a compromised hook then cannot rewrite the code that runs after the
next restart:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` opts out and produces a bundle that installs its
dependencies on first start instead, which takes 40–60 seconds per start and
needs the mount to be writable.

For a real deployment, prefer baking both into an image, which also pins exactly
what runs:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Creating the schema

**The runtime creates missing tables at boot, including your collections'.**
`REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole
schema: it creates missing tables, columns and enum types, and applies their
row-level security. A first start against an empty database comes up serving
your collections, with no separate step.

What `ensure` deliberately never does is change anything that already exists. It
does not alter a column type, does not drop a table or a column, and does not
edit an existing enum's labels — because a container restart must not be able to
reshape a schema as a side effect of a deploy.

So `rebase db push` is still worth running, for the two things boot leaves
alone:

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed
  type, a removed field.

Run it from a checkout or a CI job, pointed at the deployment's database. It
dry-runs the change first, refuses destructive ones without explicit
confirmation, and can take a backup before applying. The database publishes a
port in the compose file so this can reach it from the host; remove that mapping
once the schema is in place if the database should not be reachable from
outside.

`REBASE_MIGRATE_ON_BOOT` accepts `ensure` and `none`, and nothing else — the
image **refuses to boot** on `push`, for the reason above.

## File storage

Storage is **off** unless a bucket is configured, and that is deliberate: the
alternative default is the container filesystem, which silently loses every
uploaded file on the next restart. Uploads are refused with
`501 STORAGE_NOT_CONFIGURED` until you set one up.

For a bucket, set `STORAGE_TYPE=s3` (or `gcs`) plus its bucket and credentials —
the compose file lists the variables, commented out.

For local disk, which is only appropriate when the path is a real volume that
outlives the container:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` is not optional there: in production a `local` backend is
dropped rather than registered, because the alternative is uploads that succeed
into a filesystem about to be destroyed. The variable is how you say the mount
is durable.

### Storage needs an access-control model

Once a bucket **is** configured, the runtime **refuses to boot in production**
until the deployment states how objects are protected. Storage is not under
row-level security and its keys share one flat namespace, so with no rule the
only thing separating two users' files is key unguessability — which
`GET /storage/list?prefix=` defeats. Any one of these satisfies it:

- a **`storageAuthorize` hook** (or `storagePolicies`) in your project's config,
  which is the real answer and what the scaffold ships in `config/storage.ts` —
  no environment variable can express "this user may read this key";
- **`STORAGE_PUBLIC_READ=true`**, for a bucket that genuinely is a public
  read-only CDN;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, for a single-tenant app where
  every signed-in account is trusted with every file.

Outside production the same condition is a loud warning rather than a refusal,
so this is a boot failure you meet on the deploy rather than on the laptop. It
is deliberate: the failure it replaces is silent.

Set `MFA_ENCRYPTION_KEY` too if you use TOTP. Left unset, stored authenticator
secrets are encrypted with `JWT_SECRET` — so rotating that signs everybody out
*and* makes every enrolled device undecryptable.

## Other platforms

The runtime is an ordinary container listening on `$PORT`, so anything that runs
containers works. Two things to get right everywhere:

1. The bundle must be present at `/bundle` (or wherever `REBASE_BUNDLE` points),
   with its dependencies installed beside it — see [Dependencies](#dependencies).
2. Set `CORS_ORIGINS`, `JWT_SECRET` and `DATABASE_URL`. The runtime refuses to
   start in production without them rather than guessing.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.17.3"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use the derived-image form above so the bundle ships with the app, then
`fly deploy`.

### Railway / Render

Point the service at the derived image, set the environment variables, and set
the health check path to `/livez`.

### A plain VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lists the variables it reads. Under systemd:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` is not decoration. Left unset the process runs in
development mode: it reflects localhost origins, serves the OpenAPI spec, and
**leaves the first-admin window open** — so the first stranger to find the
sign-up form becomes the administrator. The two `REBASE_ADMIN_*` lines are what
replace that window; see [Your first
admin](/docs/getting-started/deployment/#your-first-admin).

Prefer `EnvironmentFile=/etc/rebase.env` with the file at mode 0600 over
`Environment=` lines for the secrets: a unit file is world-readable, and
`systemctl show` prints every `Environment=` value.

## Connection pooling

The runtime holds a small, long-lived pool and does not need a pooler. What does
is everything else that talks to the same database and cannot hold a connection:
a serverless function, a scheduled script, a BI tool, a queue worker that scales
to fifty. Postgres' `max_connections` is a hard limit in the low hundreds and
each connection is a *process*, so a lambda fan-out exhausts it long before the
database is busy.

The compose file ships a `pgbouncer` service for that traffic, behind a profile
so a deployment with no such callers does not run a process it has no use for:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

Client authentication is generated from `DATABASE_URL` on startup, so the
password is not written twice. The pooler authenticates to Postgres with
`scram-sha-256`, which Postgres 18 stores — the image's `md5` default fails the
*server* login with `FATAL: server login failed: wrong password type`, which
reads like a wrong password and is not one.

Keep the sum of `PGBOUNCER_POOL_SIZE` across every pooler comfortably under the
database's `max_connections` — the runtime is drawing from the same budget.

### What transaction pooling changes

A pooled client holds a server connection for the length of a transaction and
then gives it back, which is what lets 500 clients share 20 connections. Three
things stop working through that port, and each is something Rebase itself uses
— which is exactly why the runtime connects directly and this port is for other
callers:

- **`LISTEN`/`NOTIFY`.** Realtime is built on it, and a listener needs a
  connection that outlives a transaction. `LISTEN` is *accepted* through the
  pooler — it answers `LISTEN`, and then no notification ever arrives.
- **Session state**: `SET` (as opposed to `SET LOCAL`), advisory locks held
  across statements, `WITH HOLD` cursors, temporary tables. The next transaction
  may land on a different server connection, which will not see any of it. Both
  of these fail the same unhelpful way: with one idle client the state is
  usually still there, so it works while you are testing and stops working under
  the concurrency you introduced the pooler for.
- **Protocol-level prepared statements.** Most drivers can be told not to use
  them — node-postgres does not by default; asyncpg needs
  `statement_cache_size=0`.

`SET LOCAL` is transaction-scoped and works, which is what row-level security is
set with — so RLS behaves identically through the pooled port.

Leave the profile off if nothing outside the runtime connects to your database.
An unused port is surface.

## Health checks

| Path | Use for |
| --- | --- |
| `/livez` | Liveness. Answers "is this process alive" without touching the database. |
| `/health` | Readiness. Performs a database round-trip and reports latency. |

Point liveness probes at `/livez`. A liveness probe on `/health` restarts a
perfectly healthy process during a brief database hiccup, which is the opposite
of what it is for.

## Metrics

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Exposes Prometheus metrics at `/metrics`: request counts and latency histograms
broken down by API surface (data, auth, storage, functions) and collection, plus
process gauges. Without a token the endpoint is readable by anyone who can reach
the port, so set one unless it is on a private network.

## Running functions in their own process

Everything above is one container serving the whole project, which is the right
shape for almost every deployment. When a custom function should stop competing
with the data API for the event loop — or should scale, restart and fail on its
own — the same image and the same bundle can be booted as several cooperating
processes. See [Split processes](/docs/deployment/split-processes/).

## Upgrading

```yaml
image: rebasepro/server:0.17.3
```

Restart. Your bundle is unchanged. Within a runtime contract major, a bundle that
validated keeps working — see
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
