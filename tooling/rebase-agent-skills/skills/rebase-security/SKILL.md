---
name: rebase-security
description: Comprehensive guide to the Rebase backend security architecture and the row-level security rules every table declares in its `rls`. Use this skill when the user asks about securing their application, writing or debugging an `rls` rule (owner, public, roles, conditions, `policy.existsIn`, raw SQL), how Row-Level Security is the enforcement point, backend-level access control, request interception, global table hooks, or fail-closed design. Also use when the user needs to implement PII masking, tenant isolation, role-based access control, or cross-cutting security concerns.
---

# Rebase Security Architecture

**Authorization is PostgreSQL Row-Level Security.** Every authenticated request
runs as the `rebase_user` role, which holds table grants precisely so that RLS —
not the grant — decides which rows it may see. A table with RLS disabled has no
authorization model at all, so Rebase **does not serve it**, and says so at boot.

Everything below is **defense in depth on top of that**, not a substitute for it.
The application layers authenticate the caller, scope the driver, enforce the
credential's scopes and let you mask or reject at the edges — but the answer to "who can
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
- [Layer 2: Scope Checks](#layer-2-scope-checks)
- [Layer 3: Global hooks (every data path)](#layer-3-global-hooks-every-data-path)
- [Layer 4: Scoped DataDriver](#layer-4-scoped-datadriver)
- [Layer 5: Table hooks](#layer-5-table-hooks)
- [Row-level security rules](#row-level-security-rules)
- [Fail-Closed Design](#fail-closed-design)
- [Masking and validation on top of RLS](#masking-and-validation-on-top-of-rls)
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
│  Layer 2: Scope Checks                               │
│  data:read:posts, cron:write, users:read …           │
│  (narrow keys/tokens; gate the admin plane)          │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Layer 3: Global hooks (every data path)             │
│  Cross-cutting, for ALL tables (backend/hooks.ts)    │
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
│  Layer 5: Table hooks (per table)                    │
│  beforeSave / afterRead / beforeDelete               │
│  The table's `hooks`, inside the DataDriver          │
└──────────────────────────────────────────────────────┘
```

> **KEY INSIGHT:** Layers 1–3 and Layer 5 are **application-level** — they don't depend on the database, and they narrow, redact and validate.
>
> **RLS is the authorization model, and Layer 4 is where it happens.** A table's `rls` is a *source for code generation* — `db push`, `db generate` and boot turn it into `pg_policies` — and nothing on the data path reads it at runtime. Only the database decides who may see a row, and only it still applies when a cron, psql, or the SQL editor reaches the table. `rebase doctor --policies` diffs the deployed policies against what your tables generate, because a stale policy outlives any schema fix.

---

## Request Pipeline

All three protocols share the same security middleware stack:

### REST
```
HTTP Request → Auth Middleware → Scope Checks → Scoped Driver → global hooks → table hooks → column transforms → Response
```

### WebSocket
```
WS Connect → AUTHENTICATE message → Token Verification → Per-Operation Scoped Driver → Response
```
WebSocket auth follows a message-based flow:
1. Client sends an `AUTHENTICATE` message with a JWT token — or an `rk_` API key, verified the same way the HTTP middleware verifies it.
2. Token is verified via `extractUserFromToken(token)`.
3. Session is marked as authenticated; a key's scopes are stored on the session.
4. Each subsequent data operation calls `getScopedDelegate()` to create a user-scoped driver. A key-authenticated session needs `data:read` / `data:write` / `data:delete` on the frame's table, and cannot use channels.
5. Admin-plane operations need their scope, for keys and people alike: `database:write` for `EXECUTE_SQL` and creating/deleting branches, `database:read` for the catalogue and listing branches.
6. Rate limiting: 2000 messages per 60 seconds; channel frames (join, leave, broadcast, presence, history) count against a separate 7200.

---

## Layer 1: Auth Middleware

The auth middleware is the **first line of defense**. It runs on every request and does two things:

1. **Identifies the user** — Extracts credentials from the `Authorization` header (JWT, service key, API key, or custom adapter).
2. **Scopes the DataDriver** — Calls `scopeDataDriver(driver, user)` which invokes `driver.withAuth(user)` to return a security-scoped clone.

The scoped driver is placed into `c.set("driver", scopedDriver)`. The raw, unscoped driver is **never** placed in the request context.

### How Scoping Works

```typescript
// From packages/server/src/auth/rls-scope.ts
type ScopedUser = { uid: string; roles?: string[]; isAnonymous?: boolean; claims?: Record<string, unknown> };

type RLSScopedDriver = DataDriver & {
    withAuth(user: ScopedUser): Promise<DataDriver>;
};

function isRLSScopedDriver(driver: DataDriver): driver is RLSScopedDriver {
    return "withAuth" in driver && typeof (driver as Record<string, unknown>).withAuth === "function";
}

export async function scopeDataDriver(
    driver: DataDriver,
    user: ScopedUser
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
| Service API key | `"api-key:{id}"` | `["service", ...key.roles]` | **RLS is enforced**, against `service` (and `admin` when the key was given `roles: ["admin"]`), *and* the key's scopes |
| Personal API key | the owner's uid | the owner's current roles | **RLS is enforced** as the owner, *and* the key's scopes ∩ the owner's |
| Anonymous (`requireAuth: false`) | `"anonymous"` | `["anon"]` | RLS with anonymous identity |
| No token + `requireAuth: true` | — | — | **Rejected (401)** |

> **IMPORTANT FOR AGENTS: none of these identities bypasses RLS.** Every one of
> them runs inside a transaction that has done `SET LOCAL ROLE rebase_user` with
> `app.uid` set, so the policies are *evaluated* — the admin-roled identities
> merely clear the built-in default policies through their
> `rolesOverlap(['admin'])` arm. Two consequences worth knowing before you
> design around them:
>
> - `policy.serverContext()` compiles to `rebase.uid() IS NULL` and is therefore
>   **false** for all of them. A table with `defaultPolicies: false`
>   whose only rule is `serverContext()` denies these writes (`42501`) and
>   returns zero rows — HTTP 200, empty — for these reads.
> - A service key holding `data:read` and no `admin` role can still read
>   nothing. That is RLS working: grant the `service` role in the table's
>   `rls`, or give the key `roles: ["admin"]`.
>
> The one genuine, unconditional bypass is `rebase.sql()`, which runs on the
> owner connection and never goes through `withAuth`. Of the accessors on the
> server singleton, the quieter one is the more privileged.
>
> SQL does not have to be a bypass. `getSql(c)` in a function (and
> `openRebase(...).withAuth(user).sql`) runs one statement as the caller, under
> the same policies as the SDK — the query text yours, every value in `params`.
> See `rebase-custom-functions`.

> **IMPORTANT FOR AGENTS:** These are **reserved system identity values** that the middleware injects automatically. When writing hooks, developers should use these identities to gate behavior:
> - `uid: "service"` + `roles: ["admin"]` — server-side `rebase.dataAsAdmin` calls (cron jobs, custom functions, webhooks). The driver is scoped with this identity once, at boot.
> - `uid: "anonymous"` + `roles: ["anon"]` — Unauthenticated requests when `requireAuth: false`. Gate on the role (`context.user?.roles?.includes("anon")`): `"anon"` is the role, never the uid, so comparing `uid` with `"anon"` never matches. The identity is on the request's driver and so in `context.user` in hooks; `c.get("user")` stays unset, which `rebase-custom-functions` covers.
> - `uid: "api-key:{id}"` + `roles: ["service", ...key.roles]` — service API key requests. A personal key carries its owner's uid and roles instead.
> - Real user IDs and roles for JWT-authenticated requests.
>
> **Key insight:** `rebase.dataAsAdmin` is not a raw admin driver either. It is the native DataDriver scoped as `{ uid: "service", roles: ["admin"] }`, so RLS is still evaluated and hooks still fire — they live in the driver, not at the route boundary. Hooks can therefore distinguish server-internal reads from end-user ones by checking `context.user?.uid === "service"` — not `roles.includes("admin")`, which a signed-in admin (and an admin-roled API key) also passes.

---

## Layer 2: Scope Checks

Every credential holds **scopes** — `resource:action[:target]`, defined in `packages/types/src/types/scopes.ts` (see `rebase-auth` → Roles & Scopes):

- **Data plane** (`data:*`, `storage:*`, `functions:invoke`): a signed-in person holds all of it — RLS decides their rows. An API key or MCP token holds only what it was given, and these checks narrow it: `data:read:posts` reaches `posts` and nothing else.
  - REST data: `GET` → `data:read`, `POST`/`PUT`/`PATCH` → `data:write`, `DELETE` (and `POST /bulk/delete`) → `data:delete`, on the target table; each parent of a nested path needs `data:read`.
  - Storage: `storage:read|write|delete` on the storage source (`(default)` for the default one), checked before `storageAuthorize`.
  - Functions: `functions:invoke` or `functions:invoke:<name>`.
- **Admin plane** (`users:*`, `schema:*`, `database:*`, `backups:read`, `cron:*`, `logs:read`, `keys:*`): nobody holds it implicitly — the `admin` role holds all of it, declared roles hold what `auth.roles` lists, keys what they were minted with (never `keys:*`).

A missing scope is **`403 SCOPE_MISSING`** with `details.requiredScope`. Nothing grants more than its grantor holds: key scopes ⊆ the minter's (`SCOPE_EXCEEDS_CREATOR`), and a `users:write` holder cannot manage an account that outranks them (`ACCOUNT_OUTRANKS_CALLER`) nor grant roles beyond their own (`ROLE_EXCEEDS_CALLER`).

---

## Layer 3: Global hooks (every data path)

Global hooks are cross-cutting table hooks: one `TableHooks` set applied to
**every** table. Unlike an API-boundary interceptor, they fire on *every* data
path: REST, WebSocket/realtime, MCP and server-side `rebase.dataAsAdmin`. There
is no read path that bypasses `afterRead`, which is what makes it safe to rely
on for redaction. They add to RLS; they never replace it.

### Configuration

A scaffolded project exports them as `hooks` from `backend/hooks.ts`, and the
runtime reads that export at boot. An ejected server passes the same value as
the `hooks` option of `initializeRebaseBackend()`. They take the **same**
`TableHooks` type as a table's own `hooks`:

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    // Every row leaving the server, across every table.
    // Return the row; redact by returning a modified copy.
    afterRead({ values, table, context }) {
        return values;
    },

    // Every write. Return the values to save, or throw to reject.
    beforeSave({ values, id, table, context }) {
        return values;
    },

    // Every delete. Throw (or return false) to prevent it.
    beforeDelete({ id, values, table, context }) { /* ... */ },

    // Post-write, inside the write's transaction.
    afterSave({ id, values, table, context }) { /* ... */ },
    afterDelete({ id, values, table, context }) { /* ... */ }
};
```

Global hooks need declared tables: each hook receives the table's descriptor
as `table` (`table.slug`, its columns, its `rls` posture), so a backend that
reads its tables from the database (no `backend/schema`) refuses them at boot.

> **FOR AGENTS:** hooks take a **single props object**, not positional
> arguments, and the row is a flat object under `values` — not an `Entity`.
> `Entity` is an admin-UI view model and never reaches this layer. A hook set
> written apart from its table is typed with the generic row, so read its
> values as `unknown` and check them.

### The hook props

`TableHooks` is defined in `packages/types/src/schema/hooks.ts`. Every hook
receives `table` (the descriptor), `path` and `context` (`context.user`, and
`context.data` scoped to the caller). Then:

| Hook | Also receives | Returns |
|---|---|---|
| `beforeQuery` | `operation`, `query` | a narrowing to AND into the read (`{ filter }` / `{ logical }`), or nothing. It can only narrow |
| `afterRead` | `values` (the row) | the row to serve |
| `beforeSave` | `id?`, `values`, `previousValues?`, `status` | the values to write |
| `afterSave` | `id`, `values`, `previousValues?`, `status` | nothing |
| `afterSaveError` | as `afterSave`, plus `error` | nothing |
| `beforeDelete` / `afterDelete` | `id`, `values` (the row being deleted) | `false` vetoes a delete in `beforeDelete` |

### What a hook can stop

Every hook is awaited, and the write hooks run inside the write's transaction:
`beforeSave`, the SQL and `afterSave` commit together or not at all. None of
them is fire-and-forget.

| Hook | Can Block? | How to Block |
|---|---|---|
| `beforeSave` | Yes | Throw — the write never happens; 400 `CALLBACK_REJECTED` (or the status of a thrown `RebaseApiError`) |
| `beforeDelete` | Yes | Throw, or return `false` (403) — the row is not deleted |
| `afterRead` | Redacts, does not block | Return a modified row. It returns a row, not `null` — filter rows out with RLS, not here |
| `afterSave` | Yes — rolls back | Throw — the row it just wrote is rolled back; 400 `CALLBACK_REJECTED`, `details.stage: "afterSave"` |
| `afterSaveError` | No | Fires when a save fails |
| `afterDelete` | Yes — rolls back | Throw — the delete is rolled back; 400 `CALLBACK_REJECTED`, `details.stage: "afterDelete"` |

> **IMPORTANT FOR AGENTS**: because `afterSave`/`afterDelete` hold the write's
> transaction open, never make a network call (webhook, email, third-party API)
> from one — it holds a lock for the round trip, and a failure rolls the user's
> write back. Enqueue a job instead; it commits with the write.

### Execution Order

**global hooks → the table's `hooks` → the columns' `.transform()`.**

The set exported from `backend/hooks.ts` runs first, then the `hooks` declared
on the table, then each column's `.transform()`. All three are the same
mechanism at different scopes, which is why they share one type. Several sets
at one scope combine with `composeTableHooks(a, b)` from `@rebasepro/common`.

The auth system's own writes to the users table (sign-up, OAuth sign-in, an
admin's user management) run none of these; they run the auth hooks
(`afterUserCreate`, …) instead — see `rebase-auth`.

---

## Layer 4: Scoped DataDriver

The scoped DataDriver is the layer where database-level RLS is enforced. For PostgreSQL, `withAuth()` wraps every operation in a transaction with session variables:

```sql
SELECT
    set_config('app.uid', :uid, true),
    set_config('app.user_id', :uid, true),          -- pre-rename alias, still written for legacy policies
    set_config('app.user_roles', :rolesString, true),
    set_config('app.is_anonymous', :isAnonymous, true),
    set_config('app.jwt', :jwtClaims, true),        -- custom claims, then sub / roles / is_anonymous
    set_config('role', 'rebase_user', true)          -- = SET LOCAL ROLE, in the same statement
```

PostgreSQL RLS policies use `rebase.uid()`, `rebase.roles()`, `rebase.is_anonymous()` and `rebase.jwt()` to read these session variables and enforce row-level access control. `app.uid` is the canonical variable; write new policies against the functions, never against `app.user_id`. (The pre-1.0 `auth.*` spellings are rewritten on compile and still work, but the backend names the tables still carrying them at boot — write `rebase.*`.)

> **IMPORTANT:** This layer is where authorization actually happens; the others narrow the request on the way to it. A table with RLS disabled is not served at all.

---

## Layer 5: Table hooks

A table's own `hooks` are per-table lifecycle hooks that run **inside** the
DataDriver, close to the database, with the row typed from the table's
columns:

```typescript
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric({ precision: 10, scale: 2 }).notNull(),
        status: col.enum(["open", "paid", "fulfilled"]).notNull().default("open")
    },
    rls: [{ operation: "all", access: "authenticated" }],
    hooks: {
        beforeSave: async ({ values, context }) => {
            // Business rule: only admins can set high-value orders
            if ((values.total ?? 0) > 10000 && !context.user?.roles?.includes("admin")) {
                throw new Error("High-value orders require admin approval");
            }
            return values;
        },
        beforeDelete: async ({ values }) => {
            // Prevent deletion of fulfilled orders
            if (values.status === "fulfilled") {
                throw new Error("Cannot delete fulfilled orders");
            }
        }
    }
});
```

For the full hook reference, see the `rebase-tables` skill → Table hooks.

---

## Row-level security rules

Every table declares `rls`, and it is required: leaving it out is a type
error, and a table that reaches the compiler without a usable posture stops
`rebase db generate`, `db push` and boot. `"admin-only"` (only the admin
baseline policies) is the posture to start with until you have decided;
`"inherit"` takes the `defaultRls` exported from `backend/schema/index.ts`
(refused when there is none); otherwise a non-empty list of rules.

The rules are a *source for code generation*: `db push`, `db generate` and boot
compile them into `ENABLE ROW LEVEL SECURITY` and one `CREATE POLICY` per rule
and operation. Nothing on the data path reads them at runtime; the database
does.

### Rule forms

A rule is one of these. Mixing two in one rule is a type error.

| Form | Example | `USING` (which rows) | `WITH CHECK` (what may be written) |
|---|---|---|---|
| Owner | `{ ownerField: "authorId" }` | the column equals the caller's id | the same |
| Public | `{ access: "public" }` | every row | every row |
| Signed in | `{ access: "authenticated" }` | every row, for a signed-in caller | the same |
| Access + condition | `{ access: "public", condition: { status: "published" } }` | the condition (gated by the access test) | `check`, else the condition |
| Access + check | `{ access: "authenticated", check: { state: "open" } }` | the access test | the check |
| Structured | `{ condition: policy.rolesOverlap(["moderator"]) }` | the condition | `check`, else the condition |
| Raw SQL | `{ using: "{published_at} > now() - interval '30 days'" }` | the SQL | `withCheck`, else `using` |
| Raw check only | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | no rows | the SQL |
| Roles only | `{ operation: "delete", roles: ["admin"] }` | every row, for the roles | the same |

Shared keys: `operation` (`"select" | "insert" | "update" | "delete" | "all"`,
default `"all"`), `operations` (several; one policy each), `roles` (Rebase
application roles, ANDed with the rule), `mode` (`"restrictive"` makes the rule
a gate that must also pass), `name` (else derived from the table, the operation
and a hash of the rule), `pgRoles` (native Postgres roles for the `TO` clause —
almost never what you want; `anon` / `authenticated` in `roles` match no user).

`ownerField` and shorthand `condition` / `check` keys name column keys (or a
`belongsTo` relation, meaning its foreign-key column); a key that names no
column is refused when the schema compiles. `ownerField` compares, it does not
fill: pair it with `.onCreateUser()` on the column, so the server writes the
caller's id whatever the request sent.

```typescript
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser()
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] }
    ]
});
```

### Structured conditions: `policy`

`policy` from `@rebasepro/types` builds a condition that compiles to SQL and is
also evaluated by the CMS, so the panel never offers an action the database
will refuse: `policy.and/or/not`, `policy.compare(left, "eq" | "neq" | "lt" |
"lte" | "gt" | "gte", right)`, `policy.rolesOverlap(roles)` (any),
`policy.rolesContain(roles)` (all), `policy.authenticated()`,
`policy.registered()` (signed in and not an anonymous guest),
`policy.serverContext()`, `policy.existsIn({ table, where })`,
`policy.raw(sql)`; operands `policy.field(name)`, `policy.outerField(name)`,
`policy.literal(value)`, `policy.authUid()`, `policy.authRoles()`,
`policy.authClaim(name)`. `existsIn`, `raw` and `authClaim` are evaluated by
the database only.

### Policies a table gets without writing them

- **The admin baseline**: `<table>_default_admin_read` / `_write`, permissive,
  admitting the server context and the `admin` role. `defaultPolicies: false`
  removes them (refused with `"admin-only"`).
- **The users table** (`defineAuthTable`): a self-read policy and a restrictive
  gate that lets only an admin write `roles`.
- **Tenancy** (`tenant`): a restrictive policy confining every operation to the
  caller's tenant.
- **Junction tables** of `rel.manyToMany`: policies of their own.

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

4. **Credentials missing a scope are rejected** — `scopeGrants` loops over what is held and returns `false` at the end, so an empty or unparseable scope list reaches nothing. The request is rejected with `403 SCOPE_MISSING`.

---

## Masking and validation on top of RLS

RLS decides *which rows*; it does not redact a column. Hiding a phone number
from non-admins on rows they may otherwise see is what `afterRead` is for —
and better still, a column no caller should receive is `.private()` or
`.access({ read: ["support"] })` on the column, which removes it before any
hook runs and keeps it out of filters too.

**A client-direct engine** is the other case the database does not enforce:
`@rebasepro/firebase` talks to Firestore from the browser; Rebase policies and
hooks never see those reads, and Firebase Security Rules are what enforce them.

What this section is **not** is an alternative to writing policies. A table
without RLS is not served, so "enforce it in the application instead" does not
produce a working project. Write the `rls`.

### Strategy: global hooks for cross-cutting checks

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const hooks: TableHooks = {
    // ── READ ── mask fields; to withhold rows entirely, use RLS.
    afterRead({ values, table, context }) {
        if (context.user?.roles?.includes("admin")) return values;
        if (table.slug === "customers") {
            return { ...values, email: "***", phone: "***" };
        }
        return values;
    },

    // ── WRITE ── non-admins can't set privilege fields on any table.
    beforeSave({ values, context }) {
        if (!context.user) throw new RebaseApiError("Authentication required", { status: 401, code: "UNAUTHENTICATED" });
        if (!context.user.roles?.includes("admin")) {
            delete values.role;
            delete values.is_admin;
        }
        return values;
    },

    // ── DELETE ──
    beforeDelete({ context }) {
        if (!context.user?.roles?.includes("admin")) {
            throw new RebaseApiError("Only admins can delete records", { status: 403, code: "FORBIDDEN" });
        }
    }
};
```

> **The honest caveat:** this is defence in depth, not the authorization model.
> Authorization is RLS — a table's `rls` is a *source for code generation*
> (`db push` → `.rebase/sql/policies.sql` → `pg_policies`), and nothing on the
> data path reads it at runtime. Hooks run in the application, so anything
> reaching the database by another route (psql, `rebase.sql()`, the SQL editor)
> never sees them. Use them for redaction and validation; use RLS to decide who
> may see a row.

### Ownership: RLS first, a hook for the message

Ownership is an `ownerField` rule plus `.onCreateUser()` on the column — the
database enforces it on every door, and the stamp means nobody can create a
row in someone else's name. A `beforeSave` / `beforeDelete` check on top is
only for a friendlier error than an empty update:

```typescript
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        userId: col.uuid().notNull().onCreateUser(),
        status: col.enum(["open", "paid", "fulfilled"]).notNull().default("open")
    },
    rls: [{ operation: "all", ownerField: "userId" }],
    hooks: {
        beforeDelete: async ({ values, context }) => {
            if (values.userId !== context.user?.uid && !context.user?.roles?.includes("admin")) {
                throw new Error("You can only delete your own orders");
            }
        }
    }
});
```

### Combining the layers

| Concern | Best Layer | Why |
|---|---|---|
| Who may see or write a row | **`rls`** on the table | Enforced by Postgres on every door |
| A column some callers must never receive | `.private()` / `.access()` on the column | Removed before hooks; refused in filters |
| Cross-cutting field redaction | global `afterRead` (`backend/hooks.ts`) | Applies to ALL tables in one place |
| Cross-cutting write validation | global `beforeSave` | Single enforcement point for all writes |
| Business rule validation | the table's `hooks` | Table-specific, typed values |
| Audit logging | `history: true`, or global `afterSave` / `afterDelete` | Cross-cutting, post-write |

---

## Common Security Patterns

### PII Masking

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values, context }) {
        if (context.user?.roles?.includes("admin")) return values;
        const masked = { ...values };
        if (masked.email) masked.email = "***@***.***";
        if (masked.phone) masked.phone = "***-***-****";
        if (masked.ssn) masked.ssn = "***-**-****";
        return masked;
    }
};
```

`app/backend/schema/users.ts` masks per table instead, with a table `afterRead`.

### Tenant Isolation (Multi-Tenancy)

**Withholding rows is RLS's job, not a hook's.** Declare `tenant` on the table:
it generates a restrictive policy confining every operation to the caller's
tenant, and the server refuses a write naming another tenant with a 400.

```typescript
import { defineTable, col } from "@rebasepro/server/schema";

export const documents = defineTable("documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        siteId: col.text().notNull(),
        title: col.text().notNull()
    },
    // The caller's tenant from a JWT claim…
    tenant: { field: "siteId", from: { claim: "site_id" } },
    rls: [{ operation: "all", access: "authenticated" }]
});
```

…or from a membership table, when a user belongs to several tenants:
`tenant: { field: "siteId", from: { membership: { table: "site_members", userField: "userId", tenantField: "siteId" } } }`.
`bypassRoles` (default `["admin"]`) see every tenant. Run `rebase db push` (or
restart `rebase dev`) after adding it — the table is only the policy's source.

#### Editing a rule renames its policy

A rule without an explicit `name` compiles to `<table>_<op>_<hash>`, where the hash covers the rule's *semantics*. So **editing** a rule (as opposed to adding one) produces a policy under a new name, and the policy under the old name is a leftover.

This used to matter a great deal: Postgres ORs `PERMISSIVE` policies together, so a superseded `USING (auth.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was. Tightening a rule had no effect, and push reported success.

`db push` now reconciles this automatically — it drops generated policies that no longer correspond to any rule, and reports (without dropping) any custom-named policy it finds that your tables don't describe, since those are indistinguishable from SQL someone wrote deliberately.

To audit an existing database — including one that was pushed before this landed — run:

```bash
rebase doctor --policies
```

It exits non-zero on drift, so it works as a CI gate.

There is no policy file in the repository to review. `db push` and `db generate`
write `.rebase/sql/policies.sql` from the tables on every run, and that
directory is gitignored. The tables in `backend/schema` are the source, and
`pg_policies` is what the database enforces.

### Membership-Scoped Access (RLS, no N+1)

When membership lives in a **join table** (e.g. `team_members`), prefer the
first-class `policy.existsIn` predicate over a per-row `afterRead` lookup. It is
enforced by Postgres RLS in a single correlated `EXISTS` subquery — no N+1, and
it cannot be bypassed by a client that skips the SDK.

```typescript
// backend/schema/documents.ts — only members of the doc's team can read it
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const teamDocuments = defineTable("team_documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull()
    },
    rls: [
        {
            operation: "select",
            condition: policy.existsIn({
                table: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                )
            })
        }
    ]
});
```

Inside `where`: `policy.field(...)` = a column of the joined table
(`team_members`); `policy.outerField(...)` = a column of the row being checked;
`policy.authUid()` = the caller. Reach for an `afterRead` approach only when
access depends on data RLS can't see (e.g. an external service).

### Role-Based Table Access

A table only some roles may touch is a roles rule, enforced for reads and
writes alike:

```typescript
import { defineTable, col } from "@rebasepro/server/schema";

export const financialReports = defineTable("financial_reports", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        quarter: col.text().notNull()
    },
    rls: [
        { operation: "select", roles: ["finance"] },
        { operations: ["insert", "update", "delete"], roles: ["finance"] }
    ]
});
```

(Admins reach it through the baseline policies.) Do not gate reads in
`afterRead`: it returns a row and cannot withhold one.

### Immutable Records (Append-Only)

Leave the operation out of `rls`, and no policy grants it: a table with only
`select` and `insert` rules cannot be updated or deleted by any caller but an
admin. Add a `beforeDelete` / `beforeSave` hook only for the error message, or
to stop admins too:

```typescript
import { defineTable, col } from "@rebasepro/server/schema";

export const auditLogs = defineTable("audit_logs", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        action: col.text().notNull(),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    rls: [
        { operation: "select", roles: ["auditor"] },
        { operation: "insert", access: "authenticated" }
    ],
    hooks: {
        beforeSave: ({ values, status }) => {
            if (status === "existing") throw new Error("Audit logs are append-only.");
            return values;
        },
        beforeDelete: () => false
    }
});
```

---

## Security Checklist

Use this checklist when setting up security for a Rebase project:

- [ ] **Auth is configured** — `auth.jwtSecret` is set with a strong secret (≥ 32 chars)
- [ ] **`requireAuth` is `true`** — The default. Only set to `false` if you explicitly need unauthenticated access
- [ ] **Service key is set** — `auth.serviceKey` with ≥ 32 chars for server-to-server auth
- [ ] **Default role holds no admin-plane scope** — `auth.defaultRole` may not be `"admin"` or a declared role with any admin-plane scope (startup error)
- [ ] **Every table states its `rls`** — `"admin-only"` until decided; owner tables use `ownerField` with `.onCreateUser()` on the column; `rebase verify` flags per-user tables whose rules let a role read every row
- [ ] **Hooks enforce what RLS cannot** — global hooks (`backend/hooks.ts`) and table `hooks` redact and validate on every data path. Deciding *who may see a row* is RLS's job
- [ ] **Sensitive fields are masked** — `afterRead` masks PII for non-admin users
- [ ] **Ownership is enforced** — an `ownerField` rule, and `.onCreateUser()` so the server stamps the owner on create
- [ ] **API keys are scoped** — the narrowest scopes that work (`data:read:orders`, not `data:read`); no `data:delete` or `functions:invoke` unless needed
- [ ] **API keys are never client-side** — a key is a long-lived credential (a service key acts as `service`, plus `admin` if given that role; a personal key acts as its owner); only use server-side
- [ ] **CORS is configured** — Restrict origins in production
- [ ] **Rate limiting is in place** — Default limiters apply to auth endpoints; add custom limiters for sensitive operations

---

## References

- **RLS Scope**: `packages/server/src/auth/rls-scope.ts` — `scopeDataDriver()` implementation
- **Auth Middleware**: `packages/server/src/auth/middleware.ts` — JWT/service key/API key middleware
- **Adapter Middleware**: `packages/server/src/auth/adapter-middleware.ts` — Custom auth adapter middleware
- **Scopes**: `packages/types/src/types/scopes.ts` — the vocabulary, `scopeGrants`, `scopesForRoles`
- **Access model / `requireScope`**: `packages/server/src/auth/access.ts`
- **API keys**: `packages/server/src/auth/api-keys/` — `api-key-middleware.ts` (verification), `key-grant.ts` (minting rules)
- **REST API Generator**: `packages/server/src/api/rest/api-generator.ts` — request/response path
- **Hook Types**: `packages/types/src/schema/hooks.ts` — `TableHooks`, `TableBeforeSaveProps`, `TableAfterReadProps`, `ColumnTransform`
- **Rule Types**: `packages/types/src/types/security_rules.ts` (`SecurityRule`), `packages/types/src/schema/table_options.ts` (`RlsPosture`, `DefaultRls`), `packages/types/src/types/policy.ts` (`policy`)
- **Backend Options**: `packages/server/src/backend/options.ts` — `RebaseBackendOptions.hooks`, the global hooks
- **Reserved Identity Values**: See Identity Types table above — `"service"`, `"anonymous"`, `"api-key:{id}"` are system-assigned identities in `context.user`
- **Table hooks**: See `rebase-tables` skill → Table hooks section
- **Auth Configuration**: See `rebase-auth` skill → Server-Side Configuration section
