# @rebasepro/server-postgres

PostgreSQL database driver for Rebase, built on Drizzle ORM.

## Installation

```bash
pnpm add @rebasepro/server-postgres
```

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

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server` | Backend orchestrator that consumes this adapter |
| `@rebasepro/types` | Shared interfaces (`DatabaseAdapter`, `BackendBootstrapper`, `DataDriver`) |
| `@rebasepro/codegen` | Generates typed SDKs from collections |
| `@rebasepro/common` | Default collections and shared utilities |
