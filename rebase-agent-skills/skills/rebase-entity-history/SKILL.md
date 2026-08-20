---
name: rebase-entity-history
description: Guide for tracking and reverting entity changes with Rebase's built-in history/audit-log system. Use this skill when the user needs entity versioning, change tracking, audit logs, reverting to previous versions, or understanding how history entities work.
---

# Rebase Entity History

Rebase includes a built-in entity history system that records entities of every create, update, and delete operation. History entries are stored in a dedicated PostgreSQL table and exposed via REST API endpoints. The admin panel shows the revisions in the record inspector, with one-click revert.

> **IMPORTANT FOR AGENTS:** Entity history requires **two** things to be enabled: (1) the global `history` flag in the backend config, AND (2) `history: true` on each individual collection. If either is missing, no history is recorded for that collection — the driver's guard is literally `historyService && collection.history`.
>
> Under the **runtime** (`rebase dev`, `rebase start`, the published image — the default) the global flag comes from `REBASE_HISTORY`, which **defaults to `true`**. So in a scaffolded project the global half is already on and the per-collection `history: true` is the one you have to write. A hand-written `initializeRebaseBackend` call has to pass `history` itself.

## Enabling History

### Step 1 — Enable History Globally (Backend Config)

Add `history: true` (or a configuration object) to `initializeRebaseBackend()`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({ connectionString: env.DATABASE_URL }),
    collections: [...collections],

    // ── Enable entity history globally ──
    history: true,

    auth: { /* ... */ },
});
```

The `history` property accepts either:

| Value | Behavior |
|-------|----------|
| `true` | Enable history with default retention settings |
| `{ retention: number }` | Enable history with a custom TTL (in days) for automatic pruning |
| `false` / `undefined` | History disabled (default) |

```typescript
// Custom retention: prune entries older than 30 days
history: { retention: 30 },
```

### Step 2 — Enable History Per-Collection

On each collection that should be tracked, set `history: true`:

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const productsCollection: PostgresCollectionConfig = {
    slug: "products",
    name: "Products",
    table: "products",

    // ── Enable history for this collection ──
    history: true,

    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" },
        status: { type: "string", name: "Status" },
    },
};
```

> **WARNING FOR AGENTS:** Setting `history: true` on a collection has **no effect** if the global `history` flag is not also set in the backend config. Both must be enabled.

## How History Recording Works

History is recorded **fire-and-forget** — it never blocks or slows down the main save/delete operation. Errors during history recording are logged to the console but do not propagate.

### When History Entries Are Created

| Operation | Action Recorded | What's Stored |
|-----------|----------------|---------------|
| Create entity | `"create"` | Full entity values |
| Update entity | `"update"` | New values + previous values + list of changed fields |
| Delete entity | `"delete"` | Final entity values before deletion |

### Skipped Updates

Updates that produce **zero actual field changes** are silently skipped — no history entry is created. The system uses deep structural comparison (not reference equality) to detect whether values actually changed, including nested objects, arrays, and Date values.

### Changed Field Detection

For updates, the system compares old and new values field-by-field and records only the keys that changed. Internal metadata fields (prefixed with `__`) are excluded from change detection.

## History Entry Format

Each history entry has the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key of the history entry |
| `table_name` | `string` | The collection slug / table path |
| `entity_id` | `string` | The ID of the entity this entry belongs to |
| `action` | `"create" \| "update" \| "delete"` | What operation was performed |
| `changed_fields` | `string[] \| null` | Array of field names that changed (only for updates) |
| `values` | `Record<string, unknown> \| null` | Full entity values entity at the time of the change |
| `previous_values` | `Record<string, unknown> \| null` | Previous entity values (only for updates) |
| `updated_by` | `string \| null` | UID of the user who made the change |
| `updated_at` | `string` (ISO 8601) | Timestamp of when the change was recorded |

### Example History Entry (JSON)

```json
{
    "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "table_name": "products",
    "entity_id": "42",
    "action": "update",
    "changed_fields": ["price", "status"],
    "values": {
        "name": "Widget",
        "price": 29.99,
        "status": "active"
    },
    "previous_values": {
        "name": "Widget",
        "price": 19.99,
        "status": "draft"
    },
    "updated_by": "user-uuid-here",
    "updated_at": "2025-01-15T10:30:00.000Z"
}
```

## REST API Endpoints

History endpoints are mounted under the data router at `{basePath}/data/:slug/:entityId/history`. They require the same authentication as regular data routes.

### List History Entries

```
GET /api/data/:slug/:entityId/history
```

| Query Parameter | Type | Default | Description |
|-----------------|------|---------|-------------|
| `limit` | `number` | `20` | Number of entries to return (max `100`) |
| `offset` | `number` | `0` | Number of entries to skip |

**Response:**

```json
{
    "data": [
        {
            "id": "abc-123",
            "table_name": "products",
            "entity_id": "42",
            "action": "update",
            "changed_fields": ["price"],
            "values": { "name": "Widget", "price": 29.99 },
            "previous_values": { "name": "Widget", "price": 19.99 },
            "updated_by": "user-uuid",
            "updated_at": "2025-01-15T10:30:00.000Z"
        }
    ],
    "meta": {
        "total": 47,
        "limit": 20,
        "offset": 0,
        "hasMore": true
    }
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| `404` | Collection slug not found |
| `400` | History not enabled for this collection |

### Revert to a Historical Version

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

No request body is needed. The server fetches the stored `values` from the history entry and saves them through the normal entity save path.

**Response:**

```json
{
    "data": {
        "id": "42",
        "values": { "name": "Widget", "price": 19.99, "status": "draft" }
    },
    "meta": {
        "reverted_from": "abc-123"
    }
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| `404` | Collection or history entry not found |
| `400` | History not enabled for the collection |
| `400` | History entry belongs to a different entity (cross-entity revert blocked) |
| `400` | History entry has no stored values |

> **IMPORTANT FOR AGENTS:** Reverting goes through the **normal save path**, which means: (1) it triggers all `beforeSave` / `afterSave` callbacks, (2) it creates a **new history entry** for the revert operation itself, providing a complete audit trail, and (3) it notifies real-time subscribers of the change.

### Example: Fetch and Revert via cURL

```bash
# List history for entity 42 in the "products" collection
curl -H "Authorization: Bearer $TOKEN" \
     "http://localhost:3001/api/data/products/42/history?limit=10&offset=0"

# Revert entity 42 to the state captured in history entry "abc-123"
curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     "http://localhost:3001/api/data/products/42/history/abc-123/revert"
```

### Example: Fetch via JavaScript (fetch API)

```typescript
async function getEntityHistory(slug: string, entityId: string, token: string) {
    const response = await fetch(
        `http://localhost:3001/api/data/${slug}/${entityId}/history?limit=20&offset=0`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const result = await response.json();
    // result.data — array of HistoryEntryData
    // result.meta — { total, limit, offset, hasMore }
    return result;
}

async function revertEntity(slug: string, entityId: string, historyId: string, token: string) {
    const response = await fetch(
        `http://localhost:3001/api/data/${slug}/${entityId}/history/${historyId}/revert`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        }
    );
    const result = await response.json();
    // result.data — the reverted entity
    // result.meta.reverted_from — the history entry ID used
    return result;
}
```

## Pagination

History entries are returned in **reverse chronological order** (newest first).

| Parameter | Default | Maximum | Minimum |
|-----------|---------|---------|---------|
| `limit` | `20` | `100` | N/A (clamped with `Math.min`) |
| `offset` | `0` | N/A | `0` (clamped with `Math.max`) |

Use the `meta.hasMore` boolean in the response to determine if more pages are available:

```typescript
let offset = 0;
const limit = 20;
let allEntries = [];

while (true) {
    const result = await fetch(`/api/data/products/42/history?limit=${limit}&offset=${offset}`);
    const json = await result.json();
    allEntries.push(...json.data);

    if (!json.meta.hasMore) break;
    offset += limit;
}
```

## Database Storage

### Table Schema

History data is stored in a dedicated table in the `rebase` schema:

```sql
-- Auto-created on startup when history is enabled
CREATE TABLE IF NOT EXISTS rebase.entity_history (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    table_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,          -- 'create', 'update', or 'delete'
    changed_fields TEXT[],         -- array of changed field names (updates only)
    "values" JSONB,               -- full entity values entity
    previous_values JSONB,        -- previous values (updates only)
    updated_by TEXT,              -- user UID who made the change
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_history_entity
    ON rebase.entity_history(table_name, entity_id);

CREATE INDEX IF NOT EXISTS idx_history_time
    ON rebase.entity_history(table_name, entity_id, updated_at DESC);
```

> **IMPORTANT FOR AGENTS:** The `rebase.entity_history` table is **auto-created** on server startup when history is enabled. You do NOT need to create it manually or include it in migrations. The `rebase` schema is also created automatically if it doesn't exist.

### Storage Characteristics

- **Values are stored as JSONB** — full entities, not diffs. This makes revert simple and reliable but uses more storage.
- **All collections share one table** — the `table_name` column distinguishes between collections.
- **Entity IDs are stored as text** — regardless of the original column type.
- **Indexes** cover `(table_name, entity_id)` and `(table_name, entity_id, updated_at DESC)` for fast per-entity lookups.

## Retention and Automatic Pruning

The history service automatically prunes old entries to prevent unbounded storage growth. Pruning happens **non-blocking** after every insert (per-entity scope).

### Retention Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `maxEntries` | `number` | `200` | Maximum entries kept per entity. Oldest pruned first |
| `ttlDays` | `number` | `90` | Entries older than this many days are deleted |

### How Pruning Works

After every history insert, two pruning passes run in the background for that specific entity:

1. **TTL pass** — Delete entries older than `ttlDays`
2. **Max entries pass** — Keep only the newest `maxEntries` entries, delete the rest

Pruning errors are logged but never block the main operation.

### Configuring Retention

Pass the `retention` option (in days) through the global history config:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: { retention: 30 },  // TTL of 30 days
});
```

This sets the `ttlDays` value. The `maxEntries` default of `200` is currently not configurable through the backend config and uses the service default.

### Global Pruning

The `HistoryService` also exposes a `pruneExpired()` method for global TTL-based cleanup (deletes expired entries across ALL entities in one sweep). This is intended to be called periodically — e.g., from a cron job:

```typescript
// In a cron job handler (e.g., backend/src/crons/prune-history.ts)
import { rebase } from "@rebasepro/server";

export default {
    schedule: "0 3 * * *",  // Daily at 3 AM
    handler: async () => {
        // Note: requires direct access to the history service via driver internals
        // This is an advanced pattern — the global prune is automatic per-entity
        console.log("History pruning handled automatically per-entity on insert");
    }
};
```

## Admin Panel Integration

When history is enabled for a collection, the admin panel offers **History** in
the record's overflow (`⋮`) menu, beside **Inspect record**. Both open the record
inspector — a panel beside the form, not a tab in front of it — so the record
you are inspecting stays on screen while you read its revisions. The panel:

- Displays a paginated list of history entries with infinite scroll
- Shows the action type, changed fields, timestamp, and user who made the change
- Provides a **Revert** button on each entry with a confirmation dialog
- After revert, resets the form with the restored values (no page refresh needed)
- Warns users to save or discard unsaved changes before reverting

Columns the backend stamps itself — the audit timestamps and the primary key —
are left out of each entry's diff: they change on every write, and the entry
already states when it happened and which record it belongs to.

No additional configuration is needed — the menu entry appears for any
collection with `history: true`.

## Client SDK Usage

There is currently **no dedicated client SDK method** for entity history. History is accessed via the REST API directly (as shown in the endpoints section above).

The admin panel uses an internal `useHistory` React hook that:
- Fetches history from `GET /api/data/:slug/:entityId/history`
- Supports pagination via offset-based loading
- Provides a `revert()` function that calls `POST /api/data/:slug/:entityId/history/:historyId/revert`

For custom client applications, use `fetch()` directly against the REST endpoints with your auth token.

## Complete Setup Example

```typescript
// backend/src/index.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "http";
import { initializeRebaseBackend, loadEnv } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { defaultUsersCollection } from "@rebasepro/common";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });
const env = loadEnv();

const app = new Hono<HonoEnv>();
const server = createServer(getRequestListener(app.fetch));

// Collection with history enabled
const productsCollection = {
    slug: "products",
    name: "Products",
    table: "products",
    history: true,  // ← Per-collection opt-in
    properties: {
        name: { type: "string" as const, name: "Name" },
        price: { type: "number" as const, name: "Price" },
        description: { type: "string" as const, name: "Description" },
    },
};

// Collection WITHOUT history
const logsCollection = {
    slug: "logs",
    name: "Logs",
    table: "logs",
    // history: false (default) — high-volume tables shouldn't track history
    properties: {
        message: { type: "string" as const, name: "Message" },
        level: { type: "string" as const, name: "Level" },
    },
};

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connectionString: env.DATABASE_URL,
    }),
    collections: [productsCollection, logsCollection, defaultUsersCollection],

    // ── Enable history globally with 60-day retention ──
    history: { retention: 60 },

    auth: {
        collection: defaultUsersCollection,
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
    },
});

console.log(`Server running at http://localhost:${env.PORT}`);
```

## Performance Considerations

### Write Performance

- History recording is **fire-and-forget** — it runs asynchronously and never blocks the save/delete response.
- For updates, the system fetches the **previous entity values** before saving (to compute `changed_fields` and store `previous_values`). This adds one extra `SELECT` query per update.
- Updates with zero actual changes are skipped entirely — no history entry is created.

### Storage Growth

- Each history entry stores **full JSONB entities** of both current and previous values. For entities with large text fields or complex nested structures, this can grow quickly.
- Default retention limits: **200 entries per entity** and **90 days TTL**. Adjust these based on your use case.
- All collections share the single `rebase.entity_history` table — monitor its size with:

```sql
SELECT pg_size_pretty(pg_total_relation_size('rebase.entity_history'));
```

### Recommendations

| Scenario | Recommendation |
|----------|---------------|
| High-write collections (logs, analytics, events) | Do NOT enable `history: true` — the volume will overwhelm storage |
| Content/CMS collections (articles, products, pages) | Enable history — great for audit trails and undo |
| User-facing data (orders, profiles) | Enable history — useful for compliance and support |
| Large text fields (markdown, HTML, JSON blobs) | Consider shorter retention (`history: { retention: 14 }`) to limit storage |

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
