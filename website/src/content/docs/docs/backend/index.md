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

:::note[Where this goes]
The call below is what an **ejected** backend has, in `backend/src/index.ts`. On
the **managed runtime** there is no such file: the runtime makes the call, and
you configure it through environment variables, the resources you declare in
`config/resources.ts` (`database()`, `bucket()`), and the two exports it reads
from `config/index.ts` (`storageAuthorize`, `callbacks`). Every page in this
section says which of the two applies to the option it documents, and names the
ones that have no managed form. Export an option the runtime does not read and
it warns you at boot rather than dropping it in silence; export one that a
resource declaration replaced and boot refuses it by name, with the
`config/resources.ts` line to write instead.
:::

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

## Where each option lives

That call is the **ejected** shape — the one you write yourself after `rebase
eject`, or in a custom server. A scaffolded project does not have it: the
published runtime boots the project, and each option arrives as an environment
variable in `.env`, an export from `config/index.ts`, or a directory the bundle
declares in `rebase.json`.

Both paths reach the same `RebaseBackendConfig`. This is the whole map.

| Option | Managed runtime |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (default `/api`) |
| `collections`, `collectionsDir` | the `config/collections/` directory, declared by `rebase.json` |
| `functionsDir` | `backend/functions/` |
| `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus a `database("<key>")` declaration in `config/resources.ts` for every database beyond the default |
| `auth` | `JWT_SECRET`, the `OAUTH_*` variables, and `config/collections/users` |
| `storage` | the `STORAGE_*` variables, plus a `bucket("<key>")` declaration in `config/resources.ts` for every bucket beyond the default |
| `storageAuthorize` | `export const storageAuthorize` from `config/index.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `callbacks` | `export const callbacks` from `config/index.ts` |
| `history` | `REBASE_HISTORY` (on by default) — the boolean form only |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; unset means on outside production |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — see [Split Processes](/docs/deployment/split-processes/) |
| `corsHandled` | CORS is installed by the runtime from `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | the build stamps both into the bundle |
| `app`, `server`, `provisioningDriverResult` | the runtime creates them |

### Options with no managed route

These have no environment variable and no config export. They are reachable
only from a hand-written `initializeRebaseBackend` call — `rebase eject`, or a
[custom server](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` · `functionsTimeoutMs` ·
`storagePolicies` · `storageTriggers` · `baas` · `liveSchema` · `rlsAudit` ·
`history` in its object form (`{ maxEntries, ttlDays }`)

`schemaEditor` is forced off in a built bundle: the editor rewrites collection
*source* files, and a bundle holds compiled output.

## What Gets Created

After initialization, these routes are mounted:

| Path | Purpose |
|------|---------|
| `/api/auth/*` | Authentication (signup, login, refresh, OAuth, magic links, one-time codes, MFA) |
| `/api/admin/*` | User and role management (admin-only) |
| `/api/storage/*` | File upload, download, and deletion |
| `/api/data/:slug` | CRUD operations per collection (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Entity change history (when enabled) |
| `/api/docs` | OpenAPI spec (when `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (dev mode, when `enableSwagger: true`) |
| `/api/meta/contract` | The project's collection schema (admin-only) |
| `/api/meta/schema-version` | A version string for that schema (unauthenticated) |
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
    cronsDir?: string;         // Auto-load cron jobs from a directory
    cronPersistence?: boolean; // Write run logs to rebase.cron_logs (default: true)

    // HTTP behaviour
    compression?: boolean;     // gzip/deflate for API responses (default: true)
    maxBodySize?: number;      // Request-body ceiling in bytes (default: 10MB; 0 disables)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Schema editing
    schemaEditor?: boolean;   // Force the schema-editor routes on or off

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Five of those are easy to miss and change behaviour you can otherwise only
observe:

| Key | Default | What it does |
|---|---|---|
| `compression` | `true` | gzip/deflate on API responses, negotiated from `Accept-Encoding`. Already-compressed, streamed and `no-transform` bodies are left alone, so it is safe to leave on — a large JSON list typically drops by ~20x. Set `false` when nginx, Cloudflare or another proxy in front already compresses, to avoid paying twice. Environment: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Ceiling for request bodies on API routes; `0` disables it. Storage uploads use the storage config's own `maxFileSize` (50MB), which wins for those routes. Environment: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | off | **Opt-in.** A BaaS API is called by mobile apps, SPAs on other domains and CLI tools, none of which send an `Origin` a fixed list would accept — so this is not on by default. Turn it on with the origins your browser clients use. No environment form: eject to set it. |
| `cronPersistence` | `true` | Whether run logs reach `rebase.cron_logs`. `false` keeps the jobs running and the history in memory only, which the Studio panel then loses on restart. |
| `schemaEditor` | on outside production, when `collectionsDir` is set | Forces the schema-editor routes on or off. The editor rewrites collection *source files*, so it needs a directory to write to — and a built bundle has none, which is why a deployment never has it. |

The rest of `RebaseBackendConfig` is either documented on its own page (`auth`,
`storage`, `jobs`, `callbacks`, `liveSchema`, `rlsAudit`) or marked `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` and `runtimeVersion` are filled in by
`bootFromBundle` from the environment, and passing them by hand is a way to
disagree with the runtime about what this process is.

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
| `DELETE` | `/api/data/:slug/:id` | Delete a record |

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
`status`, `code` and `details` — including the failures that never reached a
server at all. A refused connection, a DNS failure, CORS or an abort arrives as
`status: 0`, `code: "NETWORK_ERROR"`, with the runtime's own error on `cause`,
rather than as whatever `fetch` felt like rejecting with. So application code
catches one class:

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
