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

The same five things, in every platform's own dialect. Each is a real failure,
not a preference.

**`DATABASE_URL` needs `pgvector` if you declare a vector property.** A
`{ type: "vector" }` column compiles to `VECTOR(n)`, and a stock Postgres
answers `type "vector" does not exist`. Managed Postgres on Render, Railway, Fly
and DigitalOcean all ship the extension; you still have to `CREATE EXTENSION`
it, which Rebase does at boot when the extension is available.

**`JWT_SECRET` and `REBASE_SERVICE_KEY` must be generated, never defaulted.**
A blueprint that ships a working literal value is a blueprint that puts that
value in production. Only Render can generate them: `render.yaml` marks both
`generateValue`. `fly.toml` sets them with `fly secrets set` in its header.
`do-app.yaml` carries `CHANGE_ME_…` placeholders, because App Platform has no
generator: replace them with `openssl rand -hex 32` before the first deploy
(unedited, they are under 32 characters and the runtime refuses to boot).
`railway.json` declares no environment at all, so on Railway every variable in
this section is set in the dashboard.

**`CORS_ORIGINS` must name the deployment's own public URL.** The backend
refuses to boot in production without an allowed origin — deliberately, because
the alternative is a permissive default nobody revisits. `render.yaml` and
`do-app.yaml` wire in the platform's own URL variable; `fly.toml` sets it with
`fly secrets set` in its header.

**The first admin must be named before the first deploy.** `fly.toml`,
`render.yaml` and `do-app.yaml` set `NODE_ENV=production` (on Railway, set it
yourself), and in production the first account to register is **not** promoted
to admin: every platform here publishes the deployment's URL the moment it is
live, so a first-come-first-admin rule would hand the deployment to whoever
arrived first. The way in is `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD` (an
address the login route accepts, and at least 12 characters): the runtime
creates that admin once, at boot, while the user table is still empty, and does
nothing on every deploy after that. Leave them unset and the deployment comes up
with no administrator until you set them and redeploy, or assign the role with
the service key. `render.yaml` and `do-app.yaml` declare both, `fly.toml` sets
them with `fly secrets set` in its header, and all three also set
`DISABLE_SELF_REGISTRATION=true`. Clearing that does not give the first visitor
the deployment — sign-up opens only with `ALLOW_REGISTRATION=true`, and an
account made that way is an ordinary one. See
[Your first admin](https://rebase.pro/docs/getting-started/deployment/#your-first-admin).

**Local storage is switched off in production.** The container filesystem is
destroyed on every restart, so a `local` storage backend in production would be
silent data loss; the runtime does not register one, and every upload answers
501 `STORAGE_NOT_CONFIGURED` while the rest of the app keeps serving. Set
S3-compatible storage to accept uploads. `FORCE_LOCAL_STORAGE=true` turns local
storage back on, which only keeps files on a durable volume at the storage path.
`render.yaml` carries the S3 variables and `FORCE_LOCAL_STORAGE`, commented;
`fly.toml` carries `FORCE_LOCAL_STORAGE`, commented, and leaves S3 to secrets;
`do-app.yaml` carries only a commented `STORAGE_TYPE: s3`.

## The schema

The runtime provisions collection tables and their RLS at boot, additively — so
a first deploy against an empty database comes up serving them. What boot does
not do is anything destructive: it never alters a column type, drops a column or
edits an existing enum label. Those go through `rebase db push` from a checkout
or CI, where the destructive-change gate and a backup are in reach.
