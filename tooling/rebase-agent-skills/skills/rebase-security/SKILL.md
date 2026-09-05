---
name: rebase-security
description: Comprehensive guide to the Rebase backend security architecture. Use this skill when the user asks about securing their application, how Row-Level Security is the enforcement point, backend-level access control, request interception, global callbacks, or fail-closed design. Also use when the user needs to implement PII masking, tenant isolation, role-based access control, or cross-cutting security concerns.
---

# Rebase Security Architecture

**Authorization is PostgreSQL Row-Level Security.** Every authenticated request
runs as the `rebase_user` role, which holds table grants precisely so that RLS —
not the grant — decides which rows it may see. A table with RLS disabled has no
authorization model at all, so Rebase **does not serve it**, and says so at boot.

Everything below is **defense in depth on top of that**, not a substitute for it.
The application layers authenticate the caller, scope the driver, enforce API-key
permissions and let you mask or reject at the edges — but the answer to "who can
read this row" comes from a policy in the database, and it holds for anything
that reaches the database, this framework included.

Read that as the correction it is: an earlier version of this page said security
worked "regardless of whether the underlying database supports native RLS". For
the Postgres product that is not true, and an agent that believed it would write
application checks in place of policies and ship a table Rebase refuses to
serve.

> **IMPORTANT FOR AGENTS:** Always read the `rebase-basics` and `rebase-auth` skills for auth configuration details. This skill focuses on the **security architecture** and **backend-level enforcement mechanisms**.

## Table of Contents

- [Security Architecture Overview](#security-architecture-overview)
- [Request Pipeline](#request-pipeline)
- [Layer 1: Auth Middleware](#layer-1-auth-middleware)
- [Layer 2: API Key Permission Guard](#layer-2-api-key-permission-guard)
- [Layer 3: Global callbacks (every data path)](#layer-3-global-callbacks-every-data-path)
- [Layer 4: Scoped DataDriver](#layer-4-scoped-datadriver)
- [Layer 5: Collection Callbacks](#layer-5-collection-callbacks)
- [Fail-Closed Design](#fail-closed-design)
- [When the database cannot enforce it](#when-the-database-cannot-enforce-it)
- [Common Security Patterns](#common-security-patterns)
- [Security Checklist](#security-checklist)
- [References](#references)

---

## Security Architecture Overview

Every request — REST and WebSocket — passes through **5 application layers** before it reaches the database, where RLS makes the row-level decision. The layers below are what the framework does with the caller's identity on the way in; they narrow what is asked for, and they never widen what the database will return.

```
┌──────────────────────────────────────────────────────┐
│                    CLIENT REQUEST                     │
│                  (REST / WebSocket)                   │
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
│  Layer 3: Global callbacks (every data path)         │
│  Cross-cutting, for ALL collections                  │
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

> **KEY INSIGHT:** Layers 1–3 and Layer 5 are **application-level** — they don't depend on the database. They are what secures a backend whose database has no native RLS.
>
> **But on Postgres, RLS is the authorization model, and Layer 4 is where it happens.** A collection's `securityRules` are a *source for code generation* — `db push` turns them into `pg_policies` — and nothing on the data path reads them at runtime. The application layers redact and validate; only the database decides who may see a row, and only it still applies when a cron, psql, or the SQL editor reaches the table. `rebase doctor --policies` diffs the deployed policies against what your collections generate, because a stale policy outlives any config fix.

---

## Request Pipeline

All three protocols share the same security middleware stack:

### REST
```
HTTP Request → Auth Middleware → API Key Guard → Scoped Driver → global callbacks → collection callbacks → property callbacks → Response
```

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
// From packages/server/src/auth/rls-scope.ts
type RLSScopedDriver = DataDriver & {
    withAuth(user: { uid: string; roles?: string[] }): Promise<DataDriver>;
};

function isRLSScopedDriver(driver: DataDriver): driver is RLSScopedDriver {
    return "withAuth" in driver && typeof (driver as Record<string, unknown>).withAuth === "function";
}

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
| Service Key | `"service"` | `["admin"]` | **RLS is enforced**, against the `admin` role |
| API Key (default) | `"api-key:{id}"` | `["service"]` | **RLS is enforced**, against the `service` role, *and* the key's permission list |
| API Key (admin) | `"api-key:{id}"` | `["admin", "service"]` | **RLS is enforced**, against the `admin` role, *and* the key's permission list |
| Anonymous (`requireAuth: false`) | `"anon"` | `["anon"]` | RLS with anonymous identity |
| No token + `requireAuth: true` | — | — | **Rejected (401)** |

> **IMPORTANT FOR AGENTS: none of these identities bypasses RLS.** Every one of
> them runs inside a transaction that has done `SET LOCAL ROLE rebase_user` with
> `app.uid` set, so the policies are *evaluated* — the admin-roled identities
> merely clear the built-in default policies through their
> `rolesOverlap(['admin'])` arm. Two consequences worth knowing before you
> design around them:
>
> - `policy.serverContext()` compiles to `rebase.uid() IS NULL` and is therefore
>   **false** for all of them. A collection with `disableDefaultPolicies: true`
>   whose only rule is `serverContext()` denies these writes (`42501`) and
>   returns zero rows — HTTP 200, empty — for these reads.
> - A non-admin API key with `"*"` permissions can still read nothing. That is
>   RLS working: grant the `service` role in the collection's security rules, or
>   use an admin key.
>
> The one genuine, unconditional bypass is `rebase.sql()`, which runs on the
> owner connection and never goes through `withAuth`. Of the accessors on the
> server singleton, the quieter one is the more privileged.

> **IMPORTANT FOR AGENTS:** These are **reserved system identity values** that the middleware injects automatically. When writing callbacks, developers should use these identities to gate behavior:
> - `uid: "service"` + `roles: ["admin"]` — server-side `rebase.dataAsAdmin` calls (cron jobs, custom functions, webhooks). The driver is scoped with this identity once, at boot.
> - `uid: "anon"` + `roles: ["anon"]` — Unauthenticated requests when `requireAuth: false`. **Note:** for anonymous REST requests, `context.user` in Collection Callbacks may be `undefined`; only the DataDriver is scoped with the anon identity. For WebSocket connections, a full `User` object with `uid: "anon"` is provided.
> - `uid: "api-key:{id}"` + `roles: ["service"]` (or `["admin", "service"]`) — API key requests.
> - Real user IDs and roles for JWT-authenticated requests.
>
> **Key insight:** `rebase.dataAsAdmin` is not a raw admin driver either. It is the native DataDriver scoped as `{ uid: "service", roles: ["admin"] }`, so RLS is still evaluated and callbacks still fire — they live in the driver, not at the route boundary. Callbacks can therefore distinguish server-internal reads from end-user ones by checking `context.user?.roles?.includes("admin")`.

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

This layer runs on every REST request. If the API key lacks the required permission, the request is rejected with **403 Forbidden**.

---

## Layer 3: Global callbacks (every data path)

Global callbacks are the **primary mechanism for backend-level security** when you cannot or do not want to use database-level RLS. They apply to **every** collection — a single cross-cutting point — and, unlike an API-boundary interceptor, they fire on *every* data path: REST, WebSocket/realtime, and server-side `rebase.dataAsAdmin`. There is no read path that bypasses `afterRead`, which is what makes it safe to rely on for redaction.

### Configuration

They are configured via the `callbacks` property of `initializeRebaseBackend()`, and take the **same** `CollectionCallbacks` type as a per-collection `callbacks` block:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import type { CollectionCallbacks } from "@rebasepro/types";

const callbacks: CollectionCallbacks = {
    // Every read, across every collection.
    // Return the row; redact by returning a modified copy.
    afterRead({ row, collection, path, context }) {
        return row;
    },

    // Every write. Return the values to save, or throw to reject.
    // Runs after schema validation.
    beforeSave({ values, id, collection, context }) {
        return values;
    },

    // Every delete. Throw to prevent it.
    beforeDelete({ id, collection, context }) { /* ... */ },

    // Post-write side effects.
    afterSave({ id, values, collection, context }) { /* ... */ },
    afterDelete({ id, collection, context }) { /* ... */ },
};

await initializeRebaseBackend({
    server,
    app,
    database: createPostgresAdapter({ connection: db, schema }),
    auth: { jwtSecret: "...", /* ... */ },
    callbacks,  // ← global, applied to every collection
});
```

> **FOR AGENTS:** callbacks take a **single props object**, not positional
> arguments, and the read payload is a flat `row` — not an `Entity`. `Entity` is
> an admin-UI view model and never reaches this layer.

### CollectionCallbacks Interface

```typescript
import type { User } from "@rebasepro/types";

type CollectionCallbacks<M extends Record<string, unknown>, USER extends User> = {
    afterRead?(props: AfterReadProps<M, USER>):
        Promise<Record<string, unknown>> | Record<string, unknown>;

    beforeSave?(props: BeforeSaveProps<M, USER>):
        Promise<Partial<EntityValues<M>>> | Partial<EntityValues<M>>;

    afterSave?(props: AfterSaveProps<M, USER>): Promise<void> | void;
    afterSaveError?(props: AfterSaveErrorProps<M, USER>): Promise<void> | void;
    beforeDelete?(props: BeforeDeleteProps<M, USER>): Promise<boolean | void> | boolean | void;
    afterDelete?(props: AfterDeleteProps<M, USER>): Promise<void> | void;
};

interface AfterReadProps<M extends Record<string, unknown>, USER extends User> {
    collection: CollectionConfig<M>;
    path: string;
    row: Record<string, unknown>;
    context: RebaseCallContext<USER>;
}

// AfterSaveProps adds `id` and `values`; BeforeSaveProps is the same with `id` optional
// (there is no id yet on a create).
```

### Blocking vs Fire-and-Forget

| Callback | Can Block? | How to Block |
|---|---|---|
| `beforeSave` | Yes | Throw an error to abort the save (returns an HTTP error) |
| `beforeDelete` | Yes | Throw an error to prevent deletion |
| `afterRead` | Redacts, does not block | Return a modified `row`. It returns a row, not `null` — filter rows out with RLS, not here |
| `afterSave` | No | Post-write side effect |
| `afterSaveError` | No | Fires when a save fails |
| `afterDelete` | No | Post-delete side effect |

### Execution Order

**global callbacks → collection callbacks → property callbacks.**

The global block you pass to `initializeRebaseBackend` runs first, then any
`callbacks` declared on the collection itself, then per-property ones. All three
are the same mechanism at different scopes, which is why they share one type.

---

## Layer 4: Scoped DataDriver

The scoped DataDriver is the layer where database-level RLS is enforced. For PostgreSQL, `withAuth()` wraps every operation in a transaction with session variables:

```sql
SELECT
    set_config('app.user_id', :userId, true),
    set_config('app.user_roles', :rolesString, true),
    set_config('app.jwt', :jwtClaims, true)
```

PostgreSQL RLS policies use `rebase.uid()`, `rebase.roles()`, and `rebase.jwt()` to read these session variables and enforce row-level access control. (The pre-1.0 `auth.*` spellings are rewritten on compile and still work, but the backend names the collections still carrying them at boot — write `rebase.*`.)

> **IMPORTANT:** On PostgreSQL this layer is where authorization actually happens; the others narrow the request on the way to it. A table with RLS disabled is not served at all. The document engines have no equivalent and rely on Layers 1–3 and 5 — see [When the database cannot enforce it](#when-the-database-cannot-enforce-it).

---

## Layer 5: Collection Callbacks

Collection callbacks are per-collection lifecycle hooks that run **inside** the DataDriver, close to the database. They provide collection-specific security enforcement:

```typescript
// Row shape, so `values.total` below is a number rather than `unknown`.
type Order = { total: number; status: string };

const ordersCollection: PostgresCollectionConfig<Order> = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    callbacks: {
        beforeSave: async ({ values, context }) => {
            // Enforce business rule: only admins can set high-value orders
            const user = context.user;
            if ((values.total ?? 0) > 10000 && !user?.roles?.includes("admin")) {
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
   ```typescript no-verify
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

## When the database cannot enforce it

Two cases, and only one of them is a Postgres project.

**Masking within a row you are already allowed to read.** RLS decides *which
rows*; it does not redact a column. Hiding a phone number from non-admins on
rows they may otherwise see is exactly what `afterRead` is for, and the pattern
below is the right one.

**A non-Postgres engine.** `@rebasepro/server-mongo` and `@rebasepro/firebase`
have no row-level security, and are rated Experimental for that reason. There
the callbacks below are the only enforcement there is.

What this section is **not** is an alternative to writing policies on Postgres.
A table without RLS is not served, so "enforce it in the application instead"
does not produce a working project — it produces a collection that answers
nothing. Write the `securityRules`.

### Strategy: global callbacks as your security layer

```typescript
import { ApiError } from "@rebasepro/server";
import type { CollectionCallbacks } from "@rebasepro/types";

const callbacks: CollectionCallbacks = {
    // ── READ SECURITY ──
    // Redact rows based on user role. `afterRead` returns a row, so use it to
    // mask fields; to withhold rows entirely, prefer RLS.
    afterRead({ row, collection, context }) {
        const user = context.user;
        if (user?.roles?.includes("admin")) return row;

        // Mask PII on the "customers" collection for non-admins
        if (collection.slug === "customers") {
            return { ...row, email: "***", phone: "***" };
        }
        return row;
    },

    // ── WRITE SECURITY ──
    // Validate and enforce ownership on creates/updates
    beforeSave({ values, id, collection, context }) {
        const user = context.user;
        if (!user) throw ApiError.unauthorized("Authentication required");

        // Enforce ownership: stamp the user id on creation (no id yet = create)
        if (id === undefined) {
            values.user_id = user.uid;
        }

        // Prevent role escalation: non-admins can't set role fields
        if (!user.roles?.includes("admin")) {
            delete values.role;
            delete values.is_admin;
        }

        return values;
    },

    // ── DELETE SECURITY ──
    // Throw to prevent the delete
    beforeDelete({ id, collection, context }) {
        const user = context.user;
        if (!user) throw ApiError.unauthorized("Authentication required");

        if (!user.roles?.includes("admin")) {
            throw ApiError.forbidden("Only admins can delete records");
        }
    }
};
```

> **The honest caveat:** on Postgres this is defence in depth, not the
> authorization model. Authorization is RLS — `securityRules` in a collection are
> a *source for code generation* (`db push` → `policies.sql` → `pg_policies`), and
> nothing on the data path reads them at runtime. Callbacks run in the
> application, so anything reaching the database by another route (psql, a cron,
> the SQL editor) never sees them. Use them for redaction and validation; use RLS
> to decide who may see a row.

### Strategy: Collection Callbacks for Ownership Checks

Collection Callbacks receive the full entity data, making them ideal for ownership verification on deletes and updates:

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

Global and per-collection callbacks are the same mechanism at two scopes. Pick by blast radius:

| Concern | Best Layer | Why |
|---|---|---|
| Cross-cutting field redaction | global `afterRead` | Applies to ALL collections in one place |
| Cross-cutting write validation | global `beforeSave` | Single enforcement point for all writes |
| Withholding rows entirely | **RLS policy** | `afterRead` returns a row and cannot drop one |
| Ownership checks on writes/deletes | collection `callbacks` | Collection-scoped, has the row's values |
| Business rule validation | collection `callbacks` | Collection-specific, typed values |
| Audit logging | global `afterSave` / `afterDelete` | Cross-cutting, post-write |

---

## Common Security Patterns

### PII Masking

This is what `afterRead` is for: it fires on every read path, and it returns a
row, so masking fields is exactly its shape.

```typescript
const callbacks: CollectionCallbacks = {
    afterRead({ row, context }) {
        if (context.user?.roles?.includes("admin")) return row;

        // Mask sensitive fields across all collections
        const masked = { ...row };
        if (masked.email) masked.email = "***@***.***";
        if (masked.phone) masked.phone = "***-***-****";
        if (masked.ssn) masked.ssn = "***-**-****";
        return masked;
    }
};
```

### Tenant Isolation (Multi-Tenancy)

**Withholding rows is RLS's job, not a callback's.** `afterRead` returns a row —
it cannot drop one — so tenant *filtering* belongs in a policy, where Postgres
applies it inside the query. Use a callback only to stamp the tenant on write.

```sql
-- The filter: enforced by the database on every read, for every caller.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_tenant ON documents FOR ALL TO public
    USING (tenant_id = rebase.jwt() ->> 'tenant_id');
```

```typescript
// The stamp: make sure a row can only be created inside the caller's tenant.
const callbacks: CollectionCallbacks = {
    beforeSave({ values, id, context }) {
        const tenantId = context.user?.roles
            ?.find(r => r.startsWith("tenant:"))
            ?.replace("tenant:", "");

        if (!tenantId) throw ApiError.forbidden("No tenant assigned");

        if (id === undefined) values.tenant_id = tenantId;   // create
        else if (values.tenant_id && values.tenant_id !== tenantId) {
            throw ApiError.forbidden("Cross-tenant write");   // update
        }
        return values;
    }
};
```

Run `rebase db push` after adding the policy — the config is only its source.

#### Editing a rule renames its policy

A rule without an explicit `name` compiles to `<table>_<op>_<hash>`, where the hash covers the rule's *semantics*. So **editing** a rule (as opposed to adding one) produces a policy under a new name, and the policy under the old name is a leftover.

This used to matter a great deal: Postgres ORs `PERMISSIVE` policies together, so a superseded `USING (auth.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was. Tightening a rule had no effect, and push reported success.

`db push` now reconciles this automatically — it drops generated policies that no longer correspond to any rule, and reports (without dropping) any custom-named policy it finds that your collections don't describe, since those are indistinguishable from SQL someone wrote deliberately.

To audit an existing database — including one that was pushed before this landed — run:

```bash
rebase doctor --policies
```

It exits non-zero on drift, so it works as a CI gate.

### Membership-Scoped Access (RLS, no N+1)

When membership lives in a **join collection** (e.g. `team_members`), prefer the
first-class `policy.existsIn` predicate over a per-row `afterRead` lookup. It is
enforced by Postgres RLS in a single correlated `EXISTS` subquery — no N+1, and
it cannot be bypassed by a client that skips the SDK.

```typescript
import { policy } from "@rebasepro/types";

// config/collections/documents.ts — only members of the doc's team can read it:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",
            where: policy.and(
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

Inside `where`: `policy.field(...)` = a column of the joined collection
(`team_members`); `policy.outerField(...)` = a column of the row being checked
(`documents`); `policy.authUid()` = the caller. Reach for the `afterRead`
approach above only when access depends on data RLS can't see (e.g. an external
service). Run `rebase db push` after editing the collection to apply the policy.

### Role-Based Collection Access

```typescript
const ROLE_ACCESS: Record<string, string[]> = {
    "financial_reports": ["admin", "finance"],
    "hr_records": ["admin", "hr"],
    "system_config": ["admin"]
};

const callbacks: CollectionCallbacks = {
    // Writes: throw to reject.
    beforeSave({ values, collection, context }) {
        const allowed = ROLE_ACCESS[collection.slug];
        const roles = context.user?.roles ?? [];
        if (allowed && !allowed.some(r => roles.includes(r))) {
            throw ApiError.forbidden(`Insufficient permissions for ${collection.slug}`);
        }
        return values;
    }
};
```

For the **read** side of this, write the same role check as an RLS policy on the
collection. `afterRead` cannot withhold a row, so gating reads there is not an
option — see the note under Tenant Isolation.

### Immutable Records (Soft Delete Only)

```typescript
const callbacks: CollectionCallbacks = {
    beforeDelete({ collection }) {
        const immutable = ["audit_logs", "transactions", "invoices"];
        if (immutable.includes(collection.slug)) {
            throw ApiError.forbidden(
                `Records in "${collection.slug}" cannot be deleted. Use soft-delete instead.`
            );
        }
    },

    beforeSave({ values, id, collection }) {
        const appendOnly = ["audit_logs"];
        // An id means update; a create has none yet.
        if (appendOnly.includes(collection.slug) && id !== undefined) {
            throw ApiError.forbidden(
                `Records in "${collection.slug}" are append-only and cannot be updated.`
            );
        }
        return values;
    }
};
```

---

## Security Checklist

Use this checklist when setting up security for a Rebase project:

- [ ] **Auth is configured** — `auth.jwtSecret` is set with a strong secret (≥ 32 chars)
- [ ] **`requireAuth` is `true`** — The default. Only set to `false` if you explicitly need unauthenticated access
- [ ] **Service key is set** — `auth.serviceKey` with ≥ 32 chars for server-to-server auth
- [ ] **Default role is NOT admin** — `auth.defaultRole` must never be `"admin"` (startup error)
- [ ] **Callbacks enforce what RLS cannot** — `callbacks` on `initializeRebaseBackend` redact and validate on every data path. Deciding *who may see a row* is RLS's job
- [ ] **Sensitive fields are masked** — `afterRead` masks PII for non-admin users
- [ ] **Ownership is enforced** — `beforeSave` stamps `user_id` on creation; Collection Callbacks verify ownership on update/delete
- [ ] **API keys are scoped** — API keys have minimal permissions (specific collections + operations)
- [ ] **API keys are never client-side** — a key carries a broad, long-lived identity (`service`, or `admin` for an admin key) and its own permission list; only use server-side
- [ ] **CORS is configured** — Restrict origins in production
- [ ] **Rate limiting is in place** — Default limiters apply to auth endpoints; add custom limiters for sensitive operations

---

## References

- **RLS Scope**: `packages/server/src/auth/rls-scope.ts` — `scopeDataDriver()` implementation
- **Auth Middleware**: `packages/server/src/auth/middleware.ts` — JWT/service key/API key middleware
- **Adapter Middleware**: `packages/server/src/auth/adapter-middleware.ts` — Custom auth adapter middleware
- **API Key Guard**: `packages/server/src/auth/api-keys/api-key-permission-guard.ts`
- **REST API Generator**: `packages/server/src/api/rest/api-generator.ts` — request/response path
- **Callback Types**: `packages/types/src/types/entity_callbacks.ts` — `CollectionCallbacks`, `AfterReadProps`, `BeforeSaveProps`
- **Backend Init**: `packages/server/src/init.ts` — `hooks` config property
- **Reserved Identity Values**: See Identity Types table above — `"service"`, `"anon"`, `"api-key:{id}"` are system-assigned identities in `context.user`
- **Collection Callbacks**: See `rebase-collections` skill → Collection Callbacks section
- **Auth Configuration**: See `rebase-auth` skill → Server-Side Configuration section
