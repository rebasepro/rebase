---
name: rebase-security
description: Comprehensive guide to the Rebase backend security architecture. Use this skill when the user asks about securing their application, backend-level access control, request interception, DataHooks for security, fail-closed design, or how security works without database-level RLS. Also use when the user needs to implement PII masking, tenant isolation, role-based access control at the API layer, or cross-cutting security concerns.
---

# Rebase Security Architecture

Rebase implements a **multi-layered, defense-in-depth** security architecture. Security is enforced at the **application level** — not just at the database level. This means your data is protected regardless of whether the underlying database supports native Row-Level Security (RLS) or not.

> **IMPORTANT FOR AGENTS:** Always read the `rebase-basics` and `rebase-auth` skills for auth configuration details. This skill focuses on the **security architecture** and **backend-level enforcement mechanisms**.

## Table of Contents

- [Security Architecture Overview](#security-architecture-overview)
- [Request Pipeline](#request-pipeline)
- [Layer 1: Auth Middleware](#layer-1-auth-middleware)
- [Layer 2: API Key Permission Guard](#layer-2-api-key-permission-guard)
- [Layer 3: DataHooks (API Boundary)](#layer-3-datahooks-api-boundary)
- [Layer 4: Scoped DataDriver](#layer-4-scoped-datadriver)
- [Layer 5: Collection Callbacks](#layer-5-collection-callbacks)
- [Fail-Closed Design](#fail-closed-design)
- [Securing Without Database RLS](#securing-without-database-rls)
- [Common Security Patterns](#common-security-patterns)
- [Security Checklist](#security-checklist)
- [References](#references)

---

## Security Architecture Overview

Every request — REST, GraphQL, and WebSocket — passes through **5 security layers** before data is returned to the client. These layers are enforced at the **application level** and work independently of any database-native security mechanism.

```
┌──────────────────────────────────────────────────────┐
│                    CLIENT REQUEST                     │
│              (REST / GraphQL / WebSocket)             │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Layer 1: Auth Middleware                            │
│  JWT / Service Key / API Key / Custom AuthAdapter    │
│  → Identifies user, scopes the DataDriver            │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Layer 2: API Key Permission Guard                   │
│  Per-collection, per-operation permission check      │
│  (only for API key requests)                         │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Layer 3: DataHooks (API Boundary)                   │
│  Cross-cutting interception for ALL collections      │
│  afterRead / beforeSave / beforeDelete               │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Layer 4: Scoped DataDriver                          │
│  driver.withAuth(user) — applies RLS policies        │
│  (PostgreSQL: SET LOCAL session vars + native RLS)   │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Layer 5: Collection Callbacks (Per-Collection)      │
│  beforeSave / afterRead / beforeDelete               │
│  Per-collection hooks inside the DataDriver          │
└──────────────────────────────────────────────────────┘
```

> **KEY INSIGHT:** Layers 1–3 and Layer 5 are **application-level** — they don't depend on the database. Even if you cannot configure database-level RLS policies, these layers provide full security coverage.

---

## Request Pipeline

All three protocols share the same security middleware stack:

### REST
```
HTTP Request → Auth Middleware → API Key Guard → DataHooks → Scoped Driver → Collection Callbacks → Response
```

### GraphQL
```
GraphQL Request → Auth Middleware → API Key Guard → Scoped Driver → Collection Callbacks → Response
```
GraphQL shares the same Hono middleware chain as REST. Resolvers extract the scoped driver from context and throw if unavailable.

### WebSocket
```
WS Connect → AUTHENTICATE message → Token Verification → Per-Operation Scoped Driver → Response
```
WebSocket auth follows a message-based flow:
1. Client sends an `AUTHENTICATE` message with a JWT token.
2. Token is verified via `extractUserFromToken(token)`.
3. Session is marked as authenticated.
4. Each subsequent data operation calls `getScopedDelegate()` to create a user-scoped driver.
5. Admin-only operations (e.g., `EXECUTE_SQL`) require `isAdminSession()`.
6. Rate limiting: 2000 messages per 60 seconds.

---

## Layer 1: Auth Middleware

The auth middleware is the **first line of defense**. It runs on every request and does two things:

1. **Identifies the user** — Extracts credentials from the `Authorization` header (JWT, service key, API key, or custom adapter).
2. **Scopes the DataDriver** — Calls `scopeDataDriver(driver, user)` which invokes `driver.withAuth(user)` to return a security-scoped clone.

The scoped driver is placed into `c.set("driver", scopedDriver)`. The raw, unscoped driver is **never** placed in the request context.

### How Scoping Works

```typescript
// From packages/server-core/src/auth/rls-scope.ts
export async function scopeDataDriver(
    driver: DataDriver,
    user: { uid: string; roles?: string[] }
): Promise<DataDriver> {
    if (isRLSScopedDriver(driver)) {
        // Fail closed — if withAuth() throws, the request is DENIED
        return await driver.withAuth(user);
    }
    return driver;
}
```

### Identity Types

| Auth Method | `uid` | `roles` | RLS Behavior |
|---|---|---|---|
| JWT (authenticated user) | User's ID | User's app roles | Full RLS enforcement |
| Service Key | `"service"` | `["admin"]` | Bypasses RLS (admin access) |
| API Key (default) | `"api-key:{id}"` | `["service"]` | Bypasses RLS, scoped by permissions |
| API Key (admin) | `"api-key:{id}"` | `["admin", "service"]` | Bypasses RLS, full admin access |
| Anonymous (`requireAuth: false`) | `"anon"` | `["anon"]` | RLS with anonymous identity |
| No token + `requireAuth: true` | — | — | **Rejected (401)** |

> **IMPORTANT FOR AGENTS:** These are **reserved system identity values** that the middleware injects automatically. When writing DataHooks or Collection Callbacks, developers should use these identities to gate behavior:
> - `uid: "service"` + `roles: ["admin"]` — Server-side `rebase.data` calls (cron jobs, custom functions using `rebase.data`, webhooks). These go through the full middleware pipeline authenticated with the service key.
> - `uid: "anon"` + `roles: ["anon"]` — Unauthenticated requests when `requireAuth: false`. **Note:** for anonymous REST requests, `context.user` in Collection Callbacks may be `undefined`; only the DataDriver is scoped with the anon identity. For WebSocket connections, a full `User` object with `uid: "anon"` is provided.
> - `uid: "api-key:{id}"` + `roles: ["service"]` (or `["admin", "service"]`) — API key requests.
> - Real user IDs and roles for JWT-authenticated requests.
>
> **Key insight:** `rebase.data` (the server-side singleton) is NOT a raw admin driver — it round-trips through the REST API using the service key, so all DataHooks and Collection Callbacks fire with `uid: "service"`, `roles: ["admin"]`. This means callbacks can distinguish server-internal reads from end-user reads by checking `context.user?.roles?.includes("admin")`.

---

## Layer 2: API Key Permission Guard

When a request is authenticated via an API key (prefixed `rk_`), the permission guard enforces **per-collection, per-operation** access control:

```typescript
interface ApiKeyPermission {
    collection: string;        // Collection slug, or "*" for all
    operations: ("read" | "write" | "delete")[];
}
```

- `GET` → requires `"read"` permission
- `POST` / `PUT` / `PATCH` → requires `"write"` permission
- `DELETE` → requires `"delete"` permission

This layer runs in both REST and GraphQL. If the API key lacks the required permission, the request is rejected with **403 Forbidden**.

---

## Layer 3: DataHooks (API Boundary)

DataHooks are the **primary mechanism for backend-level security** when you cannot or do not want to use database-level RLS. They intercept **all** collection operations at the REST API boundary — a single cross-cutting point for every collection.

### Configuration

DataHooks are configured via the `hooks` property of `initializeRebaseBackend()`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server-core";
import type { BackendHooks, BackendHookContext } from "@rebasepro/types";

const hooks: BackendHooks = {
    data: {
        // Intercept ALL reads across ALL collections
        afterRead(slug, snapshot, ctx) {
            // Return snapshot to allow, return null to filter out
        },

        // Intercept ALL writes across ALL collections
        beforeSave(slug, values, snapshotId, ctx) {
            // Return values to allow, throw to reject
        },

        // Intercept ALL deletes across ALL collections
        beforeDelete(slug, snapshotId, ctx) {
            // Return void to allow, throw to reject
        },

        // Post-write side effects
        afterSave(slug, snapshot, ctx) { /* fire-and-forget */ },
        afterDelete(slug, snapshotId, ctx) { /* fire-and-forget */ },
    },
};

await initializeRebaseBackend({
    server,
    app,
    database: createPostgresAdapter({ connection: db, schema }),
    auth: { jwtSecret: "...", /* ... */ },
    hooks,  // ← Backend-level security hooks
});
```

### DataHooks Interface

```typescript
interface DataHooks {
    afterRead?(slug: string, snapshot: Record<string, unknown>, context: BackendHookContext):
        Record<string, unknown> | null | Promise<Record<string, unknown> | null>;

    beforeSave?(slug: string, values: Record<string, unknown>, snapshotId: string | undefined, context: BackendHookContext):
        Record<string, unknown> | Promise<Record<string, unknown>>;

    afterSave?(slug: string, snapshot: Record<string, unknown>, context: BackendHookContext):
        void | Promise<void>;

    beforeDelete?(slug: string, snapshotId: string, context: BackendHookContext):
        void | Promise<void>;

    afterDelete?(slug: string, snapshotId: string, context: BackendHookContext):
        void | Promise<void>;
}

interface BackendHookContext {
    requestUser?: { userId: string; roles: string[] };
    method: "GET" | "POST" | "PUT" | "DELETE";
}
```

### Blocking vs Fire-and-Forget

| Hook | Can Block? | How to Block |
|---|---|---|
| `afterRead` | Yes | Return `null` to filter out the snapshot |
| `beforeSave` | Yes | Throw an error to abort the save |
| `beforeDelete` | Yes | Throw an error to prevent deletion |
| `afterSave` | No | Fire-and-forget (errors are caught and logged) |
| `afterDelete` | No | Fire-and-forget |

### Execution Order

DataHooks run **after** per-collection `CollectionCallbacks` (which execute inside the DataDriver, closer to the database) and **before** the API response is sent to the client. This gives you two opportunities to enforce security:

1. **CollectionCallbacks** — per-collection, inside the driver
2. **DataHooks** — cross-cutting, at the API boundary

---

## Layer 4: Scoped DataDriver

The scoped DataDriver is the layer where database-level RLS is enforced. For PostgreSQL, `withAuth()` wraps every operation in a transaction with session variables:

```sql
SELECT
    set_config('app.user_id', :userId, true),
    set_config('app.user_roles', :rolesString, true),
    set_config('app.jwt', :jwtClaims, true)
```

PostgreSQL RLS policies use `auth.uid()`, `auth.roles()`, and `auth.jwt()` to read these session variables and enforce row-level access control.

> **IMPORTANT:** This layer is database-specific. If your project does not use PostgreSQL RLS, security is still enforced by Layers 1–3 and Layer 5. See [Securing Without Database RLS](#securing-without-database-rls).

---

## Layer 5: Collection Callbacks

Collection callbacks are per-collection lifecycle hooks that run **inside** the DataDriver, close to the database. They provide collection-specific security enforcement:

```typescript
const ordersCollection: PostgresCollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    callbacks: {
        beforeSave: async ({ values, context }) => {
            // Enforce business rule: only admins can set high-value orders
            const user = context.user;
            if (values.total > 10000 && !user?.roles?.includes("admin")) {
                throw new Error("High-value orders require admin approval");
            }
            return values;
        },
        beforeDelete: async ({ row, context }) => {
            // Prevent deletion of fulfilled orders
            if (row.status === "fulfilled") {
                throw new Error("Cannot delete fulfilled orders");
            }
        },
    },
    properties: { /* ... */ }
};
```

For full documentation on collection callbacks, see the `rebase-collections` skill.

---

## Fail-Closed Design

Rebase follows a **fail-closed** security model throughout the stack:

1. **Scoped driver or nothing** — The REST API's `getScopedDriver()` throws if no scoped driver is available. It **never** falls back to the unscoped driver:
   ```typescript
   private getScopedDriver(c): DataDriver {
       const driver = c.get("driver") as DataDriver | undefined;
       if (!driver) throw ApiError.internal("Scoped driver not available");
       return driver;
   }
   ```

2. **RLS scoping failures are fatal** — If `driver.withAuth()` throws, the error propagates and the request is rejected with 500. The system does not silently skip RLS.

3. **Unauthenticated requests are rejected** — When `requireAuth: true` (the default), requests without a valid token receive 401. The unscoped driver never reaches the handler.

4. **API keys with missing permissions are rejected** — If an API key lacks the required permission for a collection/operation, the request is rejected with 403.

---

## Securing Without Database RLS

If you cannot modify database-level RLS policies — or your database doesn't support them — use **DataHooks** and **Collection Callbacks** to enforce security entirely at the application level.

### Strategy: DataHooks as Your Security Layer

```typescript
import { ApiError } from "@rebasepro/server-core";
import type { BackendHooks, BackendHookContext } from "@rebasepro/types";

const hooks: BackendHooks = {
    data: {
        // ── READ SECURITY ──
        // Filter snapshots based on user role and ownership
        afterRead(slug, snapshot, ctx) {
            const user = ctx.requestUser;

            // Admins see everything
            if (user?.roles.includes("admin")) return snapshot;

            // For the "orders" collection, users only see their own
            if (slug === "orders") {
                if (snapshot.user_id !== user?.userId) return null;
            }

            // For "internal_notes", non-admins never see them
            if (slug === "internal_notes") return null;

            return snapshot;
        },

        // ── WRITE SECURITY ──
        // Validate and enforce ownership on creates/updates
        beforeSave(slug, values, snapshotId, ctx) {
            const user = ctx.requestUser;
            if (!user) throw ApiError.unauthorized("Authentication required");

            // Enforce ownership: stamp the user_id on creation
            if (!snapshotId) {
                values.user_id = user.userId;
            }

            // Prevent role escalation: non-admins can't set role fields
            if (!user.roles.includes("admin")) {
                delete values.role;
                delete values.is_admin;
            }

            return values;
        },

        // ── DELETE SECURITY ──
        // Only admins can delete, or owners of their own records
        beforeDelete(slug, snapshotId, ctx) {
            const user = ctx.requestUser;
            if (!user) throw ApiError.unauthorized("Authentication required");

            if (!user.roles.includes("admin")) {
                // For non-admins, you may need to fetch the snapshot first
                // to verify ownership. Use Collection Callbacks for this pattern
                // since they receive the full snapshot.
                throw ApiError.forbidden("Only admins can delete records");
            }
        },
    },
};
```

### Strategy: Collection Callbacks for Ownership Checks

Collection Callbacks receive the full snapshot data, making them ideal for ownership verification on deletes and updates:

```typescript
const ordersCollection: PostgresCollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    callbacks: {
        beforeSave: async ({ values, id, context, previousValues }) => {
            const user = context.user;
            if (!user) throw new Error("Unauthorized");

            // On update, verify the current user owns this order
            if (id && previousValues) {
                if (previousValues.user_id !== user.uid && !user.roles?.includes("admin")) {
                    throw new Error("You can only edit your own orders");
                }
            }

            // On create, stamp ownership
            if (!id) {
                values.user_id = user.uid;
            }

            return values;
        },

        beforeDelete: async ({ row, context }) => {
            const user = context.user;
            if (!user) throw new Error("Unauthorized");

            if (row.user_id !== user.uid && !user.roles?.includes("admin")) {
                throw new Error("You can only delete your own orders");
            }
        },
    },
    properties: { /* ... */ }
};
```

### Combining Both Layers

For maximum security, use both DataHooks and Collection Callbacks together:

| Concern | Best Layer | Why |
|---|---|---|
| Cross-cutting read filtering | DataHooks `afterRead` | Applies to ALL collections in one place |
| Cross-cutting write validation | DataHooks `beforeSave` | Single enforcement point for all writes |
| PII masking / field redaction | DataHooks `afterRead` | Cross-cutting, role-based |
| Ownership checks on writes/deletes | Collection Callbacks | Has access to the full snapshot for comparison |
| Business rule validation | Collection Callbacks | Collection-specific, typed values |
| Audit logging | DataHooks `afterSave` / `afterDelete` | Cross-cutting, fire-and-forget |

---

## Common Security Patterns

### PII Masking

```typescript
const hooks: BackendHooks = {
    data: {
        afterRead(slug, snapshot, ctx) {
            if (ctx.requestUser?.roles.includes("admin")) return snapshot;

            // Mask sensitive fields across all collections
            if (snapshot.email) snapshot.email = "***@***.***";
            if (snapshot.phone) snapshot.phone = "***-***-****";
            if (snapshot.ssn) snapshot.ssn = "***-**-****";

            return snapshot;
        },
    },
};
```

### Tenant Isolation (Multi-Tenancy)

```typescript
const hooks: BackendHooks = {
    data: {
        afterRead(slug, snapshot, ctx) {
            const userTenantId = ctx.requestUser?.roles
                .find(r => r.startsWith("tenant:"))
                ?.replace("tenant:", "");

            if (!userTenantId) return null;
            if (snapshot.tenant_id !== userTenantId) return null;

            return snapshot;
        },

        beforeSave(slug, values, snapshotId, ctx) {
            const userTenantId = ctx.requestUser?.roles
                .find(r => r.startsWith("tenant:"))
                ?.replace("tenant:", "");

            if (!userTenantId) throw ApiError.forbidden("No tenant assigned");

            // Stamp tenant on creation, prevent cross-tenant writes
            if (!snapshotId) {
                values.tenant_id = userTenantId;
            }

            return values;
        },

        beforeDelete(slug, snapshotId, ctx) {
            // Tenant isolation on deletes is best handled in Collection Callbacks
            // where you have access to the snapshot's tenant_id
        },
    },
};
```

### Role-Based Collection Access

```typescript
const hooks: BackendHooks = {
    data: {
        // Define which roles can access which collections
        beforeSave(slug, values, snapshotId, ctx) {
            const roleAccess: Record<string, string[]> = {
                "financial_reports": ["admin", "finance"],
                "hr_records": ["admin", "hr"],
                "system_config": ["admin"],
            };

            const allowedRoles = roleAccess[slug];
            if (allowedRoles) {
                const userRoles = ctx.requestUser?.roles || [];
                const hasAccess = allowedRoles.some(r => userRoles.includes(r));
                if (!hasAccess) {
                    throw ApiError.forbidden(`Insufficient permissions for ${slug}`);
                }
            }

            return values;
        },

        afterRead(slug, snapshot, ctx) {
            const roleAccess: Record<string, string[]> = {
                "financial_reports": ["admin", "finance"],
                "hr_records": ["admin", "hr"],
                "system_config": ["admin"],
            };

            const allowedRoles = roleAccess[slug];
            if (allowedRoles) {
                const userRoles = ctx.requestUser?.roles || [];
                if (!allowedRoles.some(r => userRoles.includes(r))) return null;
            }

            return snapshot;
        },
    },
};
```

### Immutable Records (Soft Delete Only)

```typescript
const hooks: BackendHooks = {
    data: {
        beforeDelete(slug, snapshotId, ctx) {
            const immutableCollections = ["audit_logs", "transactions", "invoices"];
            if (immutableCollections.includes(slug)) {
                throw ApiError.forbidden(
                    `Records in "${slug}" cannot be deleted. Use soft-delete instead.`
                );
            }
        },

        beforeSave(slug, values, snapshotId, ctx) {
            const appendOnlyCollections = ["audit_logs"];
            if (appendOnlyCollections.includes(slug) && snapshotId) {
                throw ApiError.forbidden(
                    `Records in "${slug}" are append-only and cannot be updated.`
                );
            }
            return values;
        },
    },
};
```

---

## Security Checklist

Use this checklist when setting up security for a Rebase project:

- [ ] **Auth is configured** — `auth.jwtSecret` is set with a strong secret (≥ 32 chars)
- [ ] **`requireAuth` is `true`** — The default. Only set to `false` if you explicitly need unauthenticated access
- [ ] **Service key is set** — `auth.serviceKey` with ≥ 32 chars for server-to-server auth
- [ ] **Default role is NOT admin** — `auth.defaultRole` must never be `"admin"` (startup error)
- [ ] **DataHooks enforce access control** — If not using database RLS, `hooks.data` enforces read/write/delete permissions
- [ ] **Sensitive fields are masked** — `afterRead` masks PII for non-admin users
- [ ] **Ownership is enforced** — `beforeSave` stamps `user_id` on creation; Collection Callbacks verify ownership on update/delete
- [ ] **API keys are scoped** — API keys have minimal permissions (specific collections + operations)
- [ ] **API keys are never client-side** — API keys bypass RLS; only use server-side
- [ ] **CORS is configured** — Restrict origins in production
- [ ] **Rate limiting is in place** — Default limiters apply to auth endpoints; add custom limiters for sensitive operations

---

## References

- **RLS Scope**: `packages/server-core/src/auth/rls-scope.ts` — `scopeDataDriver()` implementation
- **Auth Middleware**: `packages/server-core/src/auth/middleware.ts` — JWT/service key/API key middleware
- **Adapter Middleware**: `packages/server-core/src/auth/adapter-middleware.ts` — Custom auth adapter middleware
- **API Key Guard**: `packages/server-core/src/auth/api-keys/api-key-permission-guard.ts`
- **REST API Generator**: `packages/server-core/src/api/rest/api-generator.ts` — DataHooks integration
- **Backend Hooks Types**: `packages/types/src/types/backend_hooks.ts` — `DataHooks`, `BackendHooks` interfaces
- **Backend Init**: `packages/server-core/src/init.ts` — `hooks` config property
- **Reserved Identity Values**: See Identity Types table above — `"service"`, `"anon"`, `"api-key:{id}"` are system-assigned identities in `context.user` / `ctx.requestUser`
- **Collection Callbacks**: See `rebase-collections` skill → Collection Callbacks section
- **Auth Configuration**: See `rebase-auth` skill → Server-Side Configuration section
