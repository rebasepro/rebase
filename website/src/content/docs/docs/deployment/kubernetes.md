---
title: Kubernetes
sidebar_label: Kubernetes
description: Deploy Rebase to a Kubernetes cluster with the official Helm chart — one Deployment or several, a migration Job that owns the schema, and static apps on the same host.
---

## Overview

<span class="since-badge" data-since="0.18">Since 0.18</span>

The official chart is the Kubernetes peer of the Docker Compose self-hosting
setup. Same idea, same image, same bundle: **the runtime is the image, your
project is the bundle, and upgrading Rebase is a tag change.**

It is published as an OCI artifact beside the runtime image, and the two carry
the same version — the chart that deploys runtime `0.17.3` *is* chart `0.17.3`,
so there is one number to track. Without `--version` you get the newest; pin it
for a real deployment, the same way you would pin `image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

The chart ships with self-registration off, so a release has to name the account
its operator signs in with — otherwise it comes up with an empty user table and
no way to produce the first authenticated caller. `config.adminPassword` must be
at least 12 characters, and `config.adminEmail` needs a dot in its domain: the
login route parses its body with `z.string().email()`, so `admin@localhost`
seeds an account and then refuses every sign-in. Both are refusals rather than
runtime surprises — see [what the chart refuses to
render](#what-the-chart-refuses-to-render). Sign in and change the password;
these values land in a Secret.

Manage them out of band instead by pointing `existingSecret` at a Secret
carrying `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` alongside
`DATABASE_URL` and the rest.

The chart deploys the **runtime only**. It does not deploy Postgres — use
CloudNativePG, a managed database, or your own StatefulSet, and point
`config.databaseUrl` at it. A chart that also owned your database would own your
backups and your failover, which is a much larger promise than "run the app".

> **Maturity.** Two separate things are checked in CI, and a third is not.
> The chart is linted and rendered against Helm v4.2.4 — every documented
> topology on this page, including the install command above, and a case
> reaching every refusal listed below. The runtime image the chart deploys is
> built and booted against a real Postgres, both ways a bundle can arrive. What
> has **never run is the chart against a live cluster**: nothing has scheduled
> these manifests, so the probes, the pre-install migration Job's ordering and
> the ingress are correct as YAML and unproven as a deployment. Treat it as a
> well-tested starting point rather than a production-proven default, and read
> [Self-Hosting](/docs/deployment/self-hosting) for the path that is.

To work from a checkout instead — a modified chart, or an air-gapped install —
`helm install rebase ./charts/rebase` takes the same values.

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

`mode: ensure` creates what is missing, additively, and is the only mode the
runtime image accepts. `push` is refused at boot: applying collection schema
changes is destructive, and `rebase db push` from a checkout or CI dry-runs the
change, refuses destructive ones without confirmation, and can take a backup
first — none of which a pod starting unattended can do.

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
- no `config.adminEmail` with self-registration off — a release nobody can sign
  in to. Set the two admin values, or `config.allowSelfRegistration=true`
  understanding that the first person to reach the sign-up form becomes its
  administrator
- a `config.adminPassword` under 12 characters, or a `config.adminEmail` whose
  domain has no dot. Both seed nothing and leave the same locked-out release,
  one at boot and one at the sign-in form

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
