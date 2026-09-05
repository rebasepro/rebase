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

## Startup Fail-Closed Protection

Rebase enforces a strict **fail-closed security posture** during database connection outages. 

If the database is unreachable during boot (e.g., PostgreSQL is starting or network routes are severed):
- The server does **not** crash or enter a restart loop. Instead, the bootstrapper transitions the backend into a **degraded status mode**.
- The HTTP server starts successfully to preserve health check endpoints, but all REST and WebSocket controllers are immediately locked.
- Any client attempting to read or write data gets a uniform `503 Service Unavailable` response:
  ```json
  {
    "error": {
      "message": "Database connection is not ready.",
      "code": "SERVICE_UNAVAILABLE"
    }
  }
  ```
- The framework attempts to re-establish the connection pool in the background, recovering automatically when the database becomes healthy.

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

Every failure — from any route, in any subsystem — comes back in one envelope:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Field | Always present | What it is |
|-------|:--------------:|------------|
| `message` | yes | Written for a person reading a console. Names the obstacle, not the rule. |
| `code` | yes | `SCREAMING_SNAKE_CASE` and stable. This is the field to branch on. |
| `details` | no | Structured payload when the refusal is *about* something — a list of failing paths, a set of unknown fields. |
| `requestId` | no | Present when the request carried or was assigned one; echoes `X-Request-ID`. Quote it in a bug report. |

The HTTP status is on the response, not in the body. Branch on `code`, not on
`message` — messages are written for humans and are free to change.

The client SDK turns every one of these into a `RebaseApiError` carrying
`status`, `code` and `details`, so application code catches one class:

```typescript
async function setPrice(id: string, price: number) {
    try {
        return await client.data.products.update(id, { price });
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
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
