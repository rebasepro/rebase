# Modular architecture — adoption modes

Rebase is built so you can adopt only the parts you want. There are three supported
modes, and they are not separate products: they are the same packages, wired
differently.

| Mode | You get | Comparable to |
| --- | --- | --- |
| **BaaS** | REST + auth + storage + realtime + backups over your database. No config files, no UI. | Supabase |
| **CMS** | BaaS + a schema-driven admin UI built from your collection definitions. | Payload, Directus |
| **Full** | CMS + Studio (SQL editor, schema visualizer, RLS editor, logs, API explorer). | Supabase + Payload |

The architecture enforces this at two levels. **No server package imports a UI
package** at runtime, and — since the 0.11 split — **no core package names React even
in a type position**. `@rebasepro/types` is the BaaS contract;
`@rebasepro/admin-types` holds the React layer and depends on it, never the reverse.
`@rebasepro/client` is isomorphic with zero UI dependencies, and every backend
subsystem is independently gated by config.

That second level was missing for a long time and the gap was invisible: every React
import in `@rebasepro/types` is erased at build, so the runtime guard passed while 13
shipped `.d.ts` files began with `import React from "react"` and `@types/react` was a
devDependency only. A BaaS install had nothing to resolve them against. See
`PLAN-2026-07-25-BAAS-ADMIN-SPLIT.md`.

---

## 1. BaaS mode — no collections at all

This is the important property: **BaaS mode requires zero collection definitions.**
You point Rebase at a database and it serves an API.

```ts
initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({ connection: db, connectionString })
});
```

**There is no mode flag.** `mode: "cms" | "baas"` used to be authored here and was
deleted — on the manifest, on `RebaseBackendConfig`, on the wire contract, and as
`REBASE_DEV_MODE`. It was never independent of the collections: it could only agree
with them or contradict them, and when it contradicted, the server warned and threw
the declared collections away.

What decides it now is one question, asked **after** the collections directory is
loaded: did any collections resolve? None did, so the adapter is asked to describe
the schema (`introspectCollections`). A `collectionsDir` pointing at nothing falls
through to introspection instead of serving an empty API and never looking. The flip
side: declaring collections alongside what used to be `mode: "baas"` now *serves*
them.

Collections are **introspected from the database at boot** rather than imported from
config files. Every table becomes a REST resource, with types, primary keys, and
relations derived from `information_schema`. The drizzle tables the query layer needs
are built in memory from the same metadata, so no generated `schema.generated.ts` is
required either. Join tables are skipped — they are an edge between two collections,
not a collection. Nothing about the admin UI is loaded, imported, or installed.

Change the schema with a migration and the API follows; there is nothing to keep in
sync. Set `introspectionSchema` on the adapter to read a schema other than `public`.

### Which tables get served

**Only the ones the database protects.** Every authenticated request runs as the
`rebase_user` role, which is granted `SELECT/INSERT/UPDATE/DELETE` on the schema so
that RLS — not the grant — decides who sees what. A table with RLS *disabled* has no
authorization model at all, so serving it would hand every row to every logged-in
user. BaaS never runs `db push`, so nothing here enables RLS on your behalf.

So a table is served only when it has `ENABLE ROW LEVEL SECURITY`. Anything else is
skipped, and named at boot with the SQL to protect it:

```sql
ALTER TABLE "public"."secrets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY secrets_owner ON secrets FOR ALL TO public USING (owner_id = rebase.uid());
```

Two escape hatches, both explicit:

- `baas: { unprotectedTables: "serve" }` — serve them anyway. Only sensible when every
  caller is already trusted; it logs loudly at boot.
- A table with RLS enabled but **no policies** is served and returns nothing. That is
  legal Postgres and indistinguishable from an empty table, so it is called out at
  boot rather than left to look like missing data.

Internal tables are never introspected: the `rebase` and `auth` schemas sit outside
`introspectionSchema` (default `public`), and `rebase_*` / `drizzle_*` names are
filtered out.

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

Install: `@rebasepro/server` + a driver (`@rebasepro/server-postgres`) +
`@rebasepro/client` for the SDK. No `react` in the dependency tree.

The SDK needs no collections either — there is nothing to generate or declare:

```ts
const rebase = createRebaseClient({ baseUrl, token });
await rebase.data.collection("posts").find({ limit: 5 });   // just a table name
await rebase.data.collection("authors").create({ name: "Ada" });
```

Typed accessors (`rebase.data.posts`) work the same way; the optional `collections`
map only exists to pin non-obvious slugs. `rebase generate-sdk` adds types if you
want them, but nothing requires it.

## 2. CMS mode — collections drive the UI

Add collection definitions and the admin packages. The collection file is a single
unified object that describes both the backend schema (validation, callbacks,
security rules) and the presentation (icons, views, field components) — one file,
like Payload.

The same files are consumed twice:

- **backend**, at runtime, via `loadCollectionsFromDirectory` (`collectionsDir`)
- **frontend**, at build time, via `virtual:rebase-collections`
  (`rebaseCollectionsPlugin` from `@rebasepro/app/vitePlugin`)

Install: the BaaS set plus `@rebasepro/app`, `@rebasepro/admin`, `@rebasepro/ui`,
`@rebasepro/forms`.

### One definition of "the collections"

The runtime, the drizzle-schema generator, the policy generator and the doctor all
load collections through the **same** loader (`loadCollectionsFromDirectory`, exported
from `@rebasepro/server`). Four copies of that scan used to exist, agreeing only by
discipline — and a drift between them would serve one set of collections while pushing
policies for another, which reads as an empty table rather than an error. A file that
fails to import is now a hard error for the same reason: skipping it silently produces
a missing route and a missing policy with a successful exit code.

### Where security rules live, and what enforces them

**Collections do not enforce anything at runtime.** Nothing on the data path reads
`securityRules`. Authorization is entirely Postgres RLS:

```
collection files → generatePostgresPoliciesDdl → drizzle/policies.sql → db push → pg_policies
                                                                                       ↓
                                           every request: SET LOCAL ROLE rebase_user → RLS decides
```

`securityRules` are a **source for code generation**, not a runtime check. That is why
`policies.sql` is committed, why fixing a config cannot fix a database that already has
the old policy, and why `rebase doctor --policies` exists.

Directory-level defaults live with the collections, in `config/collections/index.ts`:

```ts
export const defaultSecurityRules: SecurityRule[] = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
```

Any collection in that directory declaring no `securityRules` inherits them; one
declaring its own keeps them; one with neither is **locked by default** (admin-only).
They belong here, not on `RebaseBackendConfig`, because `db push` generates the
policies from these files and never sees the running server — a default on the server
could never reach the database, while reading exactly like an authorization setting.

### The collection-file import rule

Because the Node backend imports these files, **collection files must never import a
UI package.** They may import:

- `@rebasepro/types` — the contract, and `AdminCollectionConfig` **as a type only**
- `@rebasepro/common` (`defineCollection`)
- local, non-UI helpers

Custom components are referenced with a **lazy import thunk**, which TypeScript checks
and the backend never evaluates:

```ts
admin: { Field: () => import("../../frontend/src/BodyPartsField") }
```

A wrong path is a compile error, go-to-definition works, and editors follow the
specifier on a file move. The bare-string form (`Field: "../../frontend/src/X"`) still
works and is what the visual collection editor writes, since ts-morph can emit a string
literal but not a thunk — prefer the thunk when authoring by hand.

`@rebasepro/types` declares **no `admin` field** — not on a collection, not on a
property. In a BaaS project, writing one is a type error. `@rebasepro/admin-types` adds
it back by declaration merging, so installing that package is what makes the admin
surface exist:

```ts
// config/admin.d.ts — one line, once per project
/// <reference types="@rebasepro/admin-types" />
```

```ts
// config/collections/posts.ts — plain core types, `admin` now typed
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText", listProperties: ["title"] }
};
```

An augmentation applies to the whole *program*, and `config/` and `frontend/` are
separate tsconfig programs — which is why the reference lives in the config package
rather than being inherited from the frontend. There is deliberately no
`AdminCollectionConfig` wrapper: with the field merged in, `CollectionConfig` *is* the
authoring type.

This works only because `BaseProperty`, the ten concrete property types and
`BaseCollectionConfig` are `interface`s. Interfaces merge; `type` aliases do not.

Custom React components are referenced **by string path** (`Field: "./MyField"`), not
by import. The Vite plugin rewrites those strings into lazy dynamic imports for the
browser, so the backend never evaluates React. Anything the admin UI needs to inject
into a collection (for example the reset-password entity action on auth collections)
is injected **frontend-side** by `@rebasepro/admin`, not imported into config.

This rule is enforced in CI by `pnpm run check:headless`, which imports every
collection file and every server package under a Node loader hook that throws if the
module graph reaches `react`, `react-dom`, or any `@rebasepro/{admin,ui,app,studio,forms}`.

## 3. Full mode — Studio

Studio is the **BaaS console**: SQL editor, schema visualizer, RLS editor, storage
browser, logs, API explorer, API keys, backups, cron. Its views target the BaaS
control plane, not the CMS — it talks to the backend over HTTP through
`@rebasepro/client`, and `@rebasepro/admin` is an *optional* peer dependency it never
imports.

Where Studio wants CMS capabilities (jumping from a SQL result to an entity, say) it
asks for them through the **Studio bridge** (`useStudioBridge` in `@rebasepro/app`),
whose context defaults to `NOOP_BRIDGE`. With a CMS present the app provides the real
controllers and the views light up; without one they no-op and Studio stays a pure
database console.

That means Studio can ship on top of BaaS mode with no CMS at all.

---

## Package map

```
Shared kernel   types → utils → common → client        (isomorphic, no UI, no node)
                                                      (and no React, in any position)

BaaS            server → client, common, types, utils
                server-postgres / server-mongo → server
                cli → client, codegen, server, server-postgres, types
                codegen → client, common, types
                mcp → client
                inference (leaf)

CMS             ui, forms (leaves)
                admin-types → types                   (the React half of the types)
                client-postgres → client, types       (a React hook: a frontend driver)
                app → admin-types, common, forms, types, ui, utils
                admin → admin-types, app, common, forms, inference, types, ui, utils
                firebase → admin, admin-types, app, common, types, ui, utils

Full            studio → client, common, app, types, ui, utils
                        (admin: optional peer)
                plugin-insights, plugin-ai
```

Names describe **role**, not position or framework. `server` pairs with `client`;
`app` is the runtime that `admin`, `studio` and the plugins register into. React is a
peer dependency of the frontend tier, not an identity — `admin`, `admin` and `studio` are
every bit as React as `app`, so none of them carry it in the name.

`firebase` sits in the CMS tier rather than beside `client`, which is where its old
name (`client-firebase`) filed it: it depends on `admin`, `app` and `admin`, so it is a
UI integration, not a client SDK. `client-postgres` is the one that really is an
adapter over `client`.

The React auth controller (`useRebaseAuthController`) lives in `app`, beside the
`RebaseAuth` and `LoginView` components it is used with. It was once its own
`@rebasepro/auth` package, which turned out to be one hook whose only dependency was
`types`. The auth *system* is in `client` (`client.auth`) and `server`.

`serveSPA` (`packages/server/src/serve-spa.ts`) is the only place the backend
touches the admin bundle, and it is called from the *application* entry point, never
from the framework. BaaS deployments simply never call it.

---

## Scaffolding

```bash
rebase init my-app --headless      # backend alone, collections introspected
rebase init my-app                 # backend + admin: config/ + backend/ + frontend/ (default)
```

Without `--headless`, `rebase init` asks. `dev`, `build`, and `start` detect a missing
`frontend/` and run backend-only.

---

## What enforces this

- `pnpm run check:types-headless` — the type-level counterpart, and the one that was
  missing. Scans the text of every core package's sources **and built `.d.ts`**, plus
  their manifests, for any mention of React or an admin package. Catches
  `import type React`, which a `/^import React/` scan misses, and a stray
  `@types/react` devDependency, which is what let the leak sit unnoticed.
- `pnpm run check:baas-types` (`e2e/baas-typecheck/`) — typechecks a real BaaS project
  (backend, a collection file with schema/validation/relations/RLS/callbacks, SDK reads
  and writes) with `react` mapped onto a stub that stands in for its absence. Catches a
  React type reached through an alias, which a text scan cannot see. The two are
  complementary: the scan cannot see through an alias, the fixture cannot see an unused
  import.
- `pnpm run check:templates` — compiles the scaffolded collection files once per
  preset (`blog`, `ecommerce`, `blank`), laid out the way `applyPreset` lays them out.
  Nothing else checked them fast: the only thing that compiled a template was the CMS
  init e2e, inside a Docker build about fifteen minutes in. These are the first files
  every new project runs, so they should fail in seconds.
- `pnpm run check:headless` — imports every collection file and every server package
  under a Node loader hook that throws on `react`, `react-dom`, or any
  `@rebasepro/{admin,ui,app,studio,forms}`. Runs in CI before the build, reads
  source directly, needs no build step. Add new server packages to
  `SERVER_PACKAGES` in `tooling/scripts/headless-guard/check.mjs`.
  Imports that TypeScript elides because they are unused do not trip it, which
  matches runtime: backends run this same TS through tsx.
- `e2e/tests/cli-init-baas-e2e.ts` — scaffolds `--headless`, installs it from real
  tarballs, creates tables the project was never told about, and checks the API serves
  them. This is the only place a scaffolded project is installed and booted
  (`workspace:*` deps resolve nowhere else), so it's what proves the template rather
  than the library behind it. It also asserts no `react` in the install tree — the
  guard above can't see templates.
- `packages/server/test/init-mode.test.ts` — the derivation contract: which
  collections register given what resolved, and that the schema editor follows that
  and `NODE_ENV`.
- A driver that cannot introspect fails at boot rather than serving
  nothing: reporting no collections means it never looked, so `init` throws and names
  it. An empty database is different — that warns and boots.
- `rebase doctor --policies` diffs `pg_policies` against the policies your collections generate,
  and exits non-zero on drift. **RLS fails silently by design**: a policy that never
  matches filters every row, and an empty table is indistinguishable from a table with
  no data. Policies live in Postgres and the config is only their source, so a stale
  policy from an old push outlives any config fix — which is exactly how the demo
  served empty collections for months. Run it in CI against a deployed database.
