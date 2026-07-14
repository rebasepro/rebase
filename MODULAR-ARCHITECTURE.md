# Modular architecture — adoption modes

Rebase is built so you can adopt only the parts you want. There are three supported
modes, and they are not separate products: they are the same packages, wired
differently.

| Mode | You get | Comparable to |
| --- | --- | --- |
| **BaaS** | REST + auth + storage + realtime + backups over your database. No config files, no UI. | Supabase |
| **CMS** | BaaS + a schema-driven admin UI built from your collection definitions. | Payload, Directus |
| **Full** | CMS + Studio (SQL editor, schema visualizer, RLS editor, logs, API explorer). | Supabase + Payload |

The architecture already enforces this: **no server package imports a UI package**,
`@rebasepro/client` is isomorphic with zero UI dependencies, and every backend
subsystem is independently gated by config.

---

## 1. BaaS mode — no collections at all

This is the important property: **BaaS mode requires zero collection definitions.**
You point Rebase at a database and it serves an API.

```ts
initializeRebaseBackend({
    app,
    server,
    mode: "baas",
    database: createPostgresAdapter({ connection: db, connectionString })
});
```

Collections are **introspected from the database at boot** rather than imported from
config files. Every table becomes a REST resource, with types, primary keys, and
relations derived from `information_schema`. The drizzle tables the query layer needs
are built in memory from the same metadata, so no generated `schema.generated.ts` is
required either. Join tables are skipped — they are an edge between two collections,
not a collection. Nothing about the admin UI is loaded, imported, or installed.

Change the schema with a migration and the API follows; there is nothing to keep in
sync. Set `introspectionSchema` on the adapter to read a schema other than `public`.

What BaaS mode keeps, deliberately, because it is the control plane and not the CMS:

- REST data API (`/api/data/*`) over introspected tables
- Auth, including admin user routes and API keys
- Storage, realtime/CDC, backups, cron, functions
- OpenAPI/Swagger

What it drops:

- Collection config files and the `collectionsDir` scan
- The schema-editor routes (which exist to write config files back to disk)
- The admin SPA (`serveSPA` is never called)
- Every React package

Install: `@rebasepro/server-core` + a driver (`@rebasepro/server-postgresql`) +
`@rebasepro/client` for the SDK. No `react` in the dependency tree.

## 2. CMS mode — collections drive the UI

Add collection definitions and the admin packages. The collection file is a single
unified object that describes both the backend schema (validation, callbacks,
security rules) and the presentation (icons, views, field components) — one file,
like Payload.

The same files are consumed twice:

- **backend**, at runtime, via `loadCollectionsFromDirectory` (`collectionsDir`)
- **frontend**, at build time, via `virtual:rebase-collections`
  (`rebaseCollectionsPlugin` from `@rebasepro/core/vitePlugin`)

Install: the BaaS set plus `@rebasepro/core`, `@rebasepro/admin`, `@rebasepro/ui`,
`@rebasepro/auth`, `@rebasepro/formex`.

### The collection-file import rule

Because the Node backend imports these files, **collection files must never import a
UI package.** They may import:

- `@rebasepro/common` (`defineCollection`)
- `@rebasepro/types`
- local, non-UI helpers

Custom React components are referenced **by string path** (`Field: "./MyField"`), not
by import. The Vite plugin rewrites those strings into lazy dynamic imports for the
browser, so the backend never evaluates React. Anything the admin UI needs to inject
into a collection (for example the reset-password entity action on auth collections)
is injected **frontend-side** by `@rebasepro/admin`, not imported into config.

This rule is enforced in CI by `pnpm run check:headless`, which imports every
collection file and every server package under a Node loader hook that throws if the
module graph reaches `react`, `react-dom`, or any `@rebasepro/{admin,ui,core,studio,formex}`.

## 3. Full mode — Studio

Studio is the **BaaS console**: SQL editor, schema visualizer, RLS editor, storage
browser, logs, API explorer, API keys, backups, cron. Its views target the BaaS
control plane, not the CMS — it talks to the backend over HTTP through
`@rebasepro/client` and works with an empty collection registry. `@rebasepro/admin` is
an *optional* peer dependency of `@rebasepro/studio`; when collections are present
Studio enriches its views with them, and when they are absent it degrades to pure
database views.

That means Studio can ship on top of BaaS mode with no CMS at all.

---

## Package map

```
Shared kernel   types → utils → common → client        (isomorphic, no UI, no node)

BaaS            server-core → client, common, types, utils
                server-postgresql / server-mongodb → server-core
                cli, sdk-generator, schema-inference

CMS             ui, formex (leaves)
                core → common, formex, types, ui, utils
                admin → core, common, formex, schema-inference, types, ui, utils
                auth → types (React binding over client.auth)

Full            studio → client, common, core, types, ui, utils
                        (admin: optional peer)
                plugin-insights, plugin-data-enhancement
```

`serveSPA` (`packages/server-core/src/serve-spa.ts`) is the only place the backend
touches the admin bundle, and it is called from the *application* entry point, never
from the framework. BaaS deployments simply never call it.

---

## Scaffolding

```bash
rebase init my-app --flavor baas   # backend only, introspected: no config/, no frontend/
rebase init my-app --flavor cms    # config/ + backend/ + frontend/ (default)
```

Without `--flavor`, `rebase init` asks. `dev`, `build`, and `start` detect a missing
`frontend/` and run backend-only.

---

## What enforces this

- `pnpm run check:headless` — imports every collection file and every server package
  under a Node loader hook that throws on `react`, `react-dom`, or any
  `@rebasepro/{admin,ui,core,studio,formex}`. Runs in CI before the build, reads
  source directly, needs no build step. Add new server packages to
  `SERVER_PACKAGES` in `scripts/headless-guard/check.mjs`.
- Imports that TypeScript elides because they are unused do not trip the guard, which
  matches runtime: backends run this same TS through tsx.
