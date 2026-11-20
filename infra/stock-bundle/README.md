# The stock bundle

What a new Rebase Cloud project runs before anybody deploys code to it — the
reason a project created in the console (or provisioned for an agent with no
account) is a working backend at once, the way a new Firebase or Supabase
project is.

It is an ordinary Rebase project with no code of its own:

- **`backend/`** has no `schema/`, so the runtime introspects the project's
  database and serves every table with row-level security on. A table created
  in the console's SQL editor is an API, and an admin view, once it has RLS.
  `backend/storage.ts` is the headless scaffold's storage default, byte for byte
  (the build refuses to run when they differ): `public/…` readable by anyone,
  everything else only under the caller's own `users/<uid>/`.
- **`admin/`** is the admin panel with no customizations: every table comes
  from `GET /api/schema/tables`.

## Build

```bash
pnpm build:stock-bundle            # → infra/stock-bundle/out/
```

`tooling/scripts/build-stock-bundle.mts` runs the real `rebase build`, pins
`@rebasepro/server-postgres` at this checkout's version (the image supplies the
server, not the driver), vendors it, marks the manifest `stock`, checks the
result with the runtime's own manifest reader, and writes
`out/stock-bundle.tar.gz` plus `out/stock-bundle.json` (the manifest intake
reads). It also keeps `tooling/contracts/stock-bundle-manifest.json` — the
manifest with versions and dates held still — which the control plane's tests
drive through intake; `--write-contract` updates it after a deliberate change.

## Where it goes

- **CI** builds it on every change (`check:stock-bundle` in `ci:build-gates`).
- **The control-plane image** builds it from the same commit
  (`saas/Dockerfile`) and deploys it onto every new project through the normal
  managed deploy path (`saas/backend/src/managed/stock-bundle.ts`,
  `deployStockBundle` in `saas/backend/functions/deploy.ts`): when a console
  project's payment clears, and when an unclaimed project is provisioned.

A project leaves it by deploying: the first `rebase cloud deploy --bundle` from
a real project replaces it like any deploy replaces the one before. To start
that project from what is live, `rebase schema introspect` turns the live
tables into `backend/schema`.
