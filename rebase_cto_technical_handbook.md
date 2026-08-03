# Rebase CTO Master Technical Handbook & Executive Reference Manual

> **Document Type**: Executive Technical Briefing & Architectural Specification  
> **Audience**: Chief Technology Officer (CTO), Principal Architects, Lead Engineers  
> **Scope**: Entire Rebase Engine Platform (`@rebasepro/*`)  
> **Status**: Authoritative & Unabridged  

---

## Executive Summary & Core Platform Vision

Rebase is a modern, TypeScript-native **Backend-as-a-Service (BaaS) and Content Management System (CMS)** designed to scale from zero-config database prototyping to high-throughput enterprise deployments.

### Core Architectural Philosophy

1. **Uncompromised Modularity (Pay-for-What-You-Use)**:
   Rebase is architected as a set of decoupled, role-specific packages. A pure BaaS backend deployment imports zero UI dependencies, zero React runtime code, and zero DOM abstractions.
2. **Schema-as-Code & Database Introspection Dual Engine**:
   Schema can be authored in declarative TypeScript collection files (CMS mode) or introspected directly from a PostgreSQL database at boot (BaaS mode).
3. **Database-Native Authorization (Fail-Closed RLS)**:
   On PostgreSQL, security rules defined in code compile directly to native `pg_policies` Row-Level Security (RLS). Authorization happens inside the database engine.
4. **Isomorphic, Universal Client**:
   A single `@rebasepro/client` SDK operates identically in Node.js, Edge Runtimes (Cloudflare Workers, Vercel Edge), React Native, and Web Browsers.
5. **Realtime-First Data Pipeline**:
   Built-in WebSocket synchronization combines instant client-side entity patches with debounced authoritative database refetches and multi-instance channel messaging.

---

## 1. Platform Adoption Modes & System Boundaries

Rebase supports three distinct adoption modes using the exact same underlying packages, wired according to application requirements.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             FULL MODE (CMS + Studio)                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                            CMS MODE (BaaS + CMS)                      │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                            BaaS MODE                            │  │  │
│  │  │  • REST / GraphQL Data APIs      • Auth, Storage, Realtime     │  │  │
│  │  │  • PostgreSQL Introspection     • Cron, Functions, Webhooks   │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │  • Declarative Collection Configs  • Admin UI (`@rebasepro/admin`)   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  • Rebase Studio (`@rebasepro/studio`) • SQL Editor & Schema Visualizer      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Adoption Modes Matrix

| Mode | Capability Set | Database Config | Comparable Technologies |
| :--- | :--- | :--- | :--- |
| **BaaS** | Auto-generated REST & GraphQL APIs, Auth, Storage, Realtime, Cron, Custom Functions, Webhooks, Backups. | **Zero collection files.** Introspected at boot from PostgreSQL `information_schema`. | Supabase, Firebase |
| **CMS** | All BaaS features + Schema-driven Admin UI generated from TypeScript collection definitions. | Collection definitions in `config/collections/`. | Payload CMS, Directus, Strapi |
| **Full** | All CMS features + Rebase Studio Developer Console (SQL Editor, Schema Visualizer, RLS Policy Manager, Logs). | Collection definitions + Studio Bridge. | Supabase + Payload |

---

## 2. Monorepo Architecture & Package Map

The Rebase monorepo enforces strict package boundaries.

### Package Topology

```
Shared Kernel
  └─ @rebasepro/types ──► @rebasepro/utils ──► @rebasepro/common ──► @rebasepro/client
          │
          ├────────────────────────────────────────┬───────────────────────────────────────┐
          ▼                                        ▼                                       ▼
    BaaS Backend                              CMS Frontend                             Full Console
  @rebasepro/server                       @rebasepro/admin-types                     @rebasepro/studio
  @rebasepro/server-postgres                       │                                  (Depends on client,
  @rebasepro/cli                          @rebasepro/ui, @rebasepro/forms             ui, app; optional admin)
  @rebasepro/codegen                               │
                                          @rebasepro/app, @rebasepro/admin
```

### Key Package Roles

| Package Name | Layer | Primary Responsibility | Dependency Restrictions |
| :--- | :--- | :--- | :--- |
| `@rebasepro/types` | Shared Kernel | Core data types, DataDriver interfaces, RLS policy builders, BaaS contract. | **ZERO UI/React dependencies.** Must not reference `React` or DOM types even in type positions. |
| `@rebasepro/admin-types` | CMS Kernel | Merges `admin` presentation fields into collection/property interfaces via declaration merging. | Extends `@rebasepro/types`. Depends on React type definitions. |
| `@rebasepro/client` | Shared Kernel | Isomorphic SDK for HTTP REST, GraphQL, and WebSocket realtime. | Isomorphic. Works in Node, Browser, Edge. Zero React/UI imports. |
| `@rebasepro/server` | BaaS Engine | Hono HTTP coordinator, REST API generator, auth pipeline, storage, cron, webhooks. | **Never imports React or frontend UI packages.** |
| `@rebasepro/server-postgres` | BaaS Engine | Drizzle ORM integration, PostgreSQL connection pooling, LISTEN/NOTIFY realtime. | Depends on `@rebasepro/server`. |
| `@rebasepro/app` | CMS Frontend | App root provider (`<Rebase>`), routing, layout shell, auth controllers. | Frontend tier. Depends on React. |
| `@rebasepro/admin` | CMS Frontend | Admin UI spreadsheet/table views, entity drawers, collection editor. | Frontend tier. |
| `@rebasepro/studio` | Studio Console | BaaS dev tools: SQL editor, RLS editor, schema visualizer, log viewer. | Talks to server via `@rebasepro/client`. `@rebasepro/admin` is an optional peer dependency. |

---

## 3. Automated Architectural Enforcement & CI Guards

To ensure architectural integrity, Rebase uses automated CI guards that execute before build steps:

1. **`pnpm run check:headless`**:
   Node.js custom loader hook that imports every backend package and collection file. Throws immediately if any module path reaches `react`, `react-dom`, or any frontend package (`@rebasepro/{admin,ui,app,studio,forms}`).
2. **`pnpm run check:types-headless`**:
   Static text analyzer that scans source files and built `.d.ts` declaration files for stray `import React` statements or `@types/react` dependencies in core packages.
3. **`pnpm run check:baas-types`**:
   Compiles a headless BaaS project against a stubbed React replacement to ensure zero compile-time coupling.
4. **`rebase doctor --policies`**:
   Diffs active `pg_policies` in PostgreSQL against what collection `securityRules` generate. Exits non-zero on policy drift.

---

## 4. TypeScript & Type Safety Guidelines

Rebase mandates strict type safety across all codebase contributions:

* **Zero `any` Tolerance**: Use explicit generics, unknown narrowing, or discriminated unions.
* **No Duck-Typing / Cast Workarounds**: Do not use structural casts (e.g., `driver as { executeSql?: ... }`).
* **Database Driver Type Guards**: When executing raw SQL on backend drivers, use the `isSQLAdmin` type guard from `@rebasepro/types`:
  ```typescript
  import { isSQLAdmin } from "@rebasepro/types";

  const driver = c.get("driver");
  const admin = driver?.admin;
  if (!isSQLAdmin(admin)) {
      throw new Error("Native SQL execution is not available on current driver.");
  }
  const results = await admin.executeSql(sql, params);
  ```
* **Declaration Merging for Admin Presentation**: Frontend admin properties are merged onto backend interfaces via TypeScript interface merging:
  ```typescript
  // config/admin.d.ts
  /// <reference types="@rebasepro/admin-types" />
  ```

---

## 5. Database Engine & Schema Pipeline

Rebase uses **PostgreSQL 14+** as its primary database and **Drizzle ORM** for type-safe query generation and migration execution.

```
Collection Definitions (TS) ──► rebase schema generate ──► Drizzle Schema (schema.generated.ts)
                                                                 │
                       ┌─────────────────────────────────────────┴─────────────────────────────────────────┐
                       ▼                                                                                   ▼
             Development Mode                                                                    Production Mode
             rebase db push                                                                     rebase db generate
     (Direct Schema & Policy Sync)                                                     (SQL Migration Files in ./drizzle)
                                                                                                           │
                                                                                                           ▼
                                                                                                   rebase db migrate
                                                                                              (Executes Pending SQL)
```

### Migration & Database Command Reference

| Command | Action | Runtime Context |
| :--- | :--- | :--- |
| `rebase schema generate` | Compiles collection configs into `schema.generated.ts` Drizzle schema. | Development / Build |
| `rebase schema introspect` | Reads PostgreSQL `information_schema` and outputs Rebase collection TypeScript files. | Legacy DB Onboarding |
| `rebase db push` | Pushes schema changes directly to DB and reconciles RLS policies. | Local Development |
| `rebase db generate` | Generates timestamped `.sql` migration files under `./drizzle/`. | CI / Production Prep |
| `rebase db migrate` | Executes unapplied SQL migration files against the target database. | CD / Production Deploy |

---

## 6. PostgreSQL Connection Architecture & Pooling

Rebase provides three connection strategies engineered for high-throughput production environments:

```
                          ┌────────────────────────────────────────────────────────┐
                          │                PostgreSQL Database                     │
                          └───────────────────────▲────────────────────────────────┘
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 │                                │                                │
                 │ Primary Pool                   │ Read Replica Pool              │ Direct Connection
                 │ (PgBouncer Transaction Mode)   │ (Read Load Distribution)       │ (Bypasses PgBouncer)
                 │ max: 20                        │ max: 10                        │ max: 5
                 │                                │                                │
    ┌────────────┴────────────┐      ┌────────────┴────────────┐      ┌────────────┴────────────┐
    │  `DATABASE_URL`         │      │ `DATABASE_READ_URL`     │      │ `DATABASE_DIRECT_URL`   │
    │  Data CRUD & Auth       │      │  Read-Only Queries      │      │ LISTEN/NOTIFY & Locks   │
    └─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘
```

1. **Primary Connection Pool (`createPostgresDatabaseConnection`)**:
   Standard connection pool for write operations and transaction-scoped reads.
2. **Read Replica Connection Pool (`createReadReplicaConnection`)**:
   Automatically instantiated when `DATABASE_READ_URL` is configured. Directs read-only queries away from the primary instance.
3. **Direct Connection (`createDirectDatabaseConnection`)**:
   Small, dedicated pool bypassing PgBouncer transaction pooling. Used exclusively for session-level features: `LISTEN/NOTIFY` realtime, advisory locking, and prepared statements.
4. **Dynamic Multi-Database Manager (`DatabasePoolManager`)**:
   Manages dynamic database connection pools on demand when `ADMIN_CONNECTION_STRING` is set. Powers database branching, tenant-per-database architectures, and isolated Studio SQL execution.

---

## 7. Multi-Layer Security Architecture

Rebase implements a **5-layer defense-in-depth security model**.

```
Client Request (REST / GraphQL / WebSocket)
   │
   ▼
Layer 1: Auth Middleware
   │  • Validates JWT / Service Key / API Key / Custom Auth
   │  • Scopes DataDriver via driver.withAuth(user)
   ▼
Layer 2: API Key Permission Guard
   │  • Checks per-collection, per-operation (read/write/delete) permissions
   ▼
Layer 3: Global Callbacks
   │  • Cross-cutting afterRead, beforeSave, beforeDelete on ALL data paths
   ▼
Layer 4: Scoped DataDriver (PostgreSQL RLS)
   │  • Executes SET LOCAL app.user_id, app.user_roles, app.jwt
   │  • Native Postgres RLS decides row visibility
   ▼
Layer 5: Collection Callbacks
      • Per-collection business validation & ownership hooks
```

### Identity Scoping Table

| Identity Source | `context.user.uid` | `context.user.roles` | Security Execution Behavior |
| :--- | :--- | :--- | :--- |
| **Authenticated JWT** | User ID (`uuid`) | Application Roles | Full RLS enforcement using user claims |
| **Service Key** | `"service"` | `["admin"]` | Bypasses RLS (Full Admin Access) |
| **Standard API Key** | `"api-key:{id}"` | `["service"]` | Bypasses RLS, scoped by API Key Permissions |
| **Admin API Key** | `"api-key:{id}"` | `["admin", "service"]` | Bypasses RLS, Full Admin Access |
| **Anonymous Request** | `"anon"` | `["anon"]` | RLS executed with anonymous identity |

### PostgreSQL Row-Level Security (RLS) Compilation

Collection `securityRules` are a **source for code generation**, compiled into `policies.sql` during `rebase db push` or `rebase db generate`.

#### Policy Hash Naming & Reconciliation
Policies without explicit names are generated as `<table>_<operation>_<semantic_hash>`. Editing a security rule changes its semantic hash, creating a new policy name. Rebase automatically drops obsolete generated policies during `db push` to prevent permissive policy leftover leakage.

---

## 8. Realtime Engine, Messaging & Multi-Instance Scaling

Rebase features a built-in WebSocket realtime engine providing data synchronization, broadcast messaging, and presence tracking.

```
Database Mutation (REST / SDK / SQL)
   │
   ▼
PostgreSQL LISTEN/NOTIFY ──► RealtimeService Fan-out
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
Phase 1: Instant Entity Patch                   Phase 2: Authoritative Refetch
`collection_entity_patch`                       `collection_update`
Sub-millisecond UI update                       Debounced 300ms query refresh
```

### Update Delivery Mechanics

1. **Phase 1 — Instant Entity Patch (`collection_entity_patch`)**:
   Immediately pushes a lightweight patch containing mutated entity values. Client SDK merges this patch into local cache for sub-millisecond perceived latency.
2. **Phase 2 — Debounced Authoritative Refetch (`collection_update`)**:
   After a 300ms debounce window (`REFETCH_DEBOUNCE_MS`), the server re-evaluates the query with filters, limits, and ordering against PostgreSQL to ensure correctness.

### Multi-Instance Realtime Scaling (`REALTIME_CHANNEL_BUS`)

Behind a load balancer, WebSocket connections land on different server instances. Rebase scales channel broadcasts and presence via the `REALTIME_CHANNEL_BUS`:

```typescript
createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres", batchWindowMs: 10 } // Coalesces notifications every 10ms
    }
});
```

* **`memory` (Default)**: Single-instance local memory bus.
* **`postgres`**: Multi-instance bus using PostgreSQL `LISTEN/NOTIFY`. Includes ~10ms window batching, reducing database notify overhead by up to **44×** under burst load.
* **Custom Transport**: Implements the `ChannelBus` interface from `@rebasepro/types` for custom message brokers.

### Channel History & Reconnect Catch-Up

Channels can be configured with retention rules to store messages in `rebase.channel_messages`:

```typescript
realtime: {
    channels: [
        { match: "doc:*", limit: 500, ttl: "24h" }
    ]
}
```

* **Sequence Tracking (`seq`)**: Monotonically increasing per-channel sequence numbers.
* **Catch-Up Replay**: Reconnecting clients pass `sinceSeq`. Missed messages are replayed in order before live broadcasts resume.
* **Deduplication**: SDK automatically drops duplicate sequence numbers.

### Presence Engine Mechanics

Presence tracks online users per channel.
* **30-Second Heartbeat Timeout (`PRESENCE_TIMEOUT_MS`)**: Clients must send `presence_track` heartbeats inside the 30s window. Stale presences are automatically reaped.
* **Diff vs. State**: `presence_diff` sends incremental joins/leaves. `presence_state` returns the full active roster.

---

## 9. Custom Extensions, Storage & Background Subsystems

### Custom API Functions
File-based route discovery scans `backend/src/functions/`:
```typescript
// backend/src/functions/checkout.ts
import { createFunction } from "@rebasepro/server";

export default createFunction((app) => {
    app.post("/checkout", async (c) => {
        const driver = c.get("driver"); // Scoped DataDriver
        return c.json({ status: "success" });
    });
});
```

### Cron Scheduler Engine
Scans `backend/src/crons/` for background jobs:
```typescript
import { createCron } from "@rebasepro/server";

export default createCron({
    name: "daily-cleanup",
    schedule: "0 0 * * *", // Daily at midnight
    handler: async ({ rebase }) => {
        await rebase.data.logs.deleteMany({ where: { created_at: ["<", "30d_ago"] } });
    }
});
```
Execution logs are persisted to database tables when `cronPersistence: true`.

### File Storage Subsystem
Supports `local`, `s3`, and `gcs` providers with TUS resumable upload protocol support.
* **Production Guard**: In production (`NODE_ENV=production`), `STORAGE_TYPE=local` causes startup failure unless `FORCE_LOCAL_STORAGE=true` is set.

### Outbound Webhooks Engine
Triggers HTTP POST payloads on entity mutations (`INSERT`, `UPDATE`, `DELETE`).
* **Security**: Signatures signed using HMAC-SHA256 with `X-Rebase-Signature`.
* **Reliability**: Exponential backoff retry loop for failed deliveries.

---

## 10. Frontend Architecture, Admin UI & Studio Console

### Frontend Composition Pattern

```tsx
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth />
    <RebaseAdmin collections={collections} />
    <RebaseStudio />
    <RebaseShell title="Rebase Console" />
</Rebase>
```

### Admin Modes & Role Simulation

1. **`developer` Mode**: Renders inline schema editing buttons, SQL inspect tools, and administrative drawers.
2. **`editor` Mode**: Hides developer tools, rendering the UI exactly as an end-user sees it.
3. **Effective Role Simulation (`EffectiveRoleController`)**: Enables developers in `developer` mode to simulate any role without logging out.

### Studio Bridge Architecture (`useStudioBridge`)

Rebase Studio communicates with the backend control plane via `@rebasepro/client`. When deployed alongside the Admin UI, the `StudioBridge` context enables jumping between database rows and CMS entity drawers without coupling Studio packages to Admin code.

---

## 11. Deployment, Infrastructure & Production Hardening

### Production Environment Validation (`loadEnv()`)

In `NODE_ENV=production`, `loadEnv()` enforces strict runtime security:
* **CORS Requirement**: `CORS_ORIGINS` or `FRONTEND_URL` must be explicitly defined.
* **Secrets Enforcement**: Ephemeral auto-generated secrets are disabled. `JWT_SECRET` and `REBASE_SERVICE_KEY` must be $\ge 32$ characters.
* **Localhost Prohibition**: Database, storage, and API URLs containing `localhost` or `127.0.0.1` cause startup abortion unless `ALLOW_LOCALHOST_IN_PRODUCTION=true`.

### SPA Serving Strategy (`serveSPA()`)

```typescript
if (env.NODE_ENV === "production") {
    serveSPA(app, {
        frontendPath: path.resolve(process.cwd(), "../frontend/dist"),
        basePath: "/",
        excludePaths: ["/health", "/ws", "/api"]
    });
}
```

---

## 12. CTO Executive Q&A & Defense Scenarios

### Q1: "Why Rebase over Supabase?"
> **CTO Answer**: Supabase is a database host with auto-generated APIs. Rebase is an application platform. Rebase gives you a unified schema-as-code layer in TypeScript, declarative collection files with frontend UI metadata, an embedded admin CMS, type-safe SDK generation, multi-mode deployment (BaaS, CMS, Full), and zero lock-in since it runs on standard PostgreSQL with Drizzle ORM.

### Q2: "Why Rebase over Payload CMS or Directus?"
> **CTO Answer**: Traditional CMS platforms bundle React into server dependencies, making them heavy, memory-intensive, and hard to run in serverless or edge environments. Rebase strictly separates its headless BaaS engine from the React frontend. A Rebase BaaS backend carries zero React dependencies, boots in milliseconds, and scales efficiently in containerized or serverless environments while maintaining full CMS UI capabilities when desired.

### Q3: "How does Rebase enforce security if database RLS is disabled or unavailable?"
> **CTO Answer**: Rebase uses a 5-layer security architecture. While Layer 4 relies on native PostgreSQL RLS, Layers 1–3 and Layer 5 operate entirely in the application layer. Global callbacks (`afterRead`, `beforeSave`, `beforeDelete`) execute on every read and write path—including REST, GraphQL, WebSockets, and server-side SDK calls—ensuring data redaction and ownership verification regardless of underlying database RLS support.

### Q4: "How does Rebase handle multi-instance WebSocket scaling behind a load balancer?"
> **CTO Answer**: Rebase includes a native PostgreSQL `LISTEN/NOTIFY` channel bus (`REALTIME_CHANNEL_BUS=postgres`). Instance nodes publish channel broadcasts and presence diffs to PostgreSQL, which fans out messages across all cluster nodes with a 10ms batching window. This eliminates the requirement for an external Redis broker while supporting high-throughput collaboration.

### Q5: "What happens during PgBouncer transaction pooling with Realtime or RLS?"
> **CTO Answer**: PgBouncer in transaction mode clears session variables between transactions and breaks session-level `LISTEN/NOTIFY`. Rebase solves this by maintaining three separate connection pools:
> 1. Primary pool for standard transactional CRUD.
> 2. Direct connection pool (`DATABASE_DIRECT_URL`) bypassing PgBouncer for `LISTEN/NOTIFY` realtime state.
> 3. Transaction-scoped RLS variable injection (`SET LOCAL app.user_id`), ensuring RLS session variables never bleed across pooled connections.

### Q6: "How do we prevent zero-day vulnerabilities from custom React UI components imported in collection files?"
> **CTO Answer**: Backend collection files use lazy import thunks (`admin: { Field: () => import("./MyComponent") }`) or string specifiers. The Node.js backend never evaluates or executes React component code. CI enforcement (`check:headless`) imports every collection file under a Node hook that fails if React or DOM libraries are loaded server-side.

### Q7: "How do we perform zero-downtime database schema migrations in production?"
> **CTO Answer**: Production deployment uses `rebase db generate` to inspect schema changes and produce timestamped SQL files in `./drizzle/`. These migrations are executed during CD rollout via `rebase db migrate` before container startup. Because Rebase works with Drizzle ORM, schema expansions (adding nullable columns or new tables) can be applied ahead of application deployment without breaking running backend nodes.

---

## 13. Summary Architecture Matrix for Quick Reference

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 REBASE CORE ARCHITECTURE                               │
├──────────────────────┬──────────────────────────────────┬──────────────────────────────┤
│ Subsystem            │ Tech Stack / Specification        │ Primary File / Location      │
├──────────────────────┼──────────────────────────────────┼──────────────────────────────┤
│ HTTP Gateway         │ Hono framework on Node HTTP      │ packages/server              │
│ ORM & Query Layer    │ Drizzle ORM + Node-Postgres (pg) │ packages/server-postgres     │
│ Shared Types         │ TypeScript (Zero UI deps)        │ packages/types               │
│ Client SDK           │ Isomorphic Fetch + WebSocket WS  │ packages/client              │
│ Admin Frontend UI    │ React + Tailwind/Vanilla CSS     │ packages/admin               │
│ Developer Console    │ Rebase Studio                    │ packages/studio              │
│ Realtime Engine      │ WS + Postgres LISTEN/NOTIFY      │ packages/server-postgres     │
│ Storage Subsystem    │ Local / AWS S3 / GCS (TUS)       │ packages/server              │
└──────────────────────┴──────────────────────────────────┴──────────────────────────────┘
```

***
*End of Rebase CTO Master Technical Handbook.*
