# Modular architecture — adoption modes

Rebase is built so you can adopt only the parts you want. There are three supported
modes, and they are not separate products: they are the same packages, wired
differently.

| Mode | You get | Comparable to |
| --- | --- | --- |
| **BaaS** | REST + auth + storage + realtime + backups over your database — tables declared in `backend/schema`, or read from the database itself. No UI. | Supabase |
| **CMS** | BaaS + a schema-driven admin UI that renders every table the backend serves, customized in `frontend/src/cms`. | Payload, Directus |
| **Full** | CMS + Studio (SQL editor, schema visualizer, RLS editor, logs, API explorer). | Supabase + Payload |

The architecture enforces this at two levels. **No server package imports a UI
package** at runtime, and — since the 0.11 split — **no core package names React even
in a type position**. `@rebasepro/types` is the BaaS contract;
`@rebasepro/cms-types` holds the React layer and depends on it, never the reverse.
`@rebasepro/client` is isomorphic with zero UI dependencies, and every backend
subsystem is independently gated by config.

That second level was missing for a long time and the gap was invisible: every React
import in `@rebasepro/types` is erased at build, so the runtime guard passed while 13
shipped `.d.ts` files began with `import React from "react"` and `@types/react` was a
devDependency only. A BaaS install had nothing to resolve them against. The split
moved the React half into `@rebasepro/cms-types`, and `check:types-headless` (under
*What enforces this*) is the guard that now catches a React mention in a core
package.

---

## 1. BaaS mode — tables, declared or introspected

The backend serves tables. Where they come from is the one choice a BaaS
project makes, and neither choice involves the admin panel.

**Declared** (since 0.31): `backend/schema/index.ts` exports `defineTable`,
`defineAuthTable` and `defineView` results, and optionally `defaultRls`. Every
table states a row-level security posture — a list of rules, `"admin-only"`, or
`"inherit"` — and a table without one is a type error and a boot error. The
builders come from `@rebasepro/server/schema`, an entry that loads nothing of the
server.

```ts
initializeRebaseBackend({
    app,
    server,
    schemaDir: path.resolve(__dirname, "../schema"),   // or tables: [...], defaultRls
    database: createPostgresAdapter({ connection: db, connectionString })
});
```

At boot the definitions are compiled into `TableDescriptor`s — fail closed: one
`SchemaDefinitionError` names every problem. The descriptors are what REST,
realtime, MCP, OpenAPI and `GET /api/schema/tables` serve, what the schema version
hashes, and what `rebase generate-sdk` reads.

**Introspected**: no `backend/schema/index.ts`, and no `tables`. The adapter is
asked to describe the database (`introspectTables`), and every table it may serve
becomes a REST resource, with types, primary keys and relations derived from the
catalogue. The drizzle tables the query layer needs are built in memory from the
same metadata, so no generated `schema.generated.ts` is required either. Join
tables are skipped — they are an edge between two tables, not a resource.

**There is no mode flag.** `mode: "cms" | "baas"` used to be authored and was
deleted — it could only agree with what the backend loaded or contradict it. What
decides it now is whether any tables were declared. A `schemaDir` pointing at
nothing falls through to introspection instead of serving an empty API.

Change the schema with a migration and an introspected API follows; there is
nothing to keep in sync. Set `introspectionSchema` on the adapter to read a
schema other than `public`.

### Which introspected tables get served

**Only the ones the database protects.** Every authenticated request runs as the
`rebase_user` role, which is granted `SELECT/INSERT/UPDATE/DELETE` on the schema so
that RLS — not the grant — decides who sees what. A table with RLS *disabled* has no
authorization model at all, so serving it would hand every row to every logged-in
user. Introspection never runs `db push`, so nothing here enables RLS on your behalf.

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

A join table is not served either way. One with RLS off is named at boot and left
out of the schema relations are built from. `rebase_user` keeps its grants on it: a
policy that reads a join table runs as the caller, so taking them back would break
every read that policy guards.

The tables are read once, at boot. If RLS is disabled on a served table later, it
stays served until the next boot excludes it. The scheduled RLS audit reports it
sooner, and is off by default.

Internal tables are never introspected: the `rebase` and `auth` schemas sit outside
`introspectionSchema` (default `public`), and `rebase_*` / `drizzle_*` names are
filtered out.

What BaaS mode keeps, either way:

- REST data API (`/api/data/*`), realtime/CDC, `GET /api/schema/tables`
- Auth, including admin user routes and API keys
- Storage, backups, cron, functions
- OpenAPI/Swagger

What it never loads: the admin SPA (`serveSPA` is never called) and every React
package. The schema-editor routes exist only where there is a `backend/schema` to
write to.

Install: `@rebasepro/server` + a driver (`@rebasepro/server-postgres`) +
`@rebasepro/client` for the SDK. No `react` in the dependency tree.

The SDK needs nothing generated or declared:

```ts
const rebase = createRebaseClient({ baseUrl, token });
await rebase.data.table("posts").find({ limit: 5 });   // just a table name
await rebase.data.table("authors").create({ name: "Ada" });
```

Typed accessors (`rebase.data.posts`) work the same way; the optional `tables`
map only exists to pin non-obvious slugs. `rebase generate-sdk` adds types if you
want them, and a project that declares its tables can type data with no codegen at
all by registering `Register.tables`.

### Where security rules live, and what enforces them

**Tables do not enforce anything in Node.** Nothing on the data path evaluates
`rls` rules in memory. Authorization is entirely Postgres RLS:

```
backend/schema (rls) → compiled policies → policies.sql → db push / boot → pg_policies
                                                                              ↓
                                  every request: SET LOCAL ROLE rebase_user → RLS decides
```

`rls` is a **source for policy generation**, not a runtime check. That is why
fixing a definition cannot fix a database that already has the old policy until
boot or `db push` re-applies it, and why `rebase doctor --policies` exists.

The project default lives with the tables, in `backend/schema/index.ts`:

```ts
export const defaultRls: DefaultRls = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
```

Only a table that says `rls: "inherit"` takes it; `"inherit"` with no `defaultRls`
refuses the boot. It belongs beside the tables, not on `RebaseBackendConfig`,
because `db push` generates the policies from these files and never sees the
running server.

### The schema-file import rule

`backend/schema` is loaded by Node — boot, `db push`, `generate-sdk`, the doctor —
so **a table file never imports a UI package.** It imports
`@rebasepro/server/schema` (or `@rebasepro/types`), other table files and local
non-UI helpers. Hooks are server code and stay there; their code never reaches the
wire, where a descriptor only says which hooks exist.

The other direction is a rule too: **the frontend imports `backend/**` as types
only** (`import type { posts } from "../../../backend/schema/posts"`, which the
compiler erases). A value import would put the table, its hooks and every server
module they reach into the browser bundle. That replaced the Vite plugin that used
to strip server code from shared collection files — no file is shared any more.

## 2. CMS mode — the panel renders the served tables

Add the admin packages and mount `<RebaseCMS />`. It renders every table the
backend serves at `GET /api/schema/tables` — labels, widgets, filters and
relation tabs derived from the descriptors — with no file per table. The panel's
own files say how a table differs from that default:

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { MarkdownField } from "../fields/MarkdownField";

export const postsCms = customizeTable<typeof posts>("posts", {
    icon: "FileText",
    fields: { body: { Field: MarkdownField } }
});

// App.tsx
<RebaseCMS tableCustomizations={[postsCms]} externalCollections={[firestoreEvents]} />
```

Components are imported by value: these files run only in Vite/React.
Firestore collections, which the browser reads directly, are declared here too
(`defineFirestoreCollection` from `@rebasepro/firebase`). What the panel calls a
**collection** is a table as it shows it, or one of these.

How a person resized or reordered a table is a UI preference, never a schema edit:
saved per user and per workspace, through `/api/admin/ui-config`, over the code's
customizations.

Install: the BaaS set plus `@rebasepro/app`, `@rebasepro/cms`, `@rebasepro/ui`,
`@rebasepro/forms`.

## 3. Full mode — Studio

Studio is the **BaaS console**: SQL editor, schema visualizer, RLS editor, storage
browser, logs, API explorer, API keys, backups, cron. Its views target the BaaS
control plane, not the CMS — it talks to the backend over HTTP through
`@rebasepro/client`, reads the schema from `GET /api/schema/tables`
(`useTableDescriptors`), and `@rebasepro/cms` is an *optional* peer dependency it
never imports.

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
                server-postgres → codegen, common, server, types, utils
                cli → agent-skills, client, codegen, server, server-postgres, types
                codegen → common                      (types: peer)
                mcp → client
                inference → types, utils
                rls-check (leaf)                      (audits any Postgres, Rebase or not)

CMS             ui, forms (leaves)
                cms-types → types                     (the React half of the types)
                app → cms-types, common, forms, types, ui, utils
                cms → app, cms-types, common, forms, inference, types, ui, utils
                firebase → app, cms, cms-types, common, types, ui, utils

Full            studio → app, client, cms-types, common, types, ui, utils
                        (cms: optional peer)
                plugin-insights → app, cms-types, types, ui
                plugin-ai → app, cms, cms-types, common, types, ui, utils
```

`agent-skills` is the one published package outside `packages/`: it lives in
`tooling/rebase-agent-skills/` and holds the skills `rebase skills install` copies.

Names describe **role**, not position or framework. `server` pairs with `client`;
`app` is the runtime that `cms`, `studio` and the plugins register into. React is a
peer dependency of the frontend tier, not an identity — `cms`, `studio` and the
plugins are every bit as React as `app`, so none of them carry it in the name.

`firebase` sits in the CMS tier rather than beside `client`, where its old `client-`
prefix filed it: it depends on `app`, `cms` and `cms-types`, so it is a UI
integration, not a client SDK.

The React auth controller (`useRebaseAuthController`) lives in `app`, beside the
`RebaseAuth` and `LoginView` components it is used with. It was once a package of
its own, which turned out to be one hook whose only dependency was `types`. The auth
*system* is in `client` (`client.auth`) and `server`.

`serveSPA` (`packages/server/src/serve-spa.ts`) is the only place the backend
touches the admin bundle, and it is called from the *application* entry point, never
from the framework. BaaS deployments simply never call it.

---

## Scaffolding

```bash
rebase init my-app --headless      # backend alone, no backend/schema: tables introspected
rebase init my-app                 # backend/ (tables in backend/schema) + frontend/ (default)
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
- `pnpm run check:baas-types` (`tests/e2e/baas-typecheck/`) — typechecks a real BaaS project
  (backend, SDK reads and writes, server-side data typed from a registered `Database`) with `react` mapped onto a stub that stands in for its absence. Catches a
  React type reached through an alias, which a text scan cannot see. The two are
  complementary: the scan cannot see through an alias, the fixture cannot see an unused
  import.
- `pnpm run check:templates` — compiles every scaffold `rebase init` writes, once per
  preset (`blog`, `ecommerce`, `blank`) and for `--headless`, laid out as `rebase init`
  lays it out — tables, resources, storage, functions and every `customizeTable`
  against its table — and checks every table states its `rls` and the frontend imports
  the backend as types only. Nothing else checked them fast: the only thing that compiled a template was the CMS
  init e2e, inside a Docker build about fifteen minutes in. These are the first files
  every new project runs, so they should fail in seconds.
- `pnpm run check:headless` — imports every `backend/schema` module (the demo's, the
  template's and each preset's), the `resources` / `storage` / `hooks` modules beside
  them, and every server package under a Node loader hook that throws on `react`, `react-dom`, `react-router` (or
  `react-router-dom`), or any `@rebasepro/{cms,cms-common,ui,app,studio,forms}`
  (the list is `FORBIDDEN_PACKAGES` in `tooling/scripts/headless-guard/forbid-ui-hook.mjs`).
  Runs in CI before the build, reads
  source directly, needs no build step. Add new server packages to
  `SERVER_PACKAGES` in `tooling/scripts/headless-guard/check.mjs`.
  Imports that TypeScript elides because they are unused do not trip it, which
  matches runtime: backends run this same TS through tsx.
- `pnpm run check:frontend-backend-imports` — code under a `frontend/` imports its
  sibling `backend/` as types only, in the demo, every example and the template and
  preset sources. The rule that replaced the Vite collections plugin's stripping.
- `tests/e2e/tests/cli-init-baas-e2e.ts` — scaffolds `--headless`, installs it from real
  tarballs, creates tables the project was never told about, and checks the API serves
  them. This is the only place a scaffolded project is installed and booted
  (`workspace:*` deps resolve nowhere else), so it's what proves the template rather
  than the library behind it. It also asserts no `react` in the install tree — the
  guard above can't see templates.
- `packages/server/test/init-mode.test.ts` — the derivation contract: which
  tables are served given what resolved, and that the schema editor follows that
  and `NODE_ENV`.
- A driver that cannot introspect fails at boot rather than serving
  nothing: reporting no tables means it never looked, so `init` throws and names
  it. An empty database is different — that warns and boots.
- `rebase doctor --policies` diffs `pg_policies` against the policies your tables' `rls` generates,
  and exits non-zero on drift. **RLS fails silently by design**: a policy that never
  matches filters every row, and an empty table is indistinguishable from a table with
  no data. Policies live in Postgres and the definition is only their source, so a stale
  policy from an old push outlives any fix to it — which is exactly how the demo
  served empty tables for months. Run it in CI against a deployed database.
