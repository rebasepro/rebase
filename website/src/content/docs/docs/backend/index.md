---
title: Backend Overview
sidebar_label: Backend
description: The Rebase backend provides a complete server with REST API, authentication, storage, WebSocket real-time, and entity history — all initialized with a single function call.
---

## Overview

The Rebase backend is a **Node.js server** built on [Hono](https://hono.dev/) that provides:

- **REST API** — Auto-generated CRUD endpoints for each collection
- **Authentication** — JWT tokens, OAuth and OIDC sign-in, magic links, one-time codes, MFA, API keys, user/role management
- **Storage** — File upload/download with local filesystem or S3
- **WebSocket** — Real-time data sync via PostgreSQL LISTEN/NOTIFY
- **Entity History** — Audit trail for every data change
- **Database Branching** — Instant, isolated database copies for dev/staging/testing
- **Cron Jobs** — Scheduled background tasks with monitoring dashboard

Everything is initialized with a single function:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
    enableSwagger: env.NODE_ENV !== "production"
});
```

## What Gets Created

After initialization, these routes are mounted:

| Path | Purpose |
|------|---------|
| `/api/auth/*` | Authentication (signup, login, refresh, OAuth, magic links, one-time codes, MFA) |
| `/api/admin/*` | User and role management (admin-only) |
| `/api/storage/*` | File upload, download, and deletion |
| `/api/data/collections` | Collection metadata endpoint |
| `/api/data/:slug` | CRUD operations per collection (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Entity change history (when enabled) |
| `/api/data/docs` | OpenAPI spec (when `enableSwagger: true`) |
| `/api/data/swagger` | Swagger UI (dev mode, when `enableSwagger: true`) |
| `/api/functions/*` | Custom function routes (when `functionsDir` is set) |
| `/api/cron/*` | Cron job management (admin-only, when `cronsDir` is set) |
| WebSocket on upgrade | Real-time subscriptions |

---

## The Initialization Lifecycle

When you invoke `initializeRebaseBackend()`, the framework triggers a sequential, 5-stage boot sequence:

```
[Start Boot]
     │
     ▼
1. ENV validation (Zod parsing of jwt, databases, cors)
     │
     ▼
2. Dynamic Collection Loading (Chokidar watches .ts files, AST parsing)
     │
     ▼
3. Database Bootstrapping (Acquires advisory lock, creates schemas/auth/helper SQL functions)
     │
     ▼
4. Service Initialization (Auth, Storage S3/Local client instances, Cron store seeding)
     │
     ▼
5. Route Mounting & Edge Loading (Hono controllers, custom functions, WebSocket binding)
     │
     ▼
[Boot Complete]
```

---

## What happens when boot fails

**Boot fails loudly.** If the database is unreachable, the credentials are
wrong, or the collection schema cannot be applied, `initializeRebaseBackend`
throws, nothing is served, and the process exits `1`. There is no degraded mode
and no partial server: a container that cannot reach its database restarts, and
the error that killed it is the last thing in its logs.

That is deliberate. A server that comes up answering sign-in while every
`/api/data/*` route fails is far harder to diagnose than one that never comes
up — and an orchestrator can act on a crash loop.

Before the first query, boot probes the connection and prints the diagnosis: the
host and port it could not reach, the driver's own reason (`ECONNREFUSED`,
`password authentication failed for user "app"`), and the fix. See
[Troubleshooting](/docs/troubleshooting/) for the failure-by-failure list.

### Once it is serving: `/livez` and `/health`

Two probes, answering two different questions.

| Path | Touches the database | Answers |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` while the process is running. Use it for a liveness probe. |
| `/health` | Yes, every data source | `200 {"status":"ok"}` when every configured data source answers; `503 {"status":"degraded"}` when one does not. Use it for a readiness probe. |

A liveness probe on `/health` is a mistake worth naming: a database blip would
make the orchestrator kill an otherwise healthy process, turning a short outage
into a restart loop.

`/health` is unauthenticated, so it publishes the verdict and not the reason —
outside development it names which data source is degraded and nothing else. The
driver's error text quotes the host, port, database name and role, and that goes
to the logs. Both paths are also served under `basePath` (`/api/health`).

---

## Configuration Reference

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Collections
    collections?: CollectionConfig[];  // Your collection definitions
    collectionsDir?: string;  // Auto-load collections from a directory

    // Database adapter (PostgreSQL, SQLite, etc.)
    database?: DatabaseAdapter;

    // Authentication configuration or custom adapter
    auth?: RebaseAuthConfig | AuthAdapter;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;        // Auto-load cron jobs from a directory

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

## The Backend Instance

`initializeRebaseBackend` returns a `RebaseBackendInstance` with access to internal services:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.auth?.roleService       // Role management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.collectionRegistry  // Collection metadata
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when cronsDir is set)
```

> **Note:** While the `instance` exposes these internal services, application code (such as custom functions and cron jobs) should use the global `rebase` singleton from `@rebasepro/server` to interact with the backend API.

## REST API

The REST API is auto-generated from your collections. Every collection gets these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | List entities (with filter, sort, limit, search) |
| `GET` | `/api/data/:slug/:id` | Get a single entity |
| `POST` | `/api/data/:slug` | Create a new entity |
| `DELETE` | `/api/data/:slug/:id` | Delete a entity |

### Query Parameters

| Param | Description | Example |
|-------|-------------|---------|
| `filter` | JSON-encoded filter conditions | `?filter={"active":["==",true]}` |
| `orderBy` | Sort field | `?orderBy=createdAt` |
| `order` | Sort direction | `?order=desc` |
| `limit` | Page size | `?limit=25` |
| `startAfter` | Cursor for pagination | `?startAfter=encodedCursor` |
| `search` | Full-text search | `?search=laptop` |

## WebSocket

The WebSocket server attaches to the same HTTP server and provides real-time subscriptions:

- Subscribe to **collection changes** — get notified when any entity in a collection is created, updated, or deleted
- Subscribe to **entity changes** — get notified when a specific entity changes
- Automatic **reconnection** handling in the client SDK

The backend uses PostgreSQL `LISTEN/NOTIFY` internally. For multi-instance deployments, provide a `connectionString` in your `PostgresBootstrapper` to enable cross-instance broadcasting.

## Error Handling

The backend includes an error handler that catches all exceptions and returns structured error responses:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "not-found",
        "status": 404
    }
}
```

If initialization fails (e.g., database connection error), the server still starts but returns 503 for all API requests, with a descriptive error message in the logs.

## Next Steps

- **[Authentication](/docs/backend/authentication)** — JWT, OAuth and OIDC providers, MFA, API keys, user management
- **[Storage](/docs/backend/storage)** — Local and S3 file storage
- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks and `context.data` API
- **[Entity History](/docs/backend/history)** — Audit trail
- **[Custom Functions](/docs/backend/custom-functions)** — Add custom API endpoints
- **[Cron Jobs](/docs/backend/cron-jobs)** — Scheduled background tasks
- **[Database Branching](/docs/backend/branching)** — Instant database copies for dev/staging
