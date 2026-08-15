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
    image: postgres:18-alpine
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
FROM rebasepro/server:0.13.0
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

`REBASE_MIGRATE_ON_BOOT` accepts `ensure` (the default — auth tables only) and
`none`.

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
  image = "rebasepro/server:0.13.0"

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
image: rebasepro/server:0.13.0
```

Restart. Your bundle is unchanged. Within a runtime contract major, a bundle that
validated keeps working — see
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
