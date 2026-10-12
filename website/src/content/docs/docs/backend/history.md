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
2. On every create, update, or delete, an entry is recorded with:
   - Entity ID, and the collection slug (in `table_name`)
   - The entity's values after the change (`values`; for a delete, the entity
     that was deleted)
   - On an update, what the changed fields held before it (`previous_values`)
   - Timestamp and user ID
   - The action (`create`, `update`, `delete`)
   - An array of `changed_fields` showing which columns were modified

The values are the row as the REST API serves it: its columns, dates as
timestamps, a `belongsTo` as its foreign key. That is what a revert writes back.

An entry never holds a related row's values. Reading a row's history needs only
read access to that row, not to the rows it points at, so a relation is kept as
a reference — `{ "__type": "relation", "id", "path" }` — and nothing more.
Entries that older versions recorded with the related row embedded (a delete
used to store the admin panel's view of the row) are served the same way: the
history endpoint drops the embedded values before it answers.

On a collection with [soft delete](/docs/collections/soft-delete/), a delete is
recorded as `delete` and a restore (the update setting the soft-delete field
back to `null`) as `update`. A row's history stays readable while the row is in
the trash, and reverting it to a version from before the delete restores it.

### What `previous_values` holds

<span class="since-badge" data-since="0.25">Since 0.25</span> An update entry
keeps, in `previous_values`, only the fields listed in `changed_fields`. Every
other field held the same value before and after the change, so it is in
`values` already; storing the whole row twice cost a one-field change to a
20-field row 1,269 bytes, where it now costs 794.

Entries recorded before 0.25 keep the whole previous row. The entry's `format`
says which it is:

| `format` | `previous_values` on an update |
|---|---|
| `1` (entries from before 0.25) | The whole row before the change |
| `2` | The `changed_fields` only, each as the whole row had it |

The admin's history view and a revert read both alike: the view shows each
changed field's previous value, and a revert writes the chosen entry's `values`,
which are whole in both formats. To rebuild the row as it was before a
`format: 2` change, take `values` and put back each field `previous_values`
holds.

### Diff Tracking & Structural Deep Equality

To avoid recording redundant logs where fields are saved but no values change, the `HistoryService` performs a structural deep equality comparison on the top-level keys of the old and new values:
- It ignores system metadata properties starting with `__`.
- If differences are found, the names of the modified properties are saved in the `changed_fields` (`text[]`) column.
- If the deep equality check detects zero changes, the history insertion is entirely skipped.

### Pruning

Retention is enforced in two places:
- **After each write**, for the entity written: right after it is saved or
  deleted, the server prunes that entity's entries beyond the newest 200, or
  older than the retention period. It does not hold up the write.
- <span class="since-badge" data-since="0.25">Since 0.25</span> **Once an hour**,
  for every entity: entries older than the retention period are deleted
  whatever they belong to — including entities that are never written again,
  such as deleted ones. See [Pruning lifecycle](#pruning-lifecycle-mechanics).

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
            "previous_values": { "status": "pending" },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z",
            "format": 2
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

After each recorded change, the entity that changed is pruned: its entries older
than the retention period go, then everything beyond its newest 200. This runs
asynchronously and does not hold up the write.

<span class="since-badge" data-since="0.25">Since 0.25</span> Once an hour, the
backend also deletes every entry older than the retention period, of every
entity. Before this, the history of an entity that was never written again —
every deleted one — was not pruned at all. The sweep:

- runs on one instance of the fleet per hour, on the processes that run the
  scheduled jobs (it claims its hour in `rebase.cron_claims`, as a cron run
  does), first when the backend starts;
- deletes in batches of 5,000 entries, one statement each, until a batch comes
  back short, skipping entries another sweep holds — so a first sweep over a
  large backlog is many short deletes, not one long one;
- reads an index on `updated_at`, `idx_history_updated_at`. On a database
  created before 0.25 it is built in the background after the first boot,
  `CREATE INDEX CONCURRENTLY`, without blocking reads or writes — about a
  second per 2 million entries.

The same boot drops `idx_history_entity` where it exists: `idx_history_time`
leads with the same columns and serves every read it did, so it only slowed each
recorded change. The drop waits at most a second at a time for the table's lock,
and a table something holds throughout keeps the index until the next boot.

The cap of 200 entries per entity is applied only after a write to that entity.

## Next Steps

- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks
- **[Backend Overview](/docs/backend)** — Full backend configuration
