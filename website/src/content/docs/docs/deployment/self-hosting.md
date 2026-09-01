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

```bash
rebase build                     # produces ./dist-bundle
docker compose up -d db          # start Postgres
rebase db push                   # create the collection tables, once
docker compose up                # start the runtime
```

A minimal `docker-compose.yml`:

```yaml
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rebase
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      retries: 12

  api:
    image: rebasepro/server:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      # Writable: the container installs the bundle's declared dependencies into
      # it on first start. See "Dependencies" below for the read-only variant.
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

volumes:
  db-data:
```

## Dependencies

`rebase build` writes a `package.json` next to your bundle listing the
dependencies your project declared. The container installs them on first start,
which is why the mount above is writable.

To mount read-only instead — worth doing, because a compromised hook then cannot
rewrite the code that runs after the next restart — install them first:

```bash
npm install --omit=dev --prefix dist-bundle
```

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

For a real deployment, prefer baking both into an image, which also pins exactly
what runs:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Creating the schema

The runtime creates its own **auth** tables at boot. **Collection tables are a
separate, deliberate step**, and the runtime image does not do it — a container
restart must not be able to change a schema as a side effect of a deploy.

```bash
rebase db push
```

Run it from a checkout or a CI job, pointed at the deployment's database. It
dry-runs the change first, refuses destructive ones without explicit
confirmation, and can take a backup before applying.

`REBASE_MIGRATE_ON_BOOT` accepts `ensure` (the default) and `none`, and nothing
else — the image **refuses to boot** on `push`, for the reason above. `ensure` is
additive across the whole schema, not just the auth tables: it creates missing
tables, columns and enum types, and never drops or rewrites one.

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

Run it under systemd, with `Environment=` lines for the variables above.

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
