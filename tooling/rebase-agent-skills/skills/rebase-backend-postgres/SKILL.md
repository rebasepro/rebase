---
name: rebase-backend-postgres
description: Guide for setting up and managing the Rebase PostgreSQL backend with Drizzle ORM. Use this skill when the user needs help with database setup, schema generation, migrations, connection pooling, read replicas, direct connections, Drizzle configuration, or backend initialization.
---

# Rebase PostgreSQL Backend

> **WARNING FOR AGENTS**: If you are writing a script or performing data tasks (e.g., seeding, migrating content), **default to using the Rebase SDK** (`@rebasepro/client` or `@rebasepro/server`). **NEVER** use `psql` or raw SQL to manipulate data directly unless specifically instructed to do so for low-level debugging. Bypassing the SDK circumvents schema validation, access controls, and lifecycle hooks.

Rebase uses PostgreSQL as its primary database, with Drizzle ORM for type-safe schema management and migrations.

## Architecture

```
Collections (TypeScript) → Drizzle Schema (generated) → PostgreSQL (database)
```

The backend uses a **two-step process**:
1. **`rebase schema generate`** reads your Rebase collection definitions and generates a Drizzle ORM schema file (`schema.generated.ts`)
2. **`rebase db push`** or **`rebase db generate` + `rebase db migrate`** applies the schema to the database

## Prerequisites

- PostgreSQL 14+ (local or Docker)
- `DATABASE_URL` environment variable set in the project root's `.env` file
- pnpm installed

## Quick Start (Development)

```bash
# From the project root directory:

# 1. Generate Drizzle schema from collections
rebase schema generate

# 2. Push changes directly to database (no migration files)
rebase db push
```

## Production Workflow (With Migrations)

```bash
# 1. Generate Drizzle schema
rebase schema generate

# 2. Generate SQL migration files (creates timestamped .sql in ./drizzle/)
rebase db generate

# 3. Review the generated SQL before applying!

# 4. Apply migrations
rebase db migrate
```

## Command Reference

| Command | Description | When to Use |
|---------|-------------|-------------|
| `rebase schema generate` | Collections → Drizzle schema | Always first step |
| `rebase schema introspect` | DB → Rebase collections | Legacy DB import (Preferred) |
| `rebase db push` | Apply schema directly to DB | Development |
| `rebase db generate` | Generate schema + create SQL migration files | Production prep |
| `rebase db migrate` | Run pending migrations | Production deploy |
| `rebase db branch` | Create / list / delete a database branch | Feature work |
| `rebase db backup` | Write a backup of the current database | Before a risky change |
| `rebase db backups` | List the backups taken so far | Picking one to restore |
| `rebase db restore` | Restore the database from a backup | Recovery |

<!-- docs-verify: ignore -->
> **IMPORTANT FOR AGENTS:** `push`, `generate`, `migrate`, `branch`, `backup`, `restore`
> and `backups` are the whole list — anything else exits 1. In particular there is no
> `rebase db studio`.
>
> `rebase db push` refuses a destructive change on a non-TTY (dropped column, dropped
> table). In CI or from an agent, pass `--allow-destructive` (or `--yes`) once you have
> confirmed the data loss is intended.

## Key Backend Packages

| Package | Purpose |
|---------|---------|
| `@rebasepro/server` | Hono server coordinator, API generation, auth, storage, env validation |
| `@rebasepro/server-postgres` | PostgreSQL bootstrapper, data driver, connection helpers, realtime (LISTEN/NOTIFY) |
| `@rebasepro/types` | Shared TypeScript type definitions (`PostgresCollectionConfig`, etc.) |

## Connection Functions

All connection functions are exported from `@rebasepro/server-postgres`.

### createPostgresDatabaseConnection()

The primary connection factory. Creates a Drizzle-backed Postgres connection with a production-grade pool.

```typescript
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";

const { db, pool, connectionString } = createPostgresDatabaseConnection(
    process.env.DATABASE_URL!,
    undefined,               // optional: Drizzle schema for relational API
    {                        // optional: PostgresPoolConfig overrides
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    }
);
```

**Signature:**

```typescript no-verify
function createPostgresDatabaseConnection(
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: PostgresPoolConfig
): { db: NodePgDatabase; pool: Pool; connectionString: string }
```

**Returns** `{ db, pool, connectionString }` — the `pool` is exposed so callers can register shutdown hooks (`pool.end()`) or monitor pool metrics.

### createReadReplicaConnection()

Creates a connection to a read replica for distributing read queries. Uses a default pool max of **10**.

```typescript
import { createReadReplicaConnection } from "@rebasepro/server-postgres";

const readResources = createReadReplicaConnection(
    process.env.DATABASE_READ_URL!,
    mergedSchema   // optional: same Drizzle schema for relational API
);
```

**Signature:**

```typescript no-verify
function createReadReplicaConnection(
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: PostgresPoolConfig
): { db: NodePgDatabase; pool: Pool; connectionString: string }
```

> **IMPORTANT FOR AGENTS:** The bootstrapper automatically creates a read replica connection when `DATABASE_READ_URL` is set and differs from the primary `connectionString`. You do NOT need to call this manually in most cases.

### createDirectDatabaseConnection()

Creates a direct (non-pooled) connection for session-level features incompatible with PgBouncer transaction mode: **LISTEN/NOTIFY**, prepared statements, advisory locks. Uses a smaller default pool max of **5**.

```typescript
import { createDirectDatabaseConnection } from "@rebasepro/server-postgres";

const directResources = createDirectDatabaseConnection(
    process.env.DATABASE_DIRECT_URL!,
    mergedSchema
);
```

**Signature:**

```typescript no-verify
function createDirectDatabaseConnection(
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: PostgresPoolConfig
): { db: NodePgDatabase; pool: Pool; connectionString: string }
```

> **IMPORTANT FOR AGENTS:** The bootstrapper uses `DATABASE_DIRECT_URL` automatically to bypass PgBouncer for LISTEN/NOTIFY realtime. If `DATABASE_DIRECT_URL` is not set, it falls back to the primary `connectionString`.

### PostgresPoolConfig

All three connection functions accept an optional `PostgresPoolConfig` for programmatic pool tuning:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `max` | `number` | `20` (`10` for replica, `5` for direct) | Maximum connections in the pool |
| `idleTimeoutMillis` | `number` | `30000` | Close idle connections after this many ms |
| `connectionTimeoutMillis` | `number` | `10000` | Abort connection attempts after this many ms |
| `queryTimeout` | `number` | `30000` | Per-query timeout in ms |
| `statementTimeout` | `number` | `30000` | Per-statement timeout in ms |
| `keepAlive` | `boolean` | `true` | Enable TCP keep-alive |

## DatabasePoolManager

The `DatabasePoolManager` manages multiple database connection pools dynamically. Used internally by the bootstrapper when `adminConnectionString` is configured — enables cross-database operations like branching and SQL execution against arbitrary databases.

```typescript
import { DatabasePoolManager } from "@rebasepro/server-postgres";

const poolManager = new DatabasePoolManager(process.env.ADMIN_CONNECTION_STRING!);

// Get a Drizzle instance for a specific database (creates pool on demand)
const db = poolManager.getDrizzle("my_branch_db");

// Get the raw pg.Pool
const pool = poolManager.getPool("my_branch_db");

// Check if a pool exists
poolManager.hasPool("my_branch_db"); // boolean

// Disconnect a specific database (required before DROP DATABASE / CREATE DATABASE ... TEMPLATE)
await poolManager.disconnectDatabase("my_branch_db");

// Shut down all pools
await poolManager.shutdown();
```

**API Reference:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `new DatabasePoolManager(adminConnectionString: string)` | Parses the database name from the URL |
| `getDrizzle` | `(databaseName: string) => NodePgDatabase` | Returns (or creates) a Drizzle instance for the database |
| `getPool` | `(databaseName: string) => Pool` | Returns (or creates) a raw pg Pool for the database |
| `hasPool` | `(databaseName: string) => boolean` | Checks if a pool exists |
| `disconnectDatabase` | `(databaseName: string) => Promise<void>` | Ends pool + removes cached instances |
| `shutdown` | `() => Promise<void>` | Ends all pools |
| `defaultDatabaseName` | `string` (readonly) | The database name extracted from the admin connection string |

**Dynamic pool settings:** Each dynamically created pool uses `max: 10`, `idleTimeoutMillis: 10000`, `allowExitOnIdle: true`.

## Backend Initialization

Rebase supports two equivalent APIs for configuring the PostgreSQL backend:

### Option A: createPostgresAdapter() (Recommended)

The `DatabaseAdapter` API — a simpler, flattened interface that wraps the bootstrapper internally:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import path from "path";
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresDatabaseConnection, createPostgresAdapter } from "@rebasepro/server-postgres";
import { tables, enums, relations } from "./schema.generated.js";

const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

const { db, pool, connectionString } = createPostgresDatabaseConnection(
    process.env.DATABASE_URL!,
    undefined,
    { max: env.DB_POOL_MAX }
);

const backend = await initializeRebaseBackend({
    collectionsDir: path.resolve(__dirname, "../../config/collections"),
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),
    server,
    app,
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations },
        adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL,
        connectionString  // enables cross-instance realtime via LISTEN/NOTIFY
    }),
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        accessExpiresIn: "1h",
        refreshExpiresIn: "30d",
        allowRegistration: false,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
});

server.listen(3001);
```

### Option B: createPostgresBootstrapper()

The bootstrapper protocol — database-specific logic is encapsulated in bootstrapper objects:

```typescript no-verify
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgres";
import { tables, enums, relations } from "./schema.generated.js";

const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const backend = await initializeRebaseBackend({
    // ...same config as above...
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            connectionString
        })
    ],
    // ...auth, storage, etc...
});
```

> **IMPORTANT FOR AGENTS:** When both `database` and `bootstrappers` are provided, `database` takes precedence and `bootstrappers` is ignored.

### PostgresDriverConfig Properties

The config object passed to both `createPostgresAdapter()` and `createPostgresBootstrapper()`:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `connection` | `NodePgDatabase` | ✅ | Drizzle database connection from `createPostgresDatabaseConnection()` |
| `schema` | `{ tables, enums, relations }` | ✅ | Generated Drizzle schema objects |
| `connectionString` | `string` | No | Primary connection URL — enables LISTEN/NOTIFY realtime |
| `adminConnectionString` | `string` | No | Admin-level connection — enables `DatabasePoolManager`, SQL editor, branching |

### Bootstrapper Lifecycle

The `initializeRebaseBackend()` coordinator calls bootstrapper methods in this order:

| Step | Method | Purpose |
|------|--------|---------|
| 1 | `initializeDriver(config)` | Creates the `PostgresBackendDriver`, registry, realtime service, read replica, pool manager |
| 2 | `initializeAuth(config, driverResult)` | Creates auth tables, `UserService`, `PostgresAuthRepository` |
| 3 | `initializeHistory(config, driverResult)` | Creates the `rebase.entity_history` table and `HistoryService` |
| 4 | `initializeRealtime(config, driverResult)` | Returns the `RealtimeService` for WebSocket subscriptions |
| 5 | `initializeWebsockets(server, ...)` | Creates the WebSocket upgrade handler for realtime |
| 6 | `getAdmin(driverResult)` | Returns the `DatabaseAdmin` for SQL execution |
| 7 | `mountRoutes(app, basePath, driverResult)` | Hook for driver-specific routes (currently a no-op for Postgres) |

### RebaseBackendConfig Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `collectionsDir` | `string` | — | Auto-discover collection definition files |
| `functionsDir` | `string` | — | Auto-discover custom Hono route files |
| `cronsDir` | `string` | — | Auto-discover cron job files |
| `server` | `http.Server` | — | Node.js HTTP server instance |
| `app` | `Hono<HonoEnv>` | — | Hono application instance |
| `basePath` | `string` | `"/api"` | Base path for all API routes |
| `database` | `DatabaseAdapter` | — | Adapter API (takes precedence over `bootstrappers`) |
| `bootstrappers` | `BackendBootstrapper[]` | — | Bootstrapper protocol (alternative to `database`) |
| `auth` | `RebaseAuthConfig \| AuthAdapter` | — | Authentication configuration or external adapter |
| `storage` | `BackendStorageConfig \| StorageController \| Record<string, ...>` | — | File storage configuration |
| `history` | `true \| { retention?: number }` | — | Enable entity audit trail. Pass `true` or `{ retention: 90 }` for TTL in days |
| `enableSwagger` | `boolean` | `true` | Enable OpenAPI/Swagger documentation |
| `cronPersistence` | `boolean` | `true` | Persist cron execution logs to database |
| `maxBodySize` | `number` | `10485760` (10MB) | Max request body size in bytes. `0` to disable |
| `csrf` | `{ origin: string \| string[] \| (origin: string) => boolean }` | — | CSRF protection (opt-in, disabled by default) |
| `callbacks` | `CollectionCallbacks` | — | Global lifecycle callbacks applied to every collection, on every data path (REST, realtime, server-side `rebase.dataAsAdmin`) |
| `baas` | `BaasOptions` | — | `baas` mode only: `{ unprotectedTables?: "exclude" \| "serve" }`. Default `"exclude"` — a table without RLS has no authorization model, so serving it would hand every row to every logged-in user. `"serve"` overrides, for trusted callers only |
| `logging` | `{ level?: "error" \| "warn" \| "info" \| "debug" }` | — | Log level configuration |

### Auth Configuration (RebaseAuthConfig)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `collection` | `CollectionConfig` | Built-in `rebase.users` | Auth users collection |
| `jwtSecret` | `string` | Auto-generated in dev | JWT signing secret (≥32 chars) |
| `accessExpiresIn` | `string` | `"1h"` | Access token TTL |
| `refreshExpiresIn` | `string` | `"30d"` | Refresh token TTL |
| `requireAuth` | `boolean` | `true` | Require auth for data routes |
| `allowRegistration` | `boolean` | **`false`** | Enable user self-registration |
| `serviceKey` | `string` | `REBASE_SERVICE_KEY` env | Service-to-service auth key (≥32 chars) |
| `defaultRole` | `string` | — | Default role for new users |
| `seedDefaultRoles` | `boolean` | — | Seed default roles on startup |
| `email` | `EmailConfig` | — | SMTP email configuration |
| `google` | `{ clientId, clientSecret? }` | — | Google OAuth |
| `github` | `{ clientId, clientSecret }` | — | GitHub OAuth |
| `microsoft` | `{ clientId, clientSecret, tenantId? }` | — | Microsoft OAuth |
| `apple` | `{ clientId, teamId, keyId, privateKey }` | — | Apple OAuth |
| `facebook` | `{ clientId, clientSecret }` | — | Facebook OAuth |
| `twitter` | `{ clientId, clientSecret }` | — | Twitter OAuth |
| `discord` | `{ clientId, clientSecret }` | — | Discord OAuth |
| `linkedin` | `{ clientId, clientSecret }` | — | LinkedIn OAuth |
| `gitlab` | `{ clientId, clientSecret, baseUrl? }` | — | GitLab OAuth |
| `bitbucket` | `{ clientId, clientSecret }` | — | Bitbucket OAuth |
| `slack` | `{ clientId, clientSecret }` | — | Slack OAuth |
| `spotify` | `{ clientId, clientSecret }` | — | Spotify OAuth |
| `hooks` | `AuthHooks` | — | Override password hashing, validation, etc. |

> **WARNING FOR AGENTS:** `allowRegistration` defaults to **`false`**, not `true`. You must explicitly set it to `true` if you want users to register themselves.

## Environment Variables

### loadEnv()

The `loadEnv()` function validates all environment variables at startup using Zod. It is exported from `@rebasepro/server`.

**Basic usage:**

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

export const env = loadEnv();
```

**Extended — add your own typed variables:**

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";
import { z } from "zod";

dotenv.config({ path: "../../.env" });

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST       → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string            (validated, required)
```

**Signatures:**

```typescript no-verify
function loadEnv(): RebaseEnv;
function loadEnv<E extends z.AnyZodObject>(options: { extend: E }): RebaseEnv & z.infer<E>;
```

### Dev-Mode Auto-Generated Secrets

In non-production mode, `loadEnv()` **auto-generates** ephemeral `JWT_SECRET` and `REBASE_SERVICE_KEY` if not set, so developers can start without manual setup. These are regenerated on every restart — existing tokens will be invalidated.

### Full Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | — | PostgreSQL connection string (must be a valid URL) |
| `JWT_SECRET` | ✅ Yes (≥32 chars) | Auto-generated in dev | JWT signing secret |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3001` | Server port |
| `ADMIN_CONNECTION_STRING` | No | — | Admin-level DB connection for cross-database operations |
| `DATABASE_DIRECT_URL` | No | — | Direct connection URL bypassing PgBouncer (for LISTEN/NOTIFY) |
| `DATABASE_READ_URL` | No | — | Read replica connection URL |
| `DB_POOL_MAX` | No | `20` | Max DB connection pool size |
| `DB_POOL_IDLE_TIMEOUT` | No | `30000` | Pool idle timeout (ms) |
| `DB_POOL_CONNECT_TIMEOUT` | No | `10000` | Pool connect timeout (ms) |
| `DISABLE_DB_ROLE_SWITCHING` | No | — | Set to `true` to skip PostgreSQL role switching |
| `JWT_ACCESS_EXPIRES_IN` | No | `1h` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Refresh token TTL |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret |
| `REBASE_SERVICE_KEY` | No | Auto-generated in dev | Service-to-service auth key |
| `ALLOW_REGISTRATION` | No | `false` | Enable user self-registration |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | No | `false` | Allow localhost URLs in production env vars |
| `CORS_ORIGINS` | No (⚠ required in prod) | — | Comma-separated allowed origins |
| `FRONTEND_URL` | No | — | Frontend URL (used for CORS) |
| `STORAGE_TYPE` | No | `local` | `local`, `s3`, or `gcs` |
| `STORAGE_PATH` | No | — | Path for local file storage |
| `FORCE_LOCAL_STORAGE` | No | `false` | Allow local storage in production. Without it the local backend is not registered — the backend still boots, but uploads answer `501 STORAGE_NOT_CONFIGURED` |
| `S3_BUCKET` | No (if s3) | — | S3 bucket name |
| `S3_REGION` | No | — | S3 region |
| `S3_ACCESS_KEY_ID` | No (if s3) | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | No (if s3) | — | S3 secret key |
| `S3_ENDPOINT` | No | — | S3 endpoint URL (MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | No | `false` | Force path-style S3 URLs |

### Production Validations

`loadEnv()` enforces strict validation in production (`NODE_ENV=production`):

| Rule | Error Message |
|------|---------------|
| `CORS_ORIGINS` or `FRONTEND_URL` required | `CORS_ORIGINS or FRONTEND_URL must be set in production to secure the API.` |
| Auto-generated secrets blocked | `JWT_SECRET, REBASE_SERVICE_KEY must be explicitly set in production.` |
| No localhost URLs (unless `ALLOW_LOCALHOST_IN_PRODUCTION=true`) | `Environment variable DATABASE_URL contains a local/loopback URL...` |

## Drizzle Configuration

The `drizzle.config.ts` in `app/backend/` is configured to:
- **Only manage tables defined in your schema** — other tables (like internal `rebase.*` tables) are ignored via `tablesFilter`
- **Auto-detect schemas** from collection definitions (e.g., `public`, custom schemas)
- Use the `DATABASE_URL` from your `.env` file
- Output migrations to `./drizzle/`
- Ignore PostgreSQL roles (`entities.roles: false`)
- Filter PostGIS extension tables

```typescript
import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { tables } from "./src/schema.generated";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

const tableNames = Object.values(tables)
    .filter(table => getTableConfig(table as PgTable).schema !== "rebase")
    .map(table => getTableName(table as PgTable));

const schemas = Array.from(new Set(
    Object.values(tables)
        .map(table => getTableConfig(table as PgTable).schema || "public")
        .filter(schema => schema !== "rebase")
));

export default defineConfig({
    schema: "./src/schema.generated.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: { url: process.env.DATABASE_URL! },
    tablesFilter: tableNames,
    schemaFilter: schemas.length > 0 ? schemas : ["public"],
    entities: { roles: false },
    extensionsFilters: ["postgis"]
});
```

## Entity History (Audit Trail)

Enable audit logging for all entity mutations by setting `history: true` in the backend config:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    history: true,  // Enable with default settings
});

// Or with a retention policy:
const backend = await initializeRebaseBackend({
    // ...
    history: { retention: 90 },  // Auto-purge entries older than 90 days
});
```

When enabled:
- The bootstrapper auto-creates a `rebase.entity_history` table
- Every `INSERT`, `UPDATE`, `DELETE` is recorded with before/after entities
- History is queryable via the `/:slug/:entityId/history` REST endpoint

## Health Check

The backend exposes a `/health` endpoint that returns:

```json
{
    "status": "ok",
    "latencyMs": 2.5,
    "details": { ... }
}
```

HTTP 200 for healthy, 503 for degraded. Internally executes `SELECT 1` to verify database connectivity.

## Graceful Shutdown

The recommended graceful shutdown pattern:

```typescript
let isShuttingDown = false;
const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const forceTimer = setTimeout(() => {
        console.error("Shutdown timed out after 15s. Force-exiting.");
        process.exit(1);
    }, 15000);
    forceTimer.unref();

    try {
        // 1. backend.shutdown() stops cron, destroys realtime, closes HTTP server
        await backend.shutdown();

        // 2. Drain the database connection pool
        await pool.end();

        clearTimeout(forceTimer);
        process.exit(0);
    } catch (err) {
        console.error("Error during shutdown:", err);
        process.exit(1);
    }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

### backend.shutdown() Sequence

The `shutdown(timeoutMs?: number)` method (default timeout: 15000ms) performs:

1. **Stop cron scheduler** — prevents new cron executions
2. **Destroy realtime services** — tears down LISTEN clients, debounce timers, subscriptions (must happen before pool.end())
3. **Close HTTP server** — stops accepting new connections, drains in-flight requests
4. **Force-resolve** after timeout (pass `0` to disable, useful in tests)

> **WARNING FOR AGENTS:** Call `backend.shutdown()` FIRST, then `pool.end()`. Do NOT call `server.close()` separately — `backend.shutdown()` already closes the HTTP server internally. Calling both will deadlock.

## JWT Dual-Package Hazard

> [!WARNING]
> **JWT Dual-Package Hazard (Monorepos / pnpm)**
> When running a backend inside a monorepo workspace (especially with `tsx` and `--preserve-symlinks`), you may encounter a `RebaseApiError: JWT secret not configured. Call configureJwt() first` error. This occurs because Node.js resolves two different module instances of `@rebasepro/server`.
>
> **Fix:** Explicitly call `configureJwt` in your backend's entry point **before** `initializeRebaseBackend`:
> ```typescript
> import { initializeRebaseBackend, configureJwt } from "@rebasepro/server";
>
> configureJwt({
>     secret: process.env.JWT_SECRET!,
>     accessExpiresIn: "1h",
>     refreshExpiresIn: "30d"
> });
>
> const backend = await initializeRebaseBackend({ ... });
> ```

## Important Notes

- **To import a legacy database**, use `rebase schema introspect` to generate Rebase Collections.
- **Never use `schema introspect` then `db migrate`** — introspected databases already have the tables
- **Always backup before production migrations** — `ALTER COLUMN` or `DROP COLUMN` can cause data loss
- **Tables not in schema are ignored** — custom tables and internal Rebase tables are safe
- **Review generated SQL** — always inspect the `.sql` files in `./drizzle/` before applying
- **Collections directory** — Collection definitions are defined in the `config/collections/` directory.

## Troubleshooting

### 1. SQL Editor Permission Denied (`permission denied for table <name>`)
- **Symptoms:** You can view data in the collection/CMS spreadsheet view, but running custom SQL queries (like `SELECT * FROM table;`) in the Rebase Studio SQL Editor throws `cause: error: permission denied for table <table_name>`.
- **Cause:** Rebase tries to switch database roles to match the active user's role (e.g., `SET LOCAL ROLE "admin"`). If you are using custom auth (roles defined only in the database `rebase.roles` table rather than actual PostgreSQL roles), or if the database-level role doesn't have `SELECT` privileges, the query fails. The CMS view does not trigger role-switching and runs under the main connection user (which is typically a superuser/owner and bypasses RLS).
- **Solution:** Add `DISABLE_DB_ROLE_SWITCHING=true` to your backend `.env` configuration. This skips role switching, executing queries under the connection owner user.

### 2. SQL Editor/Studio Schema Fetch Failed (`Cross-database execution requires adminConnectionString`)
- **Symptoms:** Running queries in the SQL Editor or attempting to load schemas in Studio throws `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
- **Cause:** The PostgreSQL bootstrapper requires `adminConnectionString` and `getAdmin()` to be configured to execute database administration commands (including schema fetch). If `adminConnectionString` is set to `undefined` or `getAdmin()` returns `undefined` (often done to enforce a zero-schema-change requirement), administrative commands fail.
- **Solution:** Ensure `adminConnectionString` is passed to `createPostgresBootstrapper` or `createPostgresAdapter` (typically `adminConnectionString: env.ADMIN_CONNECTION_STRING || env.DATABASE_URL`) and ensure `getAdmin()` is not overridden to return `undefined`.

### 3. Read Replica Not Being Used
- **Symptoms:** All queries go to the primary database even though `DATABASE_READ_URL` is set.
- **Cause:** The bootstrapper only creates the read replica connection when `DATABASE_READ_URL` differs from the primary `connectionString`.
- **Solution:** Ensure `DATABASE_READ_URL` is a different URL from `DATABASE_URL` and points to an actual read replica.

### 4. PgBouncer Breaks Realtime (LISTEN/NOTIFY)
- **Symptoms:** Realtime subscriptions don't receive updates in production.
- **Cause:** PgBouncer in transaction mode does not support session-level LISTEN/NOTIFY.
- **Solution:** Set `DATABASE_DIRECT_URL` to a connection string that bypasses PgBouncer and connects directly to PostgreSQL.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
