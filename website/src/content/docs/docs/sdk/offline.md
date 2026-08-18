---
title: Offline & Local-First Sync
sidebar_label: Offline
description: Enable the Rebase Client SDK's local-first sync engine — a local row database, instant offline writes with rollback, and reactive live queries.
---

## Overview

Offline support turns the SDK's data layer into a **local-first sync engine**. Instead of a cache that remembers responses, the client keeps a small local database of rows, answers queries against it, and treats the network as something that fills it in and eventually accepts your writes.

Three things follow from that:

- **Reads survive the network going away.** A query the client can evaluate locally is evaluated locally — filters, sorting and pagination included — so a list keeps rendering with a dead connection.
- **Writes are decided locally.** A write made offline applies immediately, queues, and replays in order when the connection returns. If the server rejects it, the local change is rolled back.
- **Reads are reactive.** `observe()` emits from the local database first and re-emits whenever anything changes the rows it covers — your own writes, a queued write landing, a rollback, another browser tab, or a realtime event.

It is off by default. Turn it on with one option:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

In the browser everything persists to IndexedDB, so a reload keeps both the local rows and the unsent writes. Elsewhere (Node, tests) it falls back to memory; other runtimes can supply their own store.

## What changes

Nothing in the API you already use changes shape. `find()`, `findById()`, `create()`, `update()`, `delete()` and the fluent builder keep their signatures and their return types — they just stop failing when the network does.

### Reads

A successful read merges its rows into the local database and remembers which ids the server returned for that query. When a read cannot reach the server, it is answered locally:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Offline, this filters and sorts the rows the client holds. That includes rows fetched by *other* queries — the database is normalized, so a row is stored once no matter how many lists it appeared in — and rows you created offline.

If there is genuinely nothing to answer with (a collection the app has never read), the read throws a recognisable error rather than a bare `TypeError`:

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Writes

While the connection is known to be down, a write is not even attempted — it applies locally and queues, so it costs nothing instead of a timeout:

```typescript
// Returns immediately, offline or not.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Rows created offline get a client-generated id. If the server assigns its own on replay, the local row and any queued writes still pointing at the temporary id are moved to the real one.

Writes replay in the order you made them, across collections — so a create in one collection still lands before the row in another that references it.

## Live queries

`observe()` is the reactive read, and the one to reach for in a UI:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

The first emission comes from the local database with no request in the way; a revalidation follows in the background. After that it re-emits on every change to the rows it covers. Emissions are de-duplicated — a refresh that changes nothing does not call back — so it is safe to render straight from it.

Each result carries what a UI needs to describe itself:

| Field | Meaning |
|-------|---------|
| `data`, `meta` | The same shape `find()` returns |
| `fromCache` | The rows came from the local database, not a completed request |
| `hasPendingWrites` | At least one row here carries a write the server has not accepted |
| `partial` | The local database may not hold every matching row — treat as best effort |
| `error` | The last revalidation failed |

`observeById()` does the same for a single row, and passes `undefined` when it is deleted.

Both bind the realtime subscription when the client has one, so changes made by other users stream in too. Pass `{ realtime: false }` for a subscription that only reflects local state and explicit refreshes.

Without `offline` enabled, `observe()` still exists: it fetches once and stays live off realtime, with all three flags `false`.

## Sync state

`client.offline` exposes the engine, which is what a sync indicator is built from:

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Method | Purpose |
|--------|---------|
| `status()` | Current connectivity, queue depth, sync activity, last error |
| `onStatusChange(fn)` | Subscribe to the above |
| `onQueueChange(fn)` | Just the number of unsent writes, for a badge |
| `pending()` | The queued mutations themselves, oldest first |
| `sync()` | Replay now — resolves with `{ flushed, remaining }` |
| `clear()` | Discard the current user's queued writes **and** local rows |

Replay happens on its own: when the browser fires `online`, when the user signs in, and on an exponential backoff (one second, doubling to a minute) while anything is queued. `sync()` is for a "retry now" button.

## When the server says no

A queued write can be rejected — validation, row-level security, a row someone else deleted. Those never resolve on their own, so the engine rolls the local rows back to what they were before the write, discards the queued edits that were built on top of it, and tells you:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onSyncError: (error, mutation) => {
            toast(`Couldn't save your change to ${mutation.collection}: ${error.message}`);
        }
    }
});
```

The cascade is narrow: an `update` is discarded along with the write it edited, because it can only fail the same way. A later `create` or `delete` for the same row stands on its own and is kept.

A failure that is merely temporary — a 429, a 503, a dropped connection — is not a rejection. Those stay queued and are retried; only after `maxRetries` deferrals does a write get rolled back.

## Multiple tabs

Tabs of the same app share one IndexedDB database, so they share the local rows and the outbox. A write in one appears in the others, and only one tab at a time replays the queue. Nothing to configure.

## Users

The local database and the outbox are partitioned per signed-in user. Cached rows are whatever row-level security let that user see, and a queued write has to replay as its author — so signing out and back in as someone else never mixes the two. Signing out does not need to clear anything.

## Configuration

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerCollection: 5000,     // rows with unsent writes are never evicted
        maxCachedQueriesPerCollection: 50,    // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        onSyncError: (error, mutation) => {}
    }
});
```

### A custom store

Any environment can persist the local database by implementing `OfflineStore` — a namespaced key/value surface with a read-cache area and a queue area. This is how you back it with AsyncStorage in React Native, or with the filesystem in Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

The only contract beyond the obvious is that prefix listings come back in lexicographic key order — that is what makes the outbox a FIFO.

## Limits

The client is not a replica of your database, and it does not pretend to be:

- **Only rows the app has read or written are local.** A query the client has never sent can still be answered from what it holds, but the answer may be missing rows the server would have returned. Live results say so via `partial`.
- **`searchString` is approximated** as a case-insensitive substring scan over cached string fields. The server runs real full-text search over the collection's configured columns.
- **`include`d relations cannot be evaluated locally** — the related rows live in collections the query never loaded. Such a query is always marked `partial` when answered from the cache.
- **Replay is at-least-once.** A write that reaches the server but whose response is lost may be sent again. Prefer idempotent writes (`createMany` with `upsert`) where duplicates would matter.
- **Local reads apply Postgres semantics, not the database's data.** Filters are evaluated the way SQL would — comparisons against `NULL` are unknown, `ORDER BY` puts nulls last ascending and breaks the remaining ties on the row id descending, exactly as the server does — but against the client's copy of the rows, which may be stale.
- **A sort the client cannot reproduce is not applied.** Ordering text is the server's to do: PostgreSQL sorts it by the *database's* collation, which this process has never been told, and under the C collation `Banana` sorts before `apple` where a JavaScript collator says otherwise. When a sort column cannot be compared numerically the rows keep the order the server sent, and the result is marked `partial` rather than being presented as the sorted page that was asked for. Every key of a multi-column sort has to be reproducible, not just the first — a sort the local side can only agree with down to its second column is one it disagrees with.

## Recipe: an offline indicator

```tsx
import React from "react";
import type { CreateRebaseClientResult } from "@rebasepro/client";

export function SyncIndicator({ client }: { client: CreateRebaseClientResult }) {
    const offline = client.offline!;
    const [status, setStatus] = React.useState(offline.status());
    React.useEffect(() => offline.onStatusChange(setStatus), [offline]);

    if (!status.online) {
        return <span className="badge warning">
            Offline{status.pending ? ` · ${status.pending} unsaved` : ""}
        </span>;
    }
    if (status.syncing) return <span className="badge">Syncing…</span>;
    if (status.pending) return <span className="badge">{status.pending} unsaved</span>;
    return null;
}
```

## See also

- [Querying Data](/docs/sdk/querying) — the query surface `observe()` shares with `find()`
- [Realtime Subscriptions](/docs/sdk/realtime) — server-pushed updates, which live queries build on
