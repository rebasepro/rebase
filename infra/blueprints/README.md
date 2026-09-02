# One-click deploy configurations

Platform blueprints for a Rebase project. Each one deploys a project built with
`rebase build` and started with `rebase start` — the same bundle, the same
runtime, four different hosts.

These live here rather than in the scaffolded project because a config file only
works at a repository root, and most people want exactly one of them. Copy the
one you need into your project root, or use them as the source for a public
starter repository that the platform galleries link to.

```
render.yaml       →  repo root         (Render blueprint)
railway.json      →  repo root         (Railway)
fly.toml          →  repo root         (Fly.io)
do-app.yaml       →  .do/app.yaml      (DigitalOcean App Platform)
```

Coolify, Dokku and anything else that speaks Compose can use
`infra/docker/docker-compose.selfhost.yml` directly — see `infra/docker/quickstart.sh`.

Hetzner Cloud has a Terraform module rather than a blueprint, because the thing
worth declaring there is infrastructure the platform would otherwise own for you
— a firewall, a stable address, and a volume that outlives the server. See
`infra/terraform-hcloud-rebase/`.

## What every one of them has to get right

The same five things, in every platform's own dialect. Each is a real boot
failure or an open door, not a preference.

**`DATABASE_URL` needs `pgvector` if you declare a vector property.** A
`{ type: "vector" }` column compiles to `VECTOR(n)`, and a stock Postgres
answers `type "vector" does not exist`. Managed Postgres on Render, Railway, Fly
and DigitalOcean all ship the extension; you still have to `CREATE EXTENSION`
it, which Rebase does at boot when the extension is available.

**`JWT_SECRET` and `REBASE_SERVICE_KEY` must be generated, never defaulted.**
Every file below marks them as platform-generated secrets. A blueprint that
ships a literal value is a blueprint that puts that value in production.

**`CORS_ORIGINS` must name the deployment's own public URL.** The backend
refuses to boot in production without an allowed origin — deliberately, because
the alternative is a permissive default nobody revisits. Each file wires the
platform's own URL variable in where one exists.

**The first account must be named, not raced for.** A fresh Rebase database has
no users, and the registration policy admits the first registration and promotes
it to admin — otherwise an empty database is a dead end, because bootstrapping
an admin needs a caller who is already signed in. Every platform here publishes
the deployment's URL the moment it is live, so on these that rule is a window
between "the app is reachable" and "the operator has signed up", and whoever
arrives first owns it. So each file sets `DISABLE_SELF_REGISTRATION=true` and
names `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD` (min 12 characters); the
runtime creates that account once, while the user table is still empty, and
does nothing on every deploy after that. To run an open sign-up instead, clear
all three — knowing what the first visitor gets.

**Storage hard-fails in production if it is left local.** The container
filesystem is destroyed on every restart, so a `local` storage backend in
production is silent data loss; the runtime refuses rather than pretending. Set
S3-compatible storage, or set `FORCE_LOCAL_STORAGE=true` if the project stores
no uploads at all. Both options are in each file, commented.

## The schema

The runtime provisions collection tables and their RLS at boot, additively — so
a first deploy against an empty database comes up serving them. What boot does
not do is anything destructive: it never alters a column type, drops a column or
edits an existing enum label. Those go through `rebase db push` from a checkout
or CI, where the destructive-change gate and a backup are in reach.
