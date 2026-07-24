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
rebase build
docker compose -f docker/docker-compose.selfhost.yml up
```

A minimal compose file:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: rebase
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
      REBASE_MIGRATE_ON_BOOT: push
    volumes:
      - ./dist-bundle:/bundle:ro
    ports:
      - "8080:8080"

volumes:
  db-data:
```

Mounting the bundle read-only is deliberate: the runtime never writes to it, and
a compromised hook then cannot rewrite the code that runs after the next restart.

## Creating the schema

The runtime creates its own auth tables on first boot. **Collection tables are a
separate, deliberate step** — a container restart must not be able to rewrite a
production schema as a side effect.

- `REBASE_MIGRATE_ON_BOOT=push` reconciles collection tables at boot. Convenient
  for a trial; wrong for a database you care about. It runs under a Postgres
  advisory lock, so several replicas starting at once will not race.
- `REBASE_MIGRATE_ON_BOOT=none` (the production default) touches nothing. Run
  schema changes deliberately:

```bash
rebase db push
```

## Other platforms

The runtime is an ordinary container listening on `$PORT`, so anything that runs
containers works. Two things to get right everywhere:

1. The bundle must be present at `/bundle` (or wherever `REBASE_BUNDLE` points).
   Either mount it, or build a small derived image:

   ```dockerfile
   FROM rebasepro/server:0.11.0
   COPY dist-bundle /bundle
   ```

2. Set `CORS_ORIGINS`, `JWT_SECRET` and `DATABASE_URL`. The runtime refuses to
   start in production without them rather than guessing.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.11.0"

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

## Upgrading

```yaml
image: rebasepro/server:0.12.0
```

Restart. Your bundle is unchanged. Within a runtime contract major, a bundle that
validated keeps working — see
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
