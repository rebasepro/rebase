---
title: Splitting into several processes
sidebar_label: Split Processes
description: Run one bundle as several cooperating processes — an API, a functions tier, a worker — from the same published runtime image, so a heavy custom function stops competing with the data API.
---

## Overview

A Rebase deployment is normally one process serving everything: the data API,
auth, storage, your custom functions, cron and the job queue. That is the right
shape for almost every deployment and it stays the default.

When it stops being the right shape — a custom function that pins the event loop,
a function tier that should scale or restart independently of the API — you can
boot **the same image and the same bundle** several times over and have each
process serve a different part of the project. There is nothing new to build and
nothing for a client to know about: the URLs do not change.

One environment variable decides what a process is:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## What each role serves

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, the schema editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | forwards (see below) | ✅ | — |
| `/api/cron` (the admin surface) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Creates the schema at boot | ✅ | ✅ | — | — |
| Runs the cron scheduler | ✅ | ✅ | — | ✅ |
| Runs job-queue workers | ✅ | ✅ | — | ✅ |

Health and metrics are on every role without exception. A process an
orchestrator cannot probe is a process it cannot roll.

## Docker Compose

Two services from one image, one bundle and one database:

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Both processes need the same `DATABASE_URL`, the same `JWT_SECRET` and the same
`REBASE_SERVICE_KEY` — they are one deployment, and a token minted by one has to
be accepted by the other.

## Keeping the URLs the same

`REBASE_FUNCTIONS_UPSTREAM` tells the `api` process to forward `/api/functions/*`
to the functions process rather than serve it. Clients, generated SDKs and API
keys see exactly the surface they saw before the split, so no application code
changes and you do not have to stand up a reverse proxy to try one.

A production deployment may prefer to route the path at its ingress instead, in
which case leave `REBASE_FUNCTIONS_UPSTREAM` unset — the `api` process then
answers 404 for those paths and the proxy in front decides where they go.

### Proxy hops

When the API forwards, it appends the caller's address to `X-Forwarded-For`. That
makes the functions process sit behind **one more proxy hop** than the API does,
and it must be told so:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` is the number of reverse proxies you actually run in front
of a process. Each one appends the address it saw to `X-Forwarded-For`, so the
real client is the Nth entry from the right; everything further left is
client-supplied and ignored, which is what stops a caller spoofing the header to
rotate rate-limit keys. It defaults to `0` — no proxy trusted.

Get this wrong and nothing breaks visibly: rate limiters on the functions process
key every request to the API container's address, so all your callers share one
bucket, and the IP recorded on every auth event is the same one.

## One process owns the schema

Exactly one process in a split deployment creates tables and applies RLS
policies at boot, and that is the `api` (or `all`) one. Every other process must
set:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

This is **required**, not advisory: a `functions` or `worker` process left on the
default refuses to start, and says so. `CREATE … IF NOT EXISTS` reads the catalog
and then writes to it as two separate steps, so processes booting together do
collide — and a deployment where several of them race to provision the same
schema is not one anybody designed.

## Serving one function per process

A process can serve a named subset, which is how one expensive function gets its
own replica count without its code moving anywhere:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Names are filenames without the extension — the same name the function is mounted
under. A name the bundle does not contain **fails the boot**, and the error lists
the names it does contain. A process configured for one function exists for that
function, so a typo that silently served nothing would be the worst outcome
available.

## Cron and background jobs

Both are already safe to run in more than one process: the cron scheduler claims
each `(job, slot)` pair in the database, and the job queue claims rows with
`FOR UPDATE SKIP LOCKED`. So `api` keeps running both by default and a two-service
split is complete without a third container.

Add a `worker` process when you want scheduled work off the request path, and
turn it off on the API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

A `functions` process never runs either. It is scaled by request load and
replaced at will, and giving it scheduled work would make its replica count mean
something it should not.

Note that `rebase.jobs.enqueue` keeps working everywhere, including on a process
that runs no workers — enqueueing is a write, running is a poll loop, and only
the second is what a role turns off.

## What splitting does not give you

**Shared rate limits.** The default rate-limit store is per process, so N
processes multiply every caller's allowance by N. Pass a shared `rateLimit.store`
in your backend config if the limit has to hold across the whole deployment.

**Cross-instance channels.** Broadcast and presence use an in-memory bus by
default, which does not cross processes. This is a *replica count* question
rather than a split question — it is equally true of a single-role deployment
scaled to three — so set `REALTIME_CHANNEL_BUS=postgres` (or `realtime.bus` in
config) whenever more than one process serves websockets.

**Scale to zero.** Nothing here scales a process down to nothing or spins one up
on demand. That is a platform capability, not a runtime one.

## Upgrading

Unchanged: every process runs the same published image, so an upgrade is the same
tag change on each of them. Roll the `api` last if you want the schema
provisioning to happen against the new version first — though in practice the
order does not matter, because the schema step is additive and idempotent.
