# Rebase on Kubernetes

The Kubernetes peer of [`infra/docker/docker-compose.selfhost.yml`](../../docker/docker-compose.selfhost.yml).
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
| `url` | Stock image; the runtime downloads a tarball at every pod start. **Needs a runtime above 0.16.0** — the chart refuses older ones, which cannot fetch. | A control plane that ships bundles out of band |

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
serves no HTTP while `/livez` and `/health` both still answer — they answer on
every role — so startup, liveness and readiness all pass, the rollout reports
success, and every request 404s. A missing `REBASE_MIGRATE_ON_BOOT` is a crash
loop whose reason is in a log nobody is watching.

The chart knows all of them from the values it was given, so it writes them, and
setting one through `config.env` is **refused** at render rather than ignored.
Ignoring would have been the quieter bug: unsplit, the chart writes no
`REBASE_ROLE` of its own, so an operator's would have been the only one and would
have taken effect.

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

## Sizing, and the one thing that differs per cluster

Every unit takes its own `resources`, which is the self-hosted half of what Rebase
Cloud calls resource dials — the same two numbers, chosen in a values file rather
than on a project row:

```yaml
api:
  replicas: 2
  resources:
    requests: { cpu: 500m, memory: 1Gi }
    limits:   { cpu: "2",  memory: 2Gi }
```

Requests are what the cluster reserves; limits are the ceiling a pod may burst
to. Keeping the limit above the request is deliberate and worth preserving if you
change these: a Rebase backend idles at single-digit millicores and spikes on
request, so a generous limit costs nothing at rest on most clusters and is what
absorbs a traffic spike.

**The floor and the ratio band are your cluster's, not this chart's.** The
defaults above are sized for an ordinary Kubernetes cluster — nodes you rent
whole, where a 100m request reserves 100m. Two substrates disagree, and both do
so silently:

| Cluster | Per-pod floor | memory:CPU band | What happens outside it |
|---|---|---|---|
| Ordinary nodes (k3s, EKS, kubeadm, Hetzner) | none | none | the request is honoured as written |
| **GKE Autopilot** | 250m / 512Mi | 1:1 – 6.5:1 GiB per vCPU | the request is **rewritten**, and billed at the floor |

So on Autopilot this chart's default `cpu: 100m` is charged as 250m whatever it
says, and a pod asking 250m with 4Gi is quietly given something other than
4Gi — a pod that is not what the manifest describes. If you deploy to Autopilot,
raise the requests to at least the floor and keep memory within 6.5 GiB per vCPU.
Nothing here enforces that, because encoding one cloud's rules would make the
chart wrong on the three that do not have them.

## The database is not sized here

`databaseInstances` has no equivalent in this chart, and that is the same
deliberate omission as everything else about the database: this chart deploys the
runtime and points it at a `config.databaseUrl`. How many PostgreSQL instances
stand behind that URL, and whether they fail over, belongs to whatever runs them
— CloudNativePG's `instances`, your managed provider's replica setting, or your
own StatefulSet.

The one thing worth carrying over from the hosted platform: **one instance means
no failover.** A single-instance database survives a restart and does not survive
its node. That is a legitimate choice for a staging deployment and a poor one for
production, and it is worth making on purpose rather than discovering.

## Schema

`migrationJob.enabled` (default) runs a `pre-install,pre-upgrade` Job that
provisions and exits, and every pod boots with `REBASE_MIGRATE_ON_BOOT=none`.
Nothing on the request path owns DDL — the cleanest available answer to "exactly
one process provisions the schema", because it stops being a rule anyone has to
remember.

`mode: ensure` creates what is missing, additively, and is the only mode the
runtime image accepts. `push` is refused at boot: applying collection schema
changes is destructive, and `rebase db push` from a checkout or CI dry-runs the
change, refuses destructive ones without confirmation, and can take a backup
first — none of which a pod starting unattended can do.

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
fire.

`rebasepro/server` **is** published now, which makes the older caveat here
misleading rather than merely stale: it said url mode could not be exercised
because the image was unavailable, and a reader took that as the only obstacle.
The real one was that no released runtime could fetch a bundle from a URL, and
this chart never had an init container to fetch one for it — so `bundle.mode=url`
rendered happily and every pod exited with `No bundle found at /bundle.`. The
chart refuses that combination now, naming the value to change. Use
`bundle.mode=image` on 0.16.0 and below.
