# @rebasepro/server-postgres

PostgreSQL database driver for Rebase, built on Drizzle ORM.

## Installation

```bash
pnpm add @rebasepro/server-postgres
```

This package is ESM-only (`"type": "module"`, no CommonJS build), so it is
loaded with `import`. It needs Node `>=22.22.0` (its `engines` floor), where
`require()` of it from a CJS file works too: Node has supported `require(esm)`
since 22.12.

### Install Ptah

`rebase db push`, `rebase db generate`, and `rebase db migrate` use the
`ptah-compat` executable supplied by `@stokaro/ptah-compat`. Generated
projects install it with their other dependencies. If you use this driver
separately, add the package to your project. Existing migrations and
`atlas.sum` keep their format.
The ordinary `db generate` and `db push` commands plan the declared tables,
policies, functions, search and vector indexes, triggers, and views together.

On a shared PostgreSQL server, `db push` (including `--dry-run`) and
`db generate` can replay SQL in the sibling dev database. Set
`PTAH_TRUST_REPLAY_SQL=1` only for SQL you trust. It runs with the dev
connection's privileges, and server-wide effects such as created roles remain.
Alternatively, set `REBASE_ATLAS_DEV_URL` to a Ptah
`docker://postgres/<version>/dev` URL or a dedicated disposable server. Set
`PTAH_DEV_SERVER_DISPOSABLE=1` only when the whole server is disposable.

## What This Package Does

Implements the Rebase `DatabaseAdapter` / `BackendBootstrapper` interfaces for PostgreSQL. It provides connection pooling, a Drizzle-based data driver, Postgres LISTEN/NOTIFY realtime, auth table management, entity history, schema generation, branching, read replicas, and WebSocket support. Plug it into `@rebasepro/server` via `createPostgresAdapter()` or `createPostgresBootstrapper()`.

## Key Exports

| Export | Description |
|--------|-------------|
| `createPostgresAdapter(config)` | Creates a `DatabaseAdapter` for use with `initializeRebaseBackend({ database: ... })`. Recommended API. |
| `createPostgresBootstrapper(config)` | Lower-level `BackendBootstrapper` factory. Used internally by the adapter. |
| `openPostgresDriver(pgConfig, init)` | Opens the data driver on `init.tables` (`compileSchema`) from explicit settings, reading no environment variable; `provision: false` opens it with no DDL. What the adapter runs at boot. New in 0.25. |
| `postgresDriverConfigFromEnv(config, env?)` | Reads `DATABASE_READ_URL`, `DATABASE_DIRECT_URL` and the `REALTIME_*` variables into a driver config, as the server's boot does. New in 0.25. |
| `openRebase({ databaseUrl, tables, hooks })` | A project's data from a script, a test or a REPL: `dataAsAdmin`, `sql`, `withAuth(user)` and `close()`. No server, no DDL, no environment reads. `rebase console` is built on it. `tables` is the project's tables compiled with `compileSchema` from `@rebasepro/common`; `hooks` the global hooks `backend/hooks.ts` exports. New in 0.25. |
| `createPostgresDatabaseConnection(url, schema?, poolConfig?)` | Creates a production-grade pooled Drizzle connection. Returns `{ db, pool, connectionString }`. |
| `createDirectDatabaseConnection(url, schema?, poolConfig?)` | Non-pooled connection for LISTEN/NOTIFY and advisory locks (bypasses PgBouncer). |
| `createReadReplicaConnection(url, schema?, poolConfig?)` | Read-only connection for routing reads to replicas. |
| `PostgresBackendDriver` | The `DataDriver` implementation — CRUD, filtering, RLS, subcollections, admin SQL. |
| `RealtimeService` | Postgres LISTEN/NOTIFY-based `RealtimeProvider`. |
| `DatabasePoolManager` | Per-branch/per-tenant dynamic pool management (used with `ADMIN_CONNECTION_STRING`). |
| `PostgresTableRegistry` | Served table → Drizzle table registry with enum and relation tracking. |
| `BranchService` | Database branching (one database per branch, copied from a template). |
| `generateSchema(tables, options?)` | Generates the Drizzle schema code (`schema.generated.ts`) from the compiled tables; `rebase schema generate` runs it over `backend/schema`. |
| `createAuthSchema(schemaName?)` | Drizzle tables for the auth system, in schema `rebase` by default: `users` (with `roles` as a `text[]` column), `refresh_tokens`, `password_reset_tokens`, `user_identities`, `mfa_factors`, `mfa_challenges`, `recovery_codes`, `magic_link_tokens`, `app_config`. |

## Quick Start

```typescript
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { initializeRebaseBackend } from "@rebasepro/server";
// Written by `rebase schema generate`.
import { enums, relations, tables } from "./schema.generated";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

// Create connection
const { db, pool } = createPostgresDatabaseConnection(connectionString);

// Create adapter and pass to server
const database = createPostgresAdapter({
  connection: db,
  connectionString,
  schema: { tables, enums, relations },
});

const backend = await initializeRebaseBackend({
  app,
  server,
  database,
  schemaDir: "./schema",   // backend/schema: the tables its index.ts exports
  auth: { /* ... */ },
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await backend.shutdown();
  await pool.end();
});
```

## Schema planning

`db generate` writes the declared PostgreSQL schema to
`backend/.rebase/sql/schema.sql` and uses it to create a migration with Ptah
Compat. `db push --dry-run` shows the same declared objects in one plan.
`db push` applies that plan and limits it to Rebase-managed resources, leaving
unrelated database objects alone. Vector columns require a declared `vector`
database extension.

After `db generate` or a non-dry-run `db push` succeeds, Rebase records the
names of declared resources in `backend/drizzle/ptah-managed.json`. Commit it
with the schema and migrations. It lets later plans recognize a removed view,
table, or function while leaving unrelated database objects outside the plan.

Review each generated migration for `DROP CONSTRAINT`. Rebase reads the live
catalog to protect custom CHECK and EXCLUDE constraints. A constraint that
exists only in the replayed migration history can still appear as a drop.

## From a script

```typescript
import { compileSchema } from "@rebasepro/common";
import { openRebase } from "@rebasepro/server-postgres";
import { posts, users, defaultRls } from "../schema";

const tables = compileSchema([users, posts], { defaultRls });
const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const { data } = await rebase.dataAsAdmin.posts.find({ limit: 10 });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });   // what Ada's RLS lets her see
await rebase.close();
```

See [Scripts and the Console](https://rebase.pro/docs/backend/scripts).

## Connection Pool Defaults

| Option | Default |
|--------|---------|
| `max` | 20 |
| `idleTimeoutMillis` | 30,000 |
| `connectionTimeoutMillis` | 10,000 |
| `queryTimeout` | 60,000 |
| `statementTimeout` | 30,000 |
| `keepAlive` | true |

## Testing

This package runs **two test runners**, split by directory. This is deliberate — check which half you are in before running anything.

| Tests | Runner | Config | Command |
|-------|--------|--------|---------|
| `test/*.ts` (unit) | jest | [`jest.config.cjs`](./jest.config.cjs) | `pnpm test` |
| `test/e2e/**` (integration) | vitest | [`vitest.e2e.config.ts`](./vitest.e2e.config.ts) | `pnpm test:e2e` |

The unit tests use jest's injected globals (`describe`/`it`/`expect`) and `jest.mock`. The e2e tests import explicitly from `vitest` and need Docker (testcontainers spins up a real Postgres).

**Running a single unit test:**

```bash
npx jest test/auth-services.test.ts
```

Pointing `vitest` at a unit test is the easy mistake here — it produces a bare `ReferenceError: jest is not defined` and a "no tests" result, which looks exactly like a dead or broken test file rather than the wrong runner. [`vitest.config.ts`](./vitest.config.ts) exists solely to intercept that and print the command you actually wanted.

`pnpm test` runs jest **without** `--passWithNoTests`: if the unit suite ever stops being collected, CI fails instead of going quietly green.

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server` | Backend orchestrator that consumes this adapter |
| `@rebasepro/types` | Shared interfaces (`DatabaseAdapter`, `BackendBootstrapper`, `DataDriver`) |
| `@rebasepro/codegen` | Generates typed SDKs from table descriptors |
| `@rebasepro/common` | The schema compiler (`compileTables`) and shared utilities |
