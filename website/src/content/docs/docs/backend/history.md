---
title: Entity History
sidebar_label: Entity History
description: Track every change to your entities with a full audit trail — who changed what, when, and the complete before/after entity.
---

## Overview

Entity history records a snapshot of entity values on every create, update, and delete. This gives you a full audit trail with diffs.

## Enabling History

:::note[Where this goes]
**Managed runtime** — on by default. `REBASE_HISTORY=false` in `.env` turns it off.

**Ejected** — `history: true` in `initializeRebaseBackend({ … })`. The object form below — `{ retention }` — is ejected-only; the environment variable is a boolean.

The full map is in [Backend Overview](/docs/backend/#where-each-option-lives).
:::

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

Or with a custom retention period:

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
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
2. On every create, update, or delete, a snapshot is recorded with:
   - Entity ID, and the collection slug (in `table_name`)
   - The full entity values (before and after)
   - Timestamp and user ID
   - The action (`create`, `update`, `delete`)
   - An array of `changed_fields` showing which columns were modified

### Diff Tracking & Structural Deep Equality

To avoid recording redundant logs where fields are saved but no values change, the `HistoryService` performs a structural deep equality comparison on the top-level keys of the old and new values:
- It ignores system metadata properties starting with `__`.
- If differences are found, the names of the modified properties are saved in the `changed_fields` (`text[]`) column.
- If the deep equality check detects zero changes, the history insertion is entirely skipped.

### Non-Blocking Post-Save Pruning

Unlike traditional systems that rely entirely on slow periodic batch scripts, Rebase enforces your retention policies continuously:
- Right after an entity is saved or deleted, the server schedules an **inline asynchronous sweep** in a non-blocking, fire-and-forget promise.
- This sweep immediately checks retention limits for that specific entity ID and prunes entries beyond the newest 200, or older than the retention period.

## REST Endpoint

```
GET /api/data/:slug/:entityId/history
```

Returns a list of history entries for a specific entity, ordered by most recent first:

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending", "total": 99.99 },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

## Retention Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `retention` | 90 | Entries older than this many days are deleted. |

Each entity also keeps at most its newest **200** entries. That cap is fixed; it
has no setting.

### Pruning Lifecycle Mechanics

Pruning is inline only. It runs asynchronously right after each recorded change,
for the entity that changed: entries older than the retention period go, then
everything beyond the newest 200. There is no periodic sweep, so the history of
an entity that is never written again is not pruned — its old entries stay until
the next change to that entity, or until you delete them from
`rebase.entity_history` yourself.

## Next Steps

- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks
- **[Backend Overview](/docs/backend)** — Full backend configuration
