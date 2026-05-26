---
name: rebase-backend-postgres
description: Guide for setting up and managing the Rebase PostgreSQL backend with Drizzle ORM. Use this skill when the user needs help with database setup, schema generation, migrations, or Drizzle configuration.
---

# Rebase PostgreSQL Backend

> **WARNING FOR AGENTS**: If you are writing a script or performing data tasks (e.g., seeding, migrating content), **default to using the Rebase SDK** (`@rebasepro/client` or `@rebasepro/server-core`). **NEVER** use `psql` or raw SQL to manipulate data directly unless specifically instructed to do so for low-level debugging. Bypassing the SDK circumvents schema validation, access controls, and lifecycle hooks.

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
| `rebase db studio` | Visual database browser — Drizzle Studio | Debugging |

## Drizzle Configuration

The `drizzle.config.ts` is configured to:
- **Only manage tables defined in your schema** — other tables (like internal `rebase.*` tables) are ignored
- Use the `DATABASE_URL` from your `.env` file
- Output migrations to `./drizzle/`

## Key Backend Packages

| Package | Purpose |
|---------|---------|
| `packages/server-core` | Hono server coordinator, API generation, auth, storage |
| `packages/server-postgresql` | PostgreSQL bootstrapper, data driver, realtime (LISTEN/NOTIFY) |
| `packages/types` | Shared TypeScript type definitions (`PostgresCollection`, etc.) |

## Backend Initialization (Bootstrapper Protocol)

The backend uses the **bootstrapper protocol** — database-specific logic is encapsulated in bootstrapper objects that the server coordinator iterates over during initialization.

```typescript
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import path from "path";
import {
    initializeRebaseBackend,
    HonoEnv
} from "@rebasepro/server-core";
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgresql";
import { tables, enums, relations } from "./schema.generated.js";

const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const backend = await initializeRebaseBackend({
    collectionsDir: path.resolve(__dirname, "../../config/collections"),
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),
    server,
    app,
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            connectionString  // enables cross-instance realtime via LISTEN/NOTIFY
        })
    ],
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        accessExpiresIn: "1h",
        refreshExpiresIn: "30d",
        seedDefaultRoles: true,
        allowRegistration: false,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
});

server.listen(3001);
```

### Key Concepts

- **`createPostgresBootstrapper()`** — Creates a bootstrapper that registers the Postgres data driver, auth repository, realtime service, and history service.
- **`bootstrappers: [...]`** — The `initializeRebaseBackend()` coordinator iterates over all bootstrappers, calling `initializeDriver()`, `initializeAuth()`, `initializeRealtime()`, and `initializeHistory()`.
- **`collectionsDir`** — Auto-discovers collection definition files from the specified directory.
- **`functionsDir`** — Auto-discovers custom Hono route files from a directory (see the `rebase-custom-functions` skill).
- **`cronsDir`** — Auto-discovers cron job files from a directory (see the `rebase-cron-jobs` skill).

> [!WARNING]
> **JWT Dual-Package Hazard (Monorepos / pnpm)**
> When running a backend inside a monorepo workspace (especially with `tsx` and `--preserve-symlinks`), you may encounter a `RebaseApiError: JWT secret not configured. Call configureJwt() first` error. This occurs because Node.js resolves two different module instances of `@rebasepro/server-core`.
>
> **Fix:** Explicitly call `configureJwt` in your backend's entry point **before** `initializeRebaseBackend`:
> ```typescript
> import { initializeRebaseBackend, configureJwt } from "@rebasepro/server-core";
>
> configureJwt({
>     secret: process.env.JWT_SECRET!,
>     accessExpiresIn: "1h",
>     refreshExpiresIn: "30d"
> });
>
> const backend = await initializeRebaseBackend({ ... });
> ```

## Environment Variables

The backend validates all environment variables at startup using a Zod schema. Here's the full list:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ Yes (≥32 chars) | — | JWT signing secret |
| `NODE_ENV` | No | `development` | Environment mode |
| `PORT` | No | `3001` | Server port |
| `ADMIN_CONNECTION_STRING` | No | `DATABASE_URL` | Admin-level DB connection |
| `JWT_ACCESS_EXPIRES_IN` | No | `1h` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `30d` | Refresh token TTL |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `REBASE_SERVICE_KEY` | No | — | Service-to-service auth key |
| `ALLOW_REGISTRATION` | No | `true` | Enable user registration |
| `CORS_ORIGINS` | No (⚠ required in prod) | — | Comma-separated allowed origins |
| `FRONTEND_URL` | No | — | Frontend URL (used for CORS) |
| `STORAGE_TYPE` | No | `local` | `local` or `s3` |
| `STORAGE_PATH` | No | `./uploads` | Path for local file storage |
| `S3_BUCKET` | No (if s3) | — | S3 bucket name |
| `S3_REGION` | No | `auto` | S3 region |
| `S3_ACCESS_KEY_ID` | No (if s3) | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | No (if s3) | — | S3 secret key |
| `S3_ENDPOINT` | No | — | S3 endpoint URL (MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | No | `false` | Force path-style S3 URLs |
| `DB_POOL_MAX` | No | `20` | Max DB connection pool size |
| `DB_POOL_IDLE_TIMEOUT` | No | `30000` | Pool idle timeout (ms) |
| `DB_POOL_CONNECT_TIMEOUT` | No | `10000` | Pool connect timeout (ms) |

## Health Check

The backend exposes a `/health` endpoint that returns:

```json
{
    "status": "ok",
    "latencyMs": 2.5,
    "details": { ... }
}
```

HTTP 200 for healthy, 503 for degraded.

## Graceful Shutdown

The backend handles `SIGTERM` and `SIGINT` signals:
1. Stops accepting new HTTP connections
2. Calls `backend.shutdown()` to flush background tasks
3. Drains the database connection pool
4. Force-exits after 15 seconds if shutdown hangs

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
- **Solution:** Ensure `adminConnectionString` is passed to `createPostgresBootstrapper` (typically `adminConnectionString: env.ADMIN_CONNECTION_STRING || databaseUrl`) and ensure `getAdmin()` is not overridden to return `undefined`.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)

