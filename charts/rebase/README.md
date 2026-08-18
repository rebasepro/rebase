# Rebase on Kubernetes

The Kubernetes peer of [`docker/docker-compose.selfhost.yml`](../../docker/docker-compose.selfhost.yml).
Same idea, same image, same bundle: the runtime is the image, your project is the
bundle, and upgrading Rebase is a tag change.

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

This chart deploys the **runtime**. It does not deploy Postgres — use
CloudNativePG, a managed database, or your own StatefulSet, and point
`config.databaseUrl` at it. A chart that also owned your database would own your
backups and your failover, which is a much larger promise than "run the app".

## Getting your project into the pod

| `bundle.mode` | How | When |
|---|---|---|
| `image` (default) | You build `FROM rebasepro/server` with `COPY dist-bundle /bundle` and set `image.repository` | Almost always. One artifact, immutable, no runtime dependency on a URL staying up |
| `url` | Stock image; the runtime downloads a tarball at every pod start | A control plane that ships bundles out of band |

## One process, or several

The default is one Deployment serving everything — the same shape the compose
file runs. Splitting is one value:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

That gives you an `api`, a `functions` tier and a `worker`, all from the same
image and the same bundle. The chart then derives what a human would otherwise
have to remember:

- `REBASE_ROLE` per unit
- `REBASE_MIGRATE_ON_BOOT=none` everywhere, because the migration Job owns the schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` on the api once a worker exists
- `TRUSTED_PROXY_HOPS` on the functions unit
- `REBASE_RATE_LIMIT_STORE=sql` as soon as a second process serves HTTP

Those are the settings whose failure mode is silence. A wrong `REBASE_ROLE`
serves no HTTP while `/health` still answers, so readiness passes and every
request 404s; a missing `REBASE_MIGRATE_ON_BOOT` is a crash loop whose reason is
in a log nobody is watching. The chart knows all of them from the values it was
given, so it writes them, and `config.env` cannot override them.

### Splitting cron from job execution

Two workers with opposite ownership. No new role, and no code:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## The admin panel, and any other front end

A static app is the same runtime image booting a `kind: static` bundle. That
path short-circuits before the runtime reads `DATABASE_URL` or `JWT_SECRET`, so
these pods carry **no secrets at all**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

The ingress routes `/admin` to it and `/` to the API — **same host**. That is
deliberate: same origin means cookie auth and CORS are exactly what they were,
and the split stays an internal topology decision rather than a change to your
product's public surface. The price is that the assets must be *built* for that
path, which the runtime checks.

`rebase deploy` for the admin is then an image tag bump on one Deployment. The
backend does not restart.

## Schema

`migrationJob.enabled` (default) runs a `pre-install,pre-upgrade` Job that
provisions and exits, and every pod boots with `REBASE_MIGRATE_ON_BOOT=none`.
Nothing on the request path owns DDL — the cleanest available answer to "exactly
one process provisions the schema", because it stops being a rule anyone has to
remember.

`mode: ensure` creates what is missing. `mode: push` also applies collection
schema changes and is destructive; it is not the default.

## What the chart refuses to render

Every one of these is a configuration that produces no error at runtime — the
deployment comes up and something quietly stops being true. `helm install` fails
with the value to change:

- more than one HTTP process with `sharedState.rateLimitStore=memory`
- `functions.enabled` / `worker.enabled` while `split=false`
- two static apps claiming one path, or one claiming a path under `/api`
- `bundle.mode=image` while `image.repository` is still the stock runtime image
- `ingress.enabled` with no host; `bundle.mode=url` with no URL
- an unrecognised `migrationJob.mode` or `sharedState.rateLimitStore`

## What the chart cannot do for you

**Realtime broadcast and presence across replicas.** The runtime's default
channel bus is in-memory. With more than one API replica, a subscriber on one
pod will not see a broadcast published on another. The fix lives in your
project's config, not here:

```ts
realtime: { bus: { type: "postgres" } }
```

Set `sharedState.channelBusConfigured: true` to assert you have — the chart uses
it only to decide whether to warn. Ordinary collection subscriptions are
unaffected; those go through Postgres CDC.

## Status

Rendered and linted against Helm v4, and every refusal above is verified to
fire. **It has not yet been applied to a live cluster** — in particular the
`rebasepro/server` image it references is not published to a public registry at
the time of writing, so `bundle.mode=url` cannot be exercised end to end.
