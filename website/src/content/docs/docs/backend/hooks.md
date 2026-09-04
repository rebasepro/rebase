---
title: Global Backend Hooks
sidebar_label: Global Hooks
description: Apply cross-cutting lifecycle callbacks to every collection at the server level using CollectionCallbacks.
---

## Overview

Rebase provides two levels of entity lifecycle callbacks — both use the same `CollectionCallbacks` type from `@rebasepro/types`:

- **[Per-collection callbacks](/docs/collections/callbacks)**: Defined on individual collection configurations. They run only for that collection.
- **Global callbacks**: Defined on `initializeRebaseBackend({ callbacks })`. They fire on **every** collection, on every data path (REST API, WebSocket / realtime, server-side `rebase.data`).

Use global callbacks for:
- **PII masking** — redact sensitive fields for non-admin callers across all collections.
- **Unified audit logging** — log every create, update, or delete in one place.
- **Cross-cutting validation** — enforce invariants that span multiple collections.

:::note
**Execution order**: global callbacks → collection callbacks → property callbacks.
:::

---

## Configuration

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
    afterSave?(props):   void;                      // Side-effects after successful save
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false or throw to block deletion
    afterDelete?(props): void;                      // Side-effects after successful deletion
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
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Global Callback: beforeSave (Blocking)                   │
 │ 2. Collection Callback: beforeSave (Blocking)               │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 3. Start PostgreSQL Transaction                             │
 │ 4. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Commit Transaction                                       │
 └─────┬───────────────────────────────────────────────────────┘
       │
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 7. Global Callback: afterSave                               │
 │ 8. Collection Callback: afterSave                           │
 └─────┬───────────────────────────────────────────────────────┘
       │
       ▼
[Client Response]
```

---

## Blocking vs. Async Semantics

- **`beforeSave`, `beforeDelete`** — blocking. If the callback throws, the operation is rejected with an HTTP 400 carrying your message and the code `CALLBACK_REJECTED`, and the database write never happens. Throw a `RebaseApiError` from `@rebasepro/types` to pick the status yourself — see [Entity Callbacks](/docs/collections/callbacks#beforesave).
- **`afterRead`** — blocking. The returned row (or transformed row) is what the caller receives.
- **`afterSave`, `afterDelete`, `afterSaveError`** — run after the transaction commits. They do not block the HTTP response.

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

Log all deletions across every collection:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterDelete({ collection, id, context }) {
            console.log(
                `[AUDIT] User ${context.user?.uid} deleted ${collection.slug}/${id}`
            );
        }
    }
});
```

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
