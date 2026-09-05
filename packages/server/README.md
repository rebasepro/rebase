# @rebasepro/server

Database-agnostic backend core for Rebase.

## Installation

```bash
pnpm add @rebasepro/server
```

## What This Package Does

This is the central orchestrator for any Rebase backend. It provides the framework-level plumbing — HTTP routing (Hono), authentication middleware, storage, email, cron jobs, custom functions, and the REST API generator — without being coupled to any specific database. Database implementations are plugged in via driver packages like `@rebasepro/server-postgres` or `@rebasepro/server-mongo`.

## Key Exports

| Export | Description |
|--------|-------------|
| `initializeRebaseBackend(config)` | Main entry point. Wires up drivers, auth, storage, API routes, cron, and custom functions. Returns a `RebaseBackendInstance`. |
| `rebase` | Server-side singleton (`RebaseClient`). Available after init. Admin-level access to data, auth, email, and storage. |
| `loadEnv()` | Validates `process.env` against the Rebase env schema (Zod). Auto-generates dev secrets. Supports `extend` for custom vars. |
| `serveSPA(app, config)` | Mounts SPA static-file serving + index.html fallback on a Hono app. |
| `RebaseBackendConfig` | Config type for `initializeRebaseBackend`. |
| `RebaseAuthConfig` | Auth config type (JWT, OAuth providers, hooks, service key). |
| `RebaseBackendInstance` | Return type — includes `driver`, `healthCheck()`, `shutdown()`, `cronScheduler`, `storageController`, etc. |
| `RebaseEnv` | Zod-inferred type of validated environment variables. |
| `z` | The runtime's own Zod instance. Build `loadEnv({ extend })` schemas with this one — a schema from a second copy of zod is silently ignored. |
| `_setRebaseMock` / `_resetRebaseMock` | Test helpers to mock the `rebase` singleton (NODE_ENV=test only). |

Also re-exports all abstract interfaces (`DatabaseAdapter`, `AuthAdapter`, `DataDriver`, etc.), API types (`HonoEnv`, `ApiConfig`), auth module, email module, storage module, history module, cron module, custom functions, logging utilities, and driver registry.

## Quick Start

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initializeRebaseBackend, loadEnv, serveSPA } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

// 1. Load and validate environment
const env = loadEnv();

// 2. Create Hono app + HTTP server
const app = new Hono();
const server = serve({ fetch: app.fetch, port: env.PORT });

// 3. Initialize Rebase
const backend = await initializeRebaseBackend({
  app,
  server,
  database: createPostgresAdapter({ connection: db, schema }),
  collections: myCollections,
  auth: {
    collection: defaultUsersCollection,
    jwtSecret: env.JWT_SECRET,
    allowRegistration: env.ALLOW_REGISTRATION,
    serviceKey: env.REBASE_SERVICE_KEY,
    google: { clientId: env.GOOGLE_CLIENT_ID },
  },
  storage: { type: "s3", bucket: env.S3_BUCKET },
  functionsDir: "./functions",
  cronsDir: "./crons",
});

// 4. Optionally serve a frontend SPA
serveSPA(app, { frontendPath: "./frontend/dist" });
```

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server-postgres` | PostgreSQL database driver (Drizzle ORM) |
| `@rebasepro/server-mongo` | MongoDB database driver |
| `@rebasepro/types` | Shared type definitions (`DataDriver`, `CollectionConfig`, etc.) |
| `@rebasepro/client` | Client SDK used internally by the `rebase` singleton |
| `@rebasepro/common` | Shared utilities and default collections |
