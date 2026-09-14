# Data Sources (multi-backend routing)

Rebase routes each collection to a **data source** — a named place its data
lives. The same model is shared by the frontend and the backend.

## The three axes

A collection's storage has three orthogonal properties:

| Axis | Meaning | Field |
|------|---------|-------|
| **Engine** | `postgres` / `mongodb` / `firestore` / custom — drives editor capabilities (relations vs subcollections, RLS, column types) | `DataSourceDefinition.engine`, or `collection.engine` where no definition is registered |
| **Instance** | which physical DB / schema / Firestore database within the engine | `collection.databaseId` (defaults from the data source) |
| **Transport** | how the *frontend* reaches it | `DataSourceDefinition.transport` |

Transport values:

- **`server`** — through the Rebase backend (the `RebaseClient`). The backend
  holds the database adapter. This is the default and covers Postgres, MongoDB,
  and any server-mediated engine. **Server sources need no frontend driver.**
- **`direct`** — straight from the client to the external backend via its own
  SDK (e.g. Firestore). The Rebase backend is not in the data path.
- **`custom`** — a developer-supplied `DataDriver`.

## Collections opt in by key

```ts
// Default data source (server-mediated Postgres)
{ slug: "products", properties: { /* … */ } }

// A registered data source by key
{ slug: "events", dataSource: "analytics", properties: { /* … */ } }
```

`collection.dataSource` is the routing key (default `"(default)"`);
`defineCollection` also accepts the handle `database("analytics")` returned and
records its key. `collection.engine` is the engine hint: a registered definition's
`engine` wins over it, and build-time tooling, which has no registry, reads it
directly (see below).

## Frontend

```tsx
<Rebase
  client={rebaseClient}                       // server transport = the default
  dataSources={[
    { key: "analytics", engine: "firestore", transport: "direct", driver: firestoreDriver }
  ]}
>
```

- Only register **direct** and **custom** sources. Postgres/Mongo ride the
  `client`.
- Routing is automatic and resolved by collection path against the registry —
  it works for list/entity views, references, the board view, import/export,
  and programmatic `context.data`, with no per-collection wiring. Routing
  follows the *target* path, so a reference from a Firestore form to a Postgres
  collection is still served by Postgres.
- `transport` may be left out on the frontend: an entry with a `driver` is
  `direct`, one without is `server`.

## Backend

The backend takes no list of data sources. They are declared once, with
`database()` in `config/resources.ts`, and every consumer reads the declarations:

```ts
// config/resources.ts
import { database } from "@rebasepro/types";

export const main      = database();                                // (default) — DATABASE_URL
export const events    = database("events", { engine: "mongodb" }); // DATABASE_URL__EVENTS
export const analytics = database("analytics", { engine: "firestore", transport: "direct" }); // client-only
```

Run `rebase resources --write` after changing them, so `rebase.resources.json` —
the copy a host reads without running code — follows. The managed runtime reads
the declarations at boot; an ejected backend reads them with
`declaredDataSources()`, resolves connections with `resolveDataSources()`, opens
them with `initializeDataSources()` and hands the resulting bootstrappers to
`initializeRebaseBackend`, which is what the ejected template does. A
`dataSources` key on the backend config is refused at boot rather than ignored.

- Every server-transport source needs its own connection, `DATABASE_URL__<KEY>`.
  A declared source without one is a boot error, not a silent fall-back to the
  default database. The driver package follows from the engine;
  `REBASE_DRIVER__<KEY>` overrides it.
- The backend resolves each collection's engine and transport from the same
  definitions.
- Collections on a `direct`/`custom` transport are **client-only**: the backend
  still owns their schema/registry but does **not** generate server data routes
  for them (so a Firestore collection never gets a mis-engined Postgres
  endpoint).
- Multiple instances of the *same* engine (e.g. several Postgres schemas) are
  handled by the engine adapter via `databaseId`.

### Multiple engines in one instance (Postgres + MongoDB)

Declare the second database with its engine, as `events` above, and point the
collections that live there at its key:

```ts
{ slug: "products", /* … */ }                     // → Postgres (default)
{ slug: "events", dataSource: "events", /* … */ } // → MongoDB
```

One bootstrapper is initialized per declared server-transport source, each
registered under the source's key, and the `(default)` one is the default.
Each request is routed to the right delegate by the collection's resolved
data-source key, which is that bootstrapper's id. The auth middleware scopes the
chosen delegate into the request context — applying Postgres RLS where
supported, and no-op scoping for engines without `withAuth()`. Single-engine
backends are unaffected (no per-request lookup).

**Realtime** is routed too: the single WebSocket server is driven by a composite
that sends each `subscribe_collection`/`subscribe_entity` to the realtime
provider owning that collection's engine (Postgres LISTEN/NOTIFY, MongoDB change
streams, …), while channels/presence/broadcast use the default provider.
Firestore (`direct`) realtime is handled entirely client-side by its SDK and
never reaches the backend.

If a server-transport collection names a data-source key with no registered
driver, the backend logs a warning at boot (the collection would otherwise
silently fall back to the default driver — i.e. the wrong database). Declare the
source with `database("<key>")`, or mark it `direct`/`custom`.

> **Note:** entity **history** is served by the default engine's history
> service; the revert action routes through the per-request delegate. Per-engine
> history services for non-default engines are a separate feature.

## Auth & multiple data sources

Authentication has important interactions with multi-data-source setups:

- **Auth lives in the default data source.** The built-in auth subsystem
  (users, sessions, repository, API keys) is bootstrapped on the *default*
  driver. The auth collection must therefore be on the default data source —
  the backend warns at boot if it isn't (a non-default auth collection would
  produce a split-brain user store).
- **Database-enforced row security is Postgres-only; the rules are not.**
  `securityRules` are a declaration about the data, and the engine decides *who*
  enforces them, not *whether* they hold. Postgres compiles them to RLS DDL;
  MongoDB has no RLS, so its driver applies the same rules in-process — on the
  listing, the count, `fetchOne`, `save`, `delete` and realtime subscriptions
  alike. An engine with no `withAuth()` at all still gets no row-level
  authorization (`scopeDataDriver` no-ops for it); enforce access there with
  app-level checks or engine-native rules. The backend warns at boot for
  non-RLS server engines.
- **In-process enforcement refuses what it cannot express.** The MongoDB driver
  translates each rule through the same compiler the Postgres DDL generator
  uses. A rule it cannot turn into a query — raw SQL beyond simple comparisons,
  a membership subquery (`existsIn`), a negated column predicate — makes the
  request fail with `SECURITY_RULE_UNSUPPORTED` rather than be served without
  authorization. Prefer `access`, `ownerField`, `roles` and structured
  `condition`/`check` on a non-Postgres collection; raw `using`/`withCheck`
  stays Postgres-only.
- **`withCheck` runs before the write on MongoDB.** There is no transaction to
  roll back, so the driver evaluates `USING` against the stored row and
  `WITH CHECK` against the row that would replace it, and refuses before
  touching the document.
- **Direct data sources bypass Rebase auth entirely.** A Firestore (`direct`)
  collection is reached straight from the client, so the Rebase JWT, RLS, and
  API keys never apply — security is governed by the external backend's own
  rules and token (e.g. external auth provider + native security rules).
- **Overriding auth completely.** Pass an `AuthAdapter` as `auth` to
  `initializeRebaseBackend` to fully replace the built-in system (Clerk, Auth0,
  external providers, …). It controls `verifyRequest` and optionally
  `userManagement`. This is the recommended way to unify identity across a
  server backend and a direct source — the same adapter can mint the external
  token. Per-request data-source routing works identically under an adapter.

## The shared resolver

`resolveDataSource(collection, registry)` in `@rebasepro/common` is the single
source of truth used by the frontend router, the backend, and the editor:

```ts
const { key, engine, transport, databaseId, capabilities } =
    resolveDataSource(collection, createDataSourceRegistry(definitions));
```

## The schema toolchain only owns SQL collections

`config/collections` holds *every* collection the project declares, whatever
engine serves it. The SQL toolchain reads only the ones a SQL engine stores —
`isRelationalCollection` / `relationalCollections` in `@rebasepro/common` are
the single rule, and it is the resolved engine's `supportsRelations`
capability, not a name check.

Skipped for a Firestore or MongoDB collection:

- the generated Drizzle schema and the Postgres DDL (`rebase schema generate`)
- boot-time table creation and RLS policies (`REBASE_MIGRATE_ON_BOOT`)
- the `db push` include list — and this one matters beyond tidiness: a name on
  that list is a name Atlas is allowed to drop, so a Firestore collection called
  `exercises` used to remove a real, unrelated `public.exercises` table's
  protection from the next auto-approved push
- `rebase doctor`'s drift report, and the schema-drift warning `rebase dev`
  prints when a collection file changes

**Declare `engine` on a collection that is not SQL-backed.** Build-time tooling
has no data-source registry to resolve a `dataSource` key against — the CLI
cannot evaluate your backend's `initializeRebaseBackend` call — so it falls back
to reading the key as the engine name, and an engine it does not recognise is
treated as SQL. That fallback is deliberate: generating a table nobody writes to
is recoverable, and silently *not* generating one the app serves from is not.

At runtime the same question has an exact answer, because boot knows the
initialized sources: it hands each bootstrapper only the collections its engine
stores, and logs the ones it routed elsewhere.

## What is gone

- A plain app needs no `dataSources`: `<Rebase client>` alone serves every
  collection through the backend. The frontend's only two data props are
  `client` and `dataSources`; the old top-level `driver`, `data` and
  `drivers={{…}}` props no longer exist.
- On a collection, `dataSource`, `engine` and `databaseId` are the fields.
  There is no `collection.driver`.
- On the backend, a `dataSources` option is refused at boot, with the
  `database()` declaration named as its replacement.
