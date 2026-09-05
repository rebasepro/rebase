---
title: Entity History
sidebar_label: Entity History
description: Track every change to your entities with a full audit trail — who changed what, when, and the complete before/after entity.
---

## Overview

Entity history records a entity of entity values on every create, update, and delete. This gives you a full audit trail with diffs.

## Enabling History

### Backend

:::note[Where this goes]
**Managed runtime:** `REBASE_HISTORY` (`true` by default; set `false` to turn it off). Retention settings have no environment form — eject to change them.
**Ejected:** `initializeRebaseBackend({ history })` in `backend/src/index.ts`.
:::

Enable history in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Or with custom retention settings:

```typescript
history: {
    maxEntries: 200,     // Per entity, oldest pruned first (default: 200)
    ttlDays: 90          // Entries older than this are pruned (default: 90)
}
```

### Per Collection

Mark which collections should track history:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Enable for this collection
    properties: { /* ... */ }
});
```

## How It Works

1. The backend creates a `rebase.entity_history` table automatically.
2. On every create, update, or delete, a entity is recorded with:
   - Entity ID, collection slug, and table name
   - The full entity values (before and after)
   - Timestamp and user ID
   - Operation type (`create`, `update`, `delete`)
   - An array of `changed_fields` showing which columns were modified

### Diff Tracking & Structural Deep Equality

To avoid recording redundant logs where fields are saved but no values change, the `HistoryService` performs a structural deep equality comparison on the top-level keys of the old and new values:
- It ignores system metadata properties starting with `__`.
- If differences are found, the names of the modified properties are saved in the `changed_fields` (`text[]`) column.
- If the deep equality check detects zero changes, the history insertion is entirely skipped.

### Non-Blocking Post-Save Pruning

Unlike traditional systems that rely entirely on slow periodic batch scripts, Rebase enforces your retention policies continuously:
- Right after a entity is saved or deleted, the server schedules an **inline asynchronous sweep** in a non-blocking, fire-and-forget promise.
- This sweep immediately checks retention limits for that specific entity ID and prunes older entries exceeding `maxEntries` or `ttlDays`.

## REST Endpoint

```
GET /api/data/:slug/:entityId/history
```

Returns a list of history entries for a specific entity, ordered by most recent first:

```json
{
    "data": [
        {
            "id": 42,
            "entity_id": "123",
            "collection_slug": "orders",
            "operation": "update",
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending", "total": 99.99 },
            "user_id": "admin-user-id",
            "created_at": "2025-01-15T10:30:00Z"
        }
    ]
}
```

## Retention Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxEntries` | 200 | Maximum entries retained per individual entity ID. Oldest entries are deleted. |
| `ttlDays` | 90 | Entries older than this duration (in days) are deleted. |

### Pruning Lifecycle Mechanics

1. **Inline Pruning (Continuous)**: Executed asynchronously immediately after any CRUD operation. It prunes entries for the active entity using a sub-select query with an `OFFSET` equivalent to your `maxEntries` setting, deleting everything beyond that threshold.
2. **Global Pruning (Periodic)**: A background cleanup cron sweep (`pruneExpired`) runs every **6 hours** to evaluate global `ttlDays` thresholds and clean up orphaned logs across all collections.

## Next Steps

- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks
- **[Backend Overview](/docs/backend)** — Full backend configuration
