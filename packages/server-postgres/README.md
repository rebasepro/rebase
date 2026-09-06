# @rebasepro/server-postgres

PostgreSQL database driver for Rebase, built on Drizzle ORM.

## Installation

```bash
pnpm add @rebasepro/server-postgres
```

This package is ESM-only (`"type": "module"`, no CommonJS build), so it is
loaded with `import`. `require()` of it from a CJS file works only on Node
22.12+, which supports `require(esm)`.

### Allow `@ariga/atlas` to run its install script

`db push`, `db generate` and `db migrate` shell out to the `atlas` binary, and
`@ariga/atlas` downloads that binary in a `preinstall` script. pnpm 10+ and npm
12+ refuse a dependency's lifecycle scripts unless the project allowlists them —
and the install still exits 0, so the only sign is
`ERR_PNPM_IGNORED_BUILDS: @ariga/atlas` several screens up, followed by
`Failed to create bin … ENOENT`. Nothing then fails until the first schema push.

A project scaffolded by `rebase init` already carries the entry. Adding this
package to an existing project needs it:

```yaml
# pnpm-workspace.yaml
allowBuilds:
  "@ariga/atlas": true
```

```json
// package.json, for npm
{ "allowScripts": { "@ariga/atlas": true } }
```

`rebase doctor` reports the state of that binary, and tells the three apart:
not installed, installed with its script blocked, and on disk with only the
`node_modules/.bin` link missing.

## What This Package Does

Implements the Rebase `DatabaseAdapter` / `BackendBootstrapper` interfaces for PostgreSQL. It provides connection pooling, a Drizzle-based data driver, Postgres LISTEN/NOTIFY realtime, auth table management, snapshot history, schema generation, branching, read replicas, and WebSocket support. Plug it into `@rebasepro/server` via `createPostgresAdapter()` or `createPostgresBootstrapper()`.

## Key Exports

| Export | Description |
|--------|-------------|
| `createPostgresAdapter(config)` | Creates a `DatabaseAdapter` for use with `initializeRebaseBackend({ database: ... })`. Recommended API. |
| `createPostgresBootstrapper(config)` | Lower-level `BackendBootstrapper` factory. Used internally by the adapter. |
| `createPostgresDatabaseConnection(url, schema?, poolConfig?)` | Creates a production-grade pooled Drizzle connection. Returns `{ db, pool, connectionString }`. |
| `createDirectDatabaseConnection(url, schema?, poolConfig?)` | Non-pooled connection for LISTEN/NOTIFY and advisory locks (bypasses PgBouncer). |
| `createReadReplicaConnection(url, schema?, poolConfig?)` | Read-only connection for routing reads to replicas. |
| `PostgresBackendDriver` | The `DataDriver` implementation — CRUD, filtering, RLS, subcollections, admin SQL. |
| `RealtimeService` | Postgres LISTEN/NOTIFY-based `RealtimeProvider`. |
| `DatabasePoolManager` | Per-branch/per-tenant dynamic pool management (used with `ADMIN_CONNECTION_STRING`). |
| `PostgresCollectionRegistry` | Collection → Drizzle table registry with enum and relation tracking. |
| `BranchService` | Database branching (schema-level isolation). |
| `generateDrizzleSchema(collections)` | Generates Drizzle schema code from collection definitions. |
| `createAuthSchema(schemaName?)` | Generates Drizzle tables for the auth system (`users`, `roles`, `user_roles`). |

## Quick Start

```typescript
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { initializeRebaseBackend } from "@rebasepro/server";
import * as schema from "./generated/schema";

// Create connection
const { db, pool } = createPostgresDatabaseConnection(
  process.env.DATABASE_URL,
  schema
);

// Create adapter and pass to server
const database = createPostgresAdapter({
  connection: db,
  connectionString: process.env.DATABASE_URL,
  schema: { tables: schema },
});

const backend = await initializeRebaseBackend({
  app,
  server,
  database,
  collections,
  auth: { /* ... */ },
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await backend.shutdown();
  await pool.end();
});
```

## Connection Pool Defaults

| Option | Default |
|--------|---------|
| `max` | 20 |
| `idleTimeoutMillis` | 30,000 |
| `connectionTimeoutMillis` | 10,000 |
| `queryTimeout` | 30,000 |
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
| `@rebasepro/codegen` | Generates typed SDKs from collections |
| `@rebasepro/common` | Default collections and shared utilities |
