---
title: Offline & Local-First Sync
sidebar_label: Offline
description: Enable the Rebase typed SDK's local-first sync engine — a local row database, instant offline writes with rollback, and reactive live queries.
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
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Rows created offline get a client-generated id, in the type the collection's ids already have: a **negative integer** where they are numbers, a UUID string where they are strings. The sign is the tell — a real key is never negative — so a row that has not reached the server yet is recognisable without a lookup, and `id` still typechecks as whatever the generated `Row` says it is. On a collection this device has never read there is nothing local to read the type off, and the id is a UUID.

If the server assigns its own on replay, the local row and any queued writes still pointing at the temporary id are moved to the real one, in every collection: a post queued with `author_id` set to an author created offline is sent with the id the server gave the author. If the server refuses the author instead, writes that reference it are discarded with it and reported as `DEPENDENCY_REJECTED` (see [When the server says no](#when-the-server-says-no)). Until then, do not persist a temporary id anywhere outside the offline database — a foreign key or a bookmarked URL holding one points at a row that is about to be renumbered.

Writes replay in the order you made them, across collections — so a create in one collection still lands before the row in another that references it.

Each queued write is one request by default, so 500 rows typed offline take 500 round trips to drain. With `replayBatchSize` set (up to 1 000), a run of consecutive offline creates in one collection replays as one `createMany` instead. Only creates with an id the SDK generated as a string are folded, and never one that references another row of the same run. If the server refuses or defers the run for any reason other than a lost connection, nothing is written (a bulk write is one transaction), and the run replays one write at a time, as it would by default.

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

`observeById()` does the same for a single row, and passes `undefined` when it is deleted. It takes `include` as `findById()` does, and every emission carries those relations:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

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
| `status()` | Current connectivity, queue depth, sync activity, last error, and `persisted`: whether the browser agreed to keep the offline database (asked when the first write is queued; `false` means it may be evicted under storage pressure, unsent writes included). `unverifiedUser` is `true` while an offline reload shows the last user's data without a confirmed session (see [`keepLastUser`](#offline-reloads-in-cookie-mode)) |
| `onStatusChange(fn)` | Subscribe to the above |
| `onQueueChange(fn)` | Just the number of unsent writes, for a badge |
| `pending()` | The queued mutations themselves, oldest first. `pending({ orphaned: true })`: the ones queued while signed out — see [Users](#users) |
| `sync()` | Replay now — resolves with `{ flushed, remaining }` |
| `clear()` | Discard the current user's queued writes **and** local rows. `clear({ orphaned: true })`: the ones queued while signed out instead |

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

A row someone else deleted is the one case that is not rolled back. A queued `delete` of it did what it was for, so it counts as synced and is not reported. A queued edit of it is reported, and the row is removed from the local database instead of being restored, because the server no longer has it.

The cascade is narrow: an `update` is discarded along with the write it edited, because it can only fail the same way. A later `create` or `delete` for the same row stands on its own and is kept. A refused `create` of a row created offline also takes with it every queued write, in any collection, whose values reference the row's temporary id. A discarded write was never sent. It is reported with a `RebaseApiError` whose `code` is `DEPENDENCY_REJECTED` and whose `cause` is the refusal that doomed it, so you can tell it from the write the server actually refused. On 0.23 it carries the refused write's own error instead.

Consecutive edits to one row while offline are merged into a single queued write, so a form being typed into does not grow the queue. A write the queue has started sending is not merged into: an edit made after a replay attempt whose answer was lost queues as an update of its own, and a delete of a row created offline is sent rather than cancelled against its create, since the server may already hold the row. If the server refuses the merged write over its contents (a 400, 403 or 422 — say, a field removed by a schema change while the user was offline), the engine splits it back into the separate edits and replays each one. Only the edit the server refuses is rolled back and reported; the others are kept.

### Conflicts

By default an edit queued offline overwrites whatever the server has for the fields it changes, even if someone else changed them meanwhile. To find out instead, pass `onConflict`. A queued `update` then replays with `If-Match`, the version of the row it was made against, and when the row has changed since, the server refuses it with a 412 and `onConflict` decides:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onConflict: async (error, mutation) =>
            (await askUser(`${mutation.collection} changed while you were offline. Keep your edit?`))
                ? "overwrite"
                : "discard"
    }
});
```

- `"overwrite"` sends the edit again without the precondition: the last writer wins, as without `onConflict`.
- `"discard"` drops the edit. The row goes back to what it was before it, as for a rejection, and is read again from the server. It is not reported to `onSyncError`; writes queued on top of it are, as `DEPENDENCY_REJECTED`.

The queue waits while `onConflict` runs, so it can ask the user. If it throws, the edit is overwritten.

The version an edit is made against is the one the row's last read reported: `findById()`, a `listenById()` frame, or the answer to an earlier `update()`. A row last read in a `find()` or `listen()` list has no version, and neither has an edit made on top of another queued write to the same row. Those replay without a precondition. An `ifMatch` you pass to `update()` or `delete()` yourself is kept when the write queues, with or without `onConflict`, and `findById()` on an offline-enabled client returns the row with its version, so `etagOf(row)` works as it does online. Without `onConflict`, a queued write refused over your own `ifMatch` is rolled back and reported to `onSyncError` with a 412 `PRECONDITION_FAILED`.

A failure that is merely temporary — a 429, a 503, a dropped connection — is not a rejection. Those stay queued and are retried; only after `maxRetries` deferrals does a write get rolled back.

## Multiple tabs

Tabs of the same app share one IndexedDB database, so they share the local rows and the outbox. A write in one appears in the others, and only one tab at a time replays the queue. Nothing to configure.

That last guarantee comes from the browser's [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), which exists only in a secure context (HTTPS, or `localhost`) and not in Safari before 15.4 or in some embedded webviews. Without it, every open tab replays the queue when it syncs. Creates, bulk writes, updates and deletes all replay under an idempotency key, so a server that stores keys applies each of them once; what you can see is the same write sent from two tabs.

## Users

The local database and the outbox are partitioned per signed-in user. Cached rows are whatever row-level security let that user see, and a queued write has to replay as its author — so signing out and back in as someone else never mixes the two. Signing out does not need to clear anything.

### While the session is being restored

Until the client knows who is signed in, it does not know whose local database and outbox to use, so offline reads and writes wait. That is the time `auth.isInitialized()` takes: none for a stored session that is still valid, and one refresh request when the session has to come back from the server — in cookie mode, where nothing is stored on the device, that is every page load. A write made in that window is queued as whoever the session turns out to be, and a read answers from their local database. A realtime frame that arrives meanwhile is passed to your callback as the server sent it, and kept nowhere.

If the session cannot be restored — the refresh is refused, or in cookie mode cannot reach the server — the client is signed out, and offline reads and writes are the signed-out user's. On 0.23, cookie mode treated the whole window as signed out, so a write made in it was queued as the signed-out user's.

### Writes made while signed out

Writes queued while nobody was signed in are not replayed when someone signs in. That user did not make them, and replaying them with their credentials would put one person's changes in another's name — on a shared device, a visitor's writes in the next user's account. They are not moved into the signed-in user's outbox either. They are kept and listed separately, so the app can decide what to do with them:

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Re-issue each one yourself, now as the signed-in user.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` discards them, with the local rows they were applied to; the signed-in user's own outbox is left alone. If the app does nothing with them, they replay the next time nobody is signed in. While nobody is signed in they are simply the current outbox, and `pending({ orphaned: true })` lists nothing.

### Offline reloads in cookie mode

In cookie mode nothing about the session is stored on the device, so a reload
that cannot reach the server has no user. By default it is treated as signed
out: the user's local rows are hidden, and writes made then queue as the
signed-out user's.

`keepLastUser: true` changes that. The client remembers the last user who
signed in on the device (their id only), and an offline reload opens that
user's local database instead. Writes made then queue as theirs, but none
replays until the session is confirmed: when the connection is back the
client refreshes the session, and a sign-in confirms it too. If the server
refuses the session, or someone else signs in, the device switches users, and
the queued writes stay with their author until they sign in again. Meanwhile
`status().unverifiedUser` is `true`, and that holds online too: until the
refresh answers, writes queue rather than go out without credentials, and reads
are answered from the user's local rows. What the server sends a request with
no session is what a signed-out caller may see, so it is not kept.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

It is off by default because on a shared device it lets the previous user's
cached rows be read offline without a session. Turn it on for installs that
belong to one person. The id is forgotten at sign-out and when the server
refuses the session. It is never used when the server answers that there is no
session.

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
        keepLastUser: false,                  // open the last user's data on an offline reload (cookie mode)
        replayBatchSize: 1,                   // queued creates sent per request on replay (max 1000)
        onConflict: (error, mutation) => "overwrite", // or "discard"; default: no conflict check
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
- **`findAll()` and `iterate()` read only pages the server answered on this device.** A walk goes on for as long as each page says there is more, and only the server can say that. Offline, a walk that needs a page this device never fetched fails with the `OFFLINE` error (`isOfflineError`) instead of returning part of the collection as if it were all of it. On 0.24 it stopped at that page and returned what it had.
- **`count()` offline needs a count the server gave this device for the same query.** Writes queued since then move it: creates, edits that take a row into or out of the filter, and deletes. Without one it fails with the `OFFLINE` error rather than counting the rows this device happens to hold. On 0.24 it returned that number.
- **`searchString` is approximated** as a case-insensitive substring scan over cached string fields. The server runs real full-text search over the collection's configured columns.
- **`include`d relations cannot be evaluated locally** — the related rows live in collections the query never loaded. Such a query is always marked `partial` when answered from the cache.
- **Conflicts are last-writer-wins, per field, unless you pass `onConflict`.** A replayed `update` sends the fields the user changed and nothing else, so fields they did not touch keep whatever the server has. For a field they *did* change, a change someone else made on the server while they were offline is overwritten when the queue replays, and neither user is told. With [`onConflict`](#conflicts), an edit whose row version is known is checked against the server's, and the app decides. Creates, deletes and bulk writes are never checked.
- **Replay is at-least-once.** A write that reaches the server but whose response is lost may be sent again. Prefer idempotent writes (`createMany` with `upsert`) where duplicates would matter.
- **The trash needs the server.** The local database holds live rows only, so `trash.find()`, `trash.count()`, `trash.restore()` and `trash.purge()` (see [soft delete](/docs/collections/soft-delete#from-the-sdk)) are never answered locally or queued: offline they fail with the `OFFLINE` error. A restore or purge of a row with a write still queued syncs the queue first, and is refused with `TRASH_PENDING_WRITE` if the write cannot be sent yet.
- **An upsert on a natural key needs the server.** Which row an `onConflict` target names is the server's to find, so `upsert()` on a natural key (or without the row's id), and a `createMany()` with `onConflict` that was never sent, are refused while offline with `OFFLINE_UPSERT_UNSUPPORTED`. An upsert on the primary key, with the key in each row, is queued.
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
