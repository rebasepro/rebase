# Data Sources (multi-backend routing)

Two layers route data, and they route different things:

- **The backend** routes each **table** to a Postgres database. A table is
  declared with `defineTable` in `backend/schema/`; its `database` names a
  database declared in `backend/resources.ts`, and the default database serves
  the rest. Postgres is the only server engine (the MongoDB driver was
  retired in 0.31).
- **The admin panel** routes each **collection** — a served table as the panel
  shows it, or a Firestore collection the browser reads itself — to a data
  source. The served tables all ride the `RebaseClient`; a Firestore collection
  rides a direct driver.

## The three axes of a panel collection

| Axis | Meaning | Field |
|------|---------|-------|
| **Engine** | `postgres` / `firestore` / custom — drives editor capabilities (relations vs subcollections, RLS, column types) | `DataSourceDefinition.engine`, or the collection's `engine` where no definition is registered |
| **Instance** | which physical database / Firestore database within the engine | `databaseId` (defaults from the data source) |
| **Transport** | how the *frontend* reaches it | `DataSourceDefinition.transport` |

Transport values:

- **`server`** — through the Rebase backend (the `RebaseClient`). This is every
  table the backend serves. **Server sources need no frontend driver.**
- **`direct`** — straight from the client to the external backend via its own
  SDK (Firestore). The Rebase backend is not in the data path.
- **`custom`** — a developer-supplied `DataDriver`.

## Backend: tables opt in by key

```ts
// backend/resources.ts
import { database } from "@rebasepro/types";

export const analytics = database("analytics");   // DATABASE_URL__ANALYTICS
```

```ts
// backend/schema/page_views.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { analytics } from "../resources";

export const pageViews = defineTable("page_views", {
    database: analytics,          // or the key, "analytics"
    columns: { id: col.uuid().primaryKey().defaultRandom(), path: col.text().notNull() },
    rls: "admin-only"
});
```

`database` defaults to the default database. The compiled descriptor records the
key; boot opens one connection per declared database, provisions each table and
its policies in its own database, and routes every request — REST, realtime,
`rebase.dataAsAdmin` — to the database its table names.

- A declared database with no connection string **fails the boot**, naming the
  variable. The alternative — falling back to the default database — is data
  landing in the wrong place behind a server that reports itself healthy.
- A `database("x", { engine: "mongodb" })` (the `database` kind's frozen engine
  list still admits the name) refuses the boot: Postgres is the only server
  engine. `REBASE_DRIVER__<KEY>` overrides the driver *package*, never the engine.
- A `direct` or `custom` declaration is client-only: the backend holds no
  connection and demands no configuration for it.

## Frontend

```tsx
<Rebase
  client={rebaseClient}                       // every served table
  dataSources={[
    { key: "firestore", engine: "firestore", transport: "direct", driver: firestoreDriver }
  ]}
>
  <RebaseCMS tableCustomizations={tableCustomizations} externalCollections={[events]} />
</Rebase>
```

- Only register **direct** and **custom** sources. The backend's tables, in any
  of its databases, ride the `client`.
- A Firestore collection is declared in the frontend with
  `defineFirestoreCollection` from `@rebasepro/firebase` and passed as an
  `externalCollection`. It never appears in `backend/schema`.
- Routing is automatic and resolved by path against the registry — list and
  record views, references, the board view, import/export and programmatic
  `context.data`, with no per-collection wiring. Routing follows the *target*,
  so a reference from a Firestore form to a Postgres table is served by
  Postgres.
- A reference between data sources is stored as the target's id (a string,
  queryable with `==`) and read back as a reference carrying the target's data
  source; references within one source are untouched. A Firestore reference
  property's `path` is read as the slug of its target on any data source.
- `transport` may be left out on the frontend: an entry with a `driver` is
  `direct`, one without is `server`.

> **Note:** entity **history** is served by the backend's history service, for
> the tables it serves. A Firestore collection has none.

## Auth and data sources

- **Auth lives in the default database.** The users table is the one declared
  with `defineAuthTable`, and it must be on the default database: the built-in
  auth subsystem (users, sessions, API keys) is bootstrapped on the default
  driver.
- **Row security is Postgres RLS, in every database.** Each table's `rls` is
  compiled to policies in the database that holds it, and every request runs
  under them as `rebase_user`.
- **Direct data sources bypass Rebase auth entirely.** A Firestore collection is
  reached straight from the client, so the Rebase JWT, RLS and API keys never
  apply — security is governed by Firestore's own rules and token.
- **Overriding auth completely.** Pass an `AuthAdapter` as `auth` to
  `initializeRebaseBackend` to replace the built-in system (Clerk, Auth0, …). It
  controls `verifyRequest` and optionally `userManagement`, and is the way to
  unify identity across the backend and a direct source. Per-request database
  routing works identically under an adapter.

## The shared resolver

`resolveDataSource(collection, registry)` in `@rebasepro/common` is the single
source of truth the panel's router and editor use:

```ts
const { key, engine, transport, databaseId, capabilities } =
    resolveDataSource(collection, createDataSourceRegistry(definitions));
```

## The schema toolchain owns only the tables

`backend/schema` holds only Postgres tables, so every SQL tool — the generated
Drizzle schema and DDL, boot-time table creation and RLS, the `db push` include
list, `rebase doctor` — reads exactly the tables declared there. A Firestore
collection cannot reach any of them: it is declared in the frontend. Before
0.31 one directory held every engine's collections and each tool had to filter
the SQL ones out — a Firestore collection called `exercises` once put a real,
unrelated `public.exercises` table on the list of names Atlas was allowed to
drop.

## What is gone

- A plain app needs no `dataSources`: `<Rebase client>` alone serves every
  table through the backend. The frontend's only two data props are `client`
  and `dataSources`.
- On a table, `database` is the routing key. There is no `dataSource`,
  `engine` or `databaseId` on `defineTable`.
- On the backend, a `dataSources` option is refused at boot, with the
  `database()` declaration named as its replacement.
- The MongoDB engine, with its in-process rule evaluation.
