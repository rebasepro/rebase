---
title: Global Backend Hooks
sidebar_label: Global Hooks
description: Apply cross-cutting lifecycle callbacks to every collection at the server level using CollectionCallbacks.
---

## Overview

Rebase provides two levels of entity lifecycle callbacks — both use the same `CollectionCallbacks` type from `@rebasepro/types`:

- **[Per-collection callbacks](/docs/collections/callbacks)**: Defined on individual collection configurations. They run only for that collection.
- **Global callbacks**: Defined on `initializeRebaseBackend({ callbacks })`. They fire on **every** collection, on every data path (REST API, WebSocket / realtime, server-side `rebase.dataAsAdmin`).

Use global callbacks for:
- **PII masking** — redact sensitive fields for non-admin callers across all collections.
- **Unified audit logging** — log every create, update, or delete in one place.
- **Cross-cutting validation** — enforce invariants that span multiple collections.

:::note
**Execution order**: global callbacks → collection callbacks → property callbacks.
:::

---

## Configuration

:::note[Where this goes]
**Managed runtime** — `export const callbacks = { … }` from `config/index.ts`. The runtime reads that export at boot; nothing else needs changing.

**Ejected** — the `callbacks` key on `initializeRebaseBackend({ … })`.

The full map is in [Backend Overview](/docs/backend/#where-each-option-lives).
:::

Pass the `callbacks` key to `initializeRebaseBackend`:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            // Runs after every entity read, across all collections
            return row;
        },
        beforeSave({ values, context }) {
            // Runs before every entity save
            return values;
        }
    }
});
```

---

## `CollectionCallbacks` Type

```typescript
type CollectionCallbacks = {
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

All callbacks may return a `Promise` (async) or a plain value (sync).

---

## Callback Props

Each callback receives a single props object. Common fields:

| Field | Type | Present in |
|-------|------|------------|
| `collection` | `ResolvedCollection` | All callbacks |
| `path` | `string` | All callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (optional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (optional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | All callbacks |

`context.user` contains the authenticated user (`uid`, `roles`, etc.), or is `undefined` for public requests.

---

## Execution Pipeline

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Start PostgreSQL Transaction                             │
 │ 2. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │                                                             │
 │ 3. Global Callback: beforeSave     ─┐                       │
 │ 4. Collection Callback: beforeSave ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global Callback: afterSave      ─┐                       │
 │ 7. Collection Callback: afterSave  ─┘ awaited               │
 │                                                             │
 │ 8. Commit  ← a throw anywhere in 3–7 rolls the write back   │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Realtime notifications flushed — after the commit, never before]
       │
       ▼
[Client Response]
```

---

## Blocking vs. Async Semantics

**Every callback in the list below is awaited, and all of them run inside the
transaction that carries the write.** There is no "fire and forget" tier: the
row and everything its callbacks did commit together or not at all.

- **`beforeSave`, `beforeDelete`** — if the callback throws, the operation is rejected with an HTTP 400 carrying your message and the code `CALLBACK_REJECTED`, and the database write never happens. Throw a `RebaseApiError` from `@rebasepro/types` to pick the status yourself — see [Entity Callbacks](/docs/collections/callbacks#beforesave). A `beforeDelete` that *returns* `false` is the same refusal with no message, and answers **403** with that code.
- **`afterRead`** — the returned row (or transformed row) is what the caller receives. Its transaction is `READ ONLY` — see [below](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — run *before* the commit, awaited. A throw here rolls the row back and answers the same **400 `CALLBACK_REJECTED`**, with `details.stage` naming the hook. They hold the transaction open while they run, so a slow one is a lock held.
- **`afterSaveError`** — runs when the save failed, on the way out.

:::caution[This page used to say the opposite]
Earlier versions said `afterSave` and `afterDelete` "run after the transaction
commits" and "do not block the HTTP response". They never did either. Code that
was written against that sentence — a webhook call in `afterSave`, say — has
been holding a database transaction open for the length of an HTTP round trip,
and rolling the row back whenever the remote end was down.
:::

### Side effects that must not hold the transaction

Anything slow, or anything that cannot be undone if the transaction rolls back,
does not belong in the callback body:

| Want | Do this instead |
|---|---|
| Call a third party, send mail, generate a file | [Enqueue a job](/docs/backend/jobs). A job enqueued in a transaction that rolls back was never enqueued — which is the behaviour you want. |
| Tell other processes something happened | Publish on a [realtime channel](/docs/backend/realtime) after the write returns, not from inside the hook. |
| Work in a [custom function](/docs/backend/custom-functions) that the caller need not wait for | `waitUntil(c, promise)` from `@rebasepro/server/functions` — it runs after the response, and the host waits for it before shutting down. |

The rule of thumb: if the work should still happen when the write is undone, it
is not part of the write, so it does not go in the hook.

### `afterRead` cannot write

A request-scoped read opens its transaction `READ ONLY`. `afterRead` runs inside
it, so **no write from that callback can succeed** — not a `context.data`
create, not an update, not one buried in a helper it calls. Postgres refuses the
statement with SQLSTATE `25006`, and the caller is answered:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

That is a 409, not a 500: it is your code being refused, not the server failing.
The read-only mode is deliberate — a read that quietly writes is a read whose
cost, locks and RLS surface nobody budgeted for.

So **read auditing does not belong in `afterRead`**. Log the read outside the
request instead — from a background job fed by whatever you already emit, or
from a custom function that does the read *and* the write with two separate
calls:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
callbacks: {
    afterRead: async ({ path, row, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return row;
    }
}
```

```typescript no-verify
// ✓ The read and the audit row are two operations, and only the second writes.
import { rebase } from "@rebasepro/server";

export default defineFunction("read-article", (app) => {
    app.get("/:id", async (c) => {
        const article = await c.var.driver.fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: c.var.user?.uid });
        return c.json(article);
    });
});
```

Write-side auditing has no such problem: `afterSave` and `afterDelete` run in a
read-write transaction, and the audit row commits with the change it records.

---

## Examples

### PII Masking

Redact email addresses for non-admin callers across every collection:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            const isAdmin = context.user?.roles?.includes("admin");
            if (!isAdmin && row.email) {
                return { ...row, email: "********" };
            }
            return row;
        }
    }
});
```

### Global Audit Logging

Record every deletion, across every collection, in an `audit_log` table. Because
`afterDelete` runs in the delete's own transaction, the audit row and the
deletion commit together — there is no window in which one exists without the
other:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        async afterDelete({ collection, id, row, context }) {
            if (collection.slug === "audit_log") return;   // don't audit the audit
            await context.data.audit_log.create({
                action: "delete",
                collection: collection.slug,
                entity_id: String(id),
                actor: context.user?.uid ?? "anonymous",
                snapshot: row
            });
        }
    }
});
```

Note what this buys and what it costs: if the audit row cannot be written, the
delete does not happen either. For an audit trail that is usually what you want.
If it is not, catch the error in the callback and say so in a comment.

### Collection-Specific Logic

Global callbacks fire for all collections. To scope logic to a single collection, check `collection.slug` or `path`:

```typescript
callbacks: {
    beforeSave({ collection, values, context }) {
        if (collection.slug === "orders") {
            if (!values.total || values.total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
}
```

For callbacks that only apply to a single collection, prefer [per-collection callbacks](/docs/collections/callbacks) instead.
