---
title: Global Backend Hooks
sidebar_label: Global Hooks
description: Apply cross-cutting lifecycle callbacks to every collection at the server level using EntityCallbacks.
---

## Overview

Rebase provides two levels of entity lifecycle callbacks — both use the same `EntityCallbacks` type from `@rebasepro/types`:

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

```typescript
import { initializeRebaseBackend } from "@rebasepro/server-core";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ entity, context }) {
            // Runs after every entity read, across all collections
            return entity;
        },
        beforeSave({ values, context }) {
            // Runs before every entity save
            return values;
        }
    }
});
```

---

## `EntityCallbacks` Type

```typescript
import type { EntityCallbacks } from "@rebasepro/types";

type EntityCallbacks = {
    afterRead?(props):   Entity;          // Transform entity before returning to caller
    beforeSave?(props):  Partial<Values>; // Modify values before writing to DB
    afterSave?(props):   void;            // Side-effects after successful save
    afterSaveError?(props): void;         // Side-effects after a failed save
    beforeDelete?(props): boolean | void; // Return false or throw to block deletion
    afterDelete?(props): void;            // Side-effects after successful deletion
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
| `entity` | `Entity` | `afterRead`, `beforeDelete`, `afterDelete` |
| `entityId` | `string` | `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (optional) | `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `afterSave`, `afterSaveError` |
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

- **`beforeSave`, `beforeDelete`** — blocking. If the callback throws, the operation is rejected with an HTTP 400 error response. The database write never happens.
- **`afterRead`** — blocking. The returned entity (or transformed entity) is what the caller receives.
- **`afterSave`, `afterDelete`, `afterSaveError`** — run after the transaction commits. They do not block the HTTP response.

---

## Examples

### PII Masking

Redact email addresses for non-admin callers across every collection:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server-core";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ entity, context }) {
            const isAdmin = context.user?.roles?.includes("admin");
            if (!isAdmin && entity.values.email) {
                return {
                    ...entity,
                    values: {
                        ...entity.values,
                        email: "********"
                    }
                };
            }
            return entity;
        }
    }
});
```

### Global Audit Logging

Log all deletions across every collection:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server-core";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterDelete({ collection, entityId, context }) {
            console.log(
                `[AUDIT] User ${context.user?.uid} deleted ${collection.slug}/${entityId}`
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
