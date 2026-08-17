---
title: Kubernetes
sidebar_label: Kubernetes
description: Deploy Rebase to a Kubernetes cluster with the official Helm chart — one Deployment or several, a migration Job that owns the schema, and static apps on the same host.
---

## Overview

The chart in `charts/rebase` is the Kubernetes peer of the Docker Compose
self-hosting setup. Same idea, same image, same bundle: **the runtime is the
image, your project is the bundle, and upgrading Rebase is a tag change.**

```bash
helm install rebase ./charts/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

The chart deploys the **runtime only**. It does not deploy Postgres — use
CloudNativePG, a managed database, or your own StatefulSet, and point
`config.databaseUrl` at it. A chart that also owned your database would own your
backups and your failover, which is a much larger promise than "run the app".

> **Maturity.** The chart is rendered and linted against Helm v4, and every
> refusal listed below is covered by a test. It has **not yet been exercised
> against a live cluster**, and `bundle.mode=url` in particular cannot be run
> end to end until the runtime image is published to a public registry. Treat it
> as a well-tested starting point rather than a production-proven default, and
> read [Self-Hosting](/docs/deployment/self-hosting) for the path that is.

## Getting your project into the pod

| `bundle.mode` | How | When |
|---|---|---|
| `image` (default) | Build `FROM rebasepro/server` with `COPY dist-bundle /bundle`, then set `image.repository` | Almost always. One artifact, immutable, no runtime dependency on a URL staying up |
| `url` | Stock image; the runtime downloads a tarball at every pod start | A control plane that ships bundles out of band |

## One process, or several

The default is a single Deployment serving everything — the same shape the
Compose file runs. Splitting is one value:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

That gives you an `api` tier, a `functions` tier and a `worker`, all from the
same image and the same bundle. See [Split Processes](/docs/deployment/split-processes)
for what each role does and why you would separate them.

What the chart adds over doing it by hand is that it **derives the settings whose
failure mode is silence**, from the values you already gave it:

- `REBASE_ROLE` per unit
- `REBASE_MIGRATE_ON_BOOT=none` everywhere, because the migration Job owns the schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` on the api once a worker exists
- `TRUSTED_PROXY_HOPS` on the functions unit
- `REBASE_RATE_LIMIT_STORE=sql` as soon as a second process serves HTTP

A wrong `REBASE_ROLE` serves no HTTP while `/health` still answers, so readiness
passes and every request 404s. A missing `REBASE_MIGRATE_ON_BOOT` is a crash loop
whose reason sits in a log nobody is watching. The chart writes all of them, and
`config.env` cannot override them.

### Splitting cron from job execution

Two workers with opposite ownership — no new role, and no code:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## The admin panel, and any other front end

A static app is the same runtime image booting a `kind: static` bundle. That path
short-circuits before the runtime reads `DATABASE_URL` or `JWT_SECRET`, so these
pods carry **no secrets at all**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

The ingress routes `/admin` to it and `/` to the API, on the **same host**. That
is deliberate: same origin means cookie auth and CORS are exactly what they were,
and the split stays an internal topology decision rather than a change to your
product's public surface. The price is that the assets must be *built* for that
path, which the runtime checks at boot.

Deploying the admin is then an image tag bump on one Deployment. The backend does
not restart.

## Schema

`migrationJob.enabled` (the default) runs a `pre-install,pre-upgrade` Job that
provisions and exits, and every pod boots with `REBASE_MIGRATE_ON_BOOT=none`.
Nothing on the request path owns DDL, which is the cleanest available answer to
"exactly one process provisions the schema" — it stops being a rule anyone has to
remember.

`mode: ensure` creates what is missing. `mode: push` also applies collection
schema changes and **is destructive**; it is not the default.

## What the chart refuses to render

Each of these is a configuration that produces no error at runtime — the
deployment comes up and something quietly stops being true. `helm install` fails
instead, naming the value to change:

- more than one HTTP process with `sharedState.rateLimitStore=memory`
- `functions.enabled` or `worker.enabled` while `split=false`
- two static apps claiming one path, or one claiming a path under `/api`
- `bundle.mode=image` while `image.repository` is still the stock runtime image
- `ingress.enabled` with no host, or `bundle.mode=url` with no URL
- an unrecognised `migrationJob.mode` or `sharedState.rateLimitStore`

## What the chart cannot do for you

**Realtime broadcast and presence across replicas.** The runtime's default
channel bus is in-memory, so with more than one API replica a subscriber on one
pod will not see a broadcast published on another. The fix lives in your
project's config, not in the chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Set `sharedState.channelBusConfigured: true` to assert that you have — the chart
uses it only to decide whether to warn. Ordinary collection subscriptions are
unaffected; those travel through Postgres CDC.
