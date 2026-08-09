# Unit 34 — Offline support and sync

Read-only audit, 2026-08-09. Scope: `packages/client/src/offline.ts`, `offline-query.ts`,
`offline-store.ts` (which is also the IndexedDB store — there is no separate `offline-idb-store.ts`),
`offline-codec.ts`, `offline-connectivity.ts` and their four test files
(`offline.test.ts`, `offline-sync-engine.test.ts`, `offline-idb-store.test.ts`,
`offline-integration.test.ts`; there is no `offline-sync-engine.ts`, the engine is `OfflineManager`).
Cross-read against the wiring in `packages/client/src/index.ts` and `auth.ts`, the write surface in
`packages/client/src/collection.ts`, the wire codec in `packages/common/src/data/filter-dialect.ts`,
the pagination walker in `packages/common/src/data/paginate.ts`, the REST routes in
`packages/server/src/api/rest/api-generator.ts`, and the public documentation
`website/src/content/docs/docs/sdk/offline.md`.

## Verdict

The replay engine's *own* bookkeeping is in good shape and has clearly been through a hostile pass:
ordering is FIFO by a lexicographically-time-ordered key, the in-flight guards in `enqueue` are
id-based rather than boolean, the rejection cascade stops precisely where a later write stops
depending on the rejected one, eviction can never touch a row with an unsent write, and the
just-landed `IDEMPOTENCY_KEY_IN_PROGRESS` separation is coherent from `isDuplicateKeyError` all the
way through to the retry budget. The local query evaluator is unusually honest — it refuses to claim
exactness for ordering comparisons it cannot reproduce under an unknown Postgres collation, and says
so in the code.

The damage is at the edges, and it is concentrated in three places the tests do not reach.

First, **the queue is scoped to a user the client may not know yet**. In `authFlowMode: "cookie"` the
session is never persisted, so *every* boot starts at scope `anon` and only flips to the real uid
after a network round trip. Reload while offline and the refresh fails: the user's cached rows are
invisible (the app looks empty), everything they write for the rest of that session queues under
`anon|`, and the moment connectivity returns the silent refresh succeeds, `setScope(uid)` fires, and
the entire session's work is discarded from memory and never replayed. Nothing is reported.

Second, **two paths silently dequeue or misroute a write**. A replayed create that gets a 409 and
then cannot read the row back is treated as success and dropped from the queue — no rollback, no
`onSyncError`, `pending` goes to zero and the sync indicator says "all saved" over a record that
exists nowhere. And any in-flight request that resolves *after* a scope change writes its rows into
the new user's cache namespace, because `ingest`/`ingestReplaced`/`rowKey` all read `this.scope` at
write time while only the *load* paths capture it.

Third, **`isExactlyEvaluable` throws on `where` shapes the rest of the stack documents as valid**.
`{ status: undefined }` — the way `assertNoUndefinedFilterValues` and `serializeFilter` both tell you
to skip a filter — and the bare-string wire form both reach `(condition as unknown[]).filter(...)` on
a non-array. Turning `offline: true` on converts a working conditional-filter query into a
`TypeError` on every read.

Underneath those: conflict resolution is blind last-write-wins with no version, no `If-Match` and no
mention of any of that in the documentation; single-row `update` and `delete` replay without an
idempotency key because the SDK's `update`/`delete` do not accept `WriteOptions` at all, which is what
makes the known delete-resurrection bug reachable; and `syncIntervalMs: 0` disables the `online`-event
replay its own docblock promises — the mode that every single test in the suite runs in.

Counts: 4 high, 10 medium, 8 low.

---

## HIGH

### H1 — A replayed create can be silently dequeued with nothing written

`packages/client/src/offline.ts:1563-1596`, dropped at `:1536-1538`

```ts
if (!(op.generatedId === true && isDuplicateKeyError(error))) throw error;
row = await inner.findById(op.id!).catch(() => undefined) as AnyRow | undefined;
// The read can fail on its own (offline again, RLS). The row is
// known to exist, so keep the local copy rather than rolling back;
// the next refresh reconciles it.
if (!row) return;
```

`replay` returning normally is `flush`'s success signal. Two lines later it calls
`this.connectivity.markSuccess()` and `await this.drop(op)`, so the mutation leaves the queue and the
store. The comment's claim that "the row is known to exist" is only true when the 409 really was this
write's own earlier attempt; `isDuplicateKeyError` also answers true for *any* 409 that is not
`IDEMPOTENCY_KEY_IN_PROGRESS` (`offline-connectivity.ts:90-94`), and the follow-up read can fail for
reasons that say nothing about the row.

**Failure scenario.** Offline; the user creates a record (client-minted uuid, `generatedId: true`).
Connectivity returns and the first replay attempt reaches the server but its ACK is lost — a network
error, so the op correctly stays queued. The second attempt gets a 409. `inner.findById` is issued on
a connection that is still flapping and rejects with a network error → `.catch(() => undefined)` →
`row` is undefined → `replay` resolves → `markSuccess()` → `drop(op)`. `pending` reads 0,
`lastSyncedAt` is stamped, `onSyncError` is never called. The optimistic row survives in the local
database until the next `findById`, which 404s and calls `removeLocalRow(slug, id, true)` — at which
point the record the user created disappears with no explanation. The same path is reached whenever
the collection's RLS lets a user insert but not select their own row, and whenever the 409 came from
some other conflict.

**Fix direction.** The lost-ACK adoption is only sound when the read *succeeds and confirms*. Split
the three outcomes: row found → adopt; read returned a definite 404 → the 409 was not ours, treat as a
rejection; read failed for any other reason → re-throw so the op stays queued and is retried, rather
than reporting a success nobody observed. A queue entry must never be dropped on the strength of a
read that did not happen.

### H2 — The queue is scoped to a user the client does not know yet, and the `anon` queue is never replayed

`packages/client/src/index.ts:486-490`, `offline.ts:369-383`, `auth.ts:151`, `auth.ts:795-826`

`setScope(uid || "anon")` throws away the in-memory queue and every local row on every change, and the
previous scope's persisted queue is only ever replayed if that exact scope comes back. There is no
migration from `anon` to a uid and no signal that anything was left behind.

In `authFlowMode: "cookie"` the session is deliberately not persisted (`auth.ts:151` returns before
storing), so `loadStoredSession()` finds nothing and the constructor takes the
`else if (authFlowMode === "cookie")` branch: a silent `refreshSession()` on boot. `getSession()` is
therefore `null` when `index.ts:487` runs, so the manager starts at scope `anon` on every single load.

**Failure scenario.** Cookie-mode app, offline support on. The user reloads the tab on a train with no
signal. The boot refresh rejects (network), `currentSession` stays null, scope stays `anon`. Their
cached rows live under `uid|row|…` and are invisible, so the app renders empty — the exact opposite of
what `offline.md` promises about a reload. They work anyway: twenty edits queue under `anon|`. The
train reaches a station, the refresh succeeds, `TOKEN_REFRESHED` fires with a session
(`auth.ts:599-603`), `setScope(uid)` runs, and `this.queue = []` plus `resetCollections()` wipe all
twenty from memory and from the screen. They sit in IndexedDB under `anon|` forever, or — if the user
later signs out — replay unauthenticated and are rejected en masse.

A narrower version of the same bug hits JSON mode: any write made in the window before sign-in
(session expired, first visit, the boot refresh in flight) is queued under `anon` and orphaned by the
sign-in that follows.

**Fix direction.** Do not derive the scope from a session that has not resolved. Gate the manager on
`auth`'s `initialized` promise before the first `setScope`, so the boot window has no scope rather
than the wrong one. Then decide what an `anon` queue means on sign-in: either adopt it into the new
scope (correct when the writes were made by the same human who has just authenticated) or surface it
— `pending()` returning 0 while twenty writes sit on disk is the part that makes this silent.

### H3 — A request that outlives a scope change writes the previous user's rows into the new user's cache

`packages/client/src/offline.ts:1205-1236` (`ingest`), `:1690-1707` (`ingestReplaced`),
`:1890-1900` (key builders), `:1760-1766` (`drop`)

`ensureCollection` (`:981-991`), `ensureQueueLoaded` (`:1346-1354`) and `reloadCollection` (`:1818-1824`)
all capture `const scope = this.scope` and re-check it after their awaits. The *write* paths do not.
`rowKey`, `absentKey`, `countKey` and `queueKey` each read `this.scope` at call time, and `ingest` has
no identity check of any kind.

**Failure scenario.** User A has a list open; `inner.find(params)` is in flight. A signs out and B
signs in (a shared kiosk, or a session expiring into a re-login). The HTTP response for A's request
arrives and resolves: `ingest(slug, res.data)` runs, `state` is the freshly-reset collection for scope
B, and `writeCache(this.rowKey(slug, key), …)` persists A's RLS-filtered rows under `B|row|<slug>|…`.
`notifyCollection` then emits them to B's observers. B is now looking at, and has persisted, rows A's
policies allowed and B's may not.

The same applies to a replay in flight: if `flush` is mid-`replay` when the scope changes, the
subsequent `drop(op)` computes `queueKey` under the *new* scope and deletes a key that does not exist,
so A's already-ACKed mutation stays in the store and replays a second time when A next signs in —
and single `update`/`delete` carry no idempotency key (M1), so that second replay is a real second
write.

**Fix direction.** Capture the scope alongside every request the wrapper issues and drop the response
if it no longer matches, the same discipline `ensureCollection` already applies to loads. The cheapest
correct shape is a scope epoch counter compared once in `ingest`, `ingestReplaced`, `setLocalRow`,
`removeLocalRow` and `drop`, rather than a check per call site that the next method will forget.

### H4 — `isExactlyEvaluable` throws on two documented `where` shapes

`packages/client/src/offline-query.ts:354-361`, reached from `offline.ts:1038` and `:1453`

```ts
for (const condition of Object.values(where)) {
    const tuples = isTuple(condition) ? [condition] : (condition as unknown[]).filter(isTuple);
```

`isTuple` rejects anything that is not a two-element array whose head is a known operator, and the
fallback then calls `.filter` on it unconditionally. Two inputs the rest of the stack explicitly
supports land there:

- `{ status: undefined }` — `assertNoUndefinedFilterValues` (`transport.ts:161-163`) and
  `serializeFilter` (`filter-dialect.ts:236`) both `continue` on it, and the error message for the
  *rejected* case tells the user to do exactly this ("Omit `"${field}"` from `where` to skip the
  filter"). `FilterValues` is a `Partial<Record<…>>`, so it typechecks.
- `{ status: "eq.active" }` — the pre-serialized PostgREST string form, passed straight through by
  `serializeFilter` (`filter-dialect.ts:241-243`).

Verified by extracting the function and running it: `{status: undefined}` →
`TypeError: Cannot read properties of undefined (reading 'filter')`; `{status: "done"}` →
`TypeError: condition.filter is not a function`.

**Failure scenario.** An app with a conditional filter (`where: { status: filter || undefined }`) and
`offline: true`. Online, `inner.find` succeeds; the wrapper then calls `answer()`, which calls
`isExactlyEvaluable` before anything else, and the whole read rejects with a bare `TypeError` — after
the network request has already been paid for. Offline it is the same. Turning offline support off
makes it work. `observe()` funnels it to `onError`, so the UI reports a broken query for a filter the
user just cleared.

Note the sibling: `matchesWhere` (`:245-260`) handles both of these — it skips `undefined` and filters
non-tuples out. One predicate, two implementations, only one of them hardened (bug class 2).

**Fix direction.** Make `whereOrders` walk the same normalisation `matchesWhere` uses — skip
`undefined`, guard `Array.isArray` before `.filter`. Better, extract the "condition → tuples"
normaliser once and have both call it, so the next accepted wire shape reaches both. And note the
second-order consequence for the bare-string form even once the crash is fixed: `matchesWhere`
produces zero tuples for it and therefore does not filter at all, while the server does — see L1.

---

## MEDIUM

### M1 — Single-row `update` and `delete` replay without an idempotency key

`packages/client/src/offline.ts:1626-1636`, `collection.ts:203-227`,
`packages/types/src/controllers/data.ts:761` and `:800-806`

Four of the six replay verbs pass `idempotencyKey: op.mutationId`: `create`, `createMany`,
`updateMany`, `deleteMany`. `update` and `delete` do not — and cannot, because
`SDKCollectionClient.update(id, data)` and `delete(id)` declare no `options` parameter at all, so the
key has nowhere to go. This is the class-17 second axis: the feature was applied at most of its call
sites. The `updateMany` docblock states the rationale the single-row path also needs — "an update
replayed in full is naturally idempotent, but one interleaved with another writer's is not — the key
is what stops a lost ACK from re-applying a stale batch over newer data."

**Failure scenario.** Offline, the user edits a row. Replay sends `PUT`, the server commits, the ACK is
lost → network error → the op stays queued. Meanwhile a colleague edits the same row. The retry
re-applies the queued (now stale) payload over the colleague's write. No conflict is detected and
nobody is told.

**Fix direction.** Add `options?: WriteOptions` to `update` and `delete` on the contract and the
client, and pass `op.mutationId` from replay. Server-side, `withIdempotency` is already generic over
method/path/body (`api-generator.ts:304-360`) but is only mounted on the create and bulk routes, so
the PUT and DELETE routes need the same wrapper.

### M2 — Delete resurrection: a lost ACK on a delete puts the row back on screen

`packages/client/src/offline.ts:1633-1636` → `:1721-1750`,
`packages/server/src/api/rest/api-generator.ts:760-768`

The DELETE route fetches the row first and throws `ApiError.notFound` when it is absent, so a replayed
delete of an already-deleted row is a 404. 404 is not in `RETRYABLE_STATUSES`, so `flush` goes to
`rejectMutation`, which restores `op.rollback.rows[id]` via `setLocalRow`.

**Failure scenario.** Offline, the user deletes a row. Connectivity returns, the delete reaches the
server and commits, the ACK is lost (network error → stays queued). The retry gets
`404 Entity not found` → `rejectMutation` → the row is written back into the local database and
`onSyncError` fires with "Entity not found" — a message that describes the opposite of what happened.
The row is now a phantom: `findById` returns it, lists answered without a server snapshot show it, and
it only vanishes on a refetch that produces a fresh snapshot. Nothing sets a tombstone, so offline it
persists.

**Fix direction.** Rolling back a delete on a 404 is unsound in both directions — a 404 means the row
is gone, which is what the delete wanted. Treat `type: "delete"` + 404 as success: drop the op, keep
the row removed, set the tombstone. (Fixing M1 also removes the trigger, but the 404 handling is worth
having on its own.)

### M3 — Blind last-write-wins, undocumented

`packages/client/src/offline.ts:1627`, `collection.ts:203-210`,
`website/src/content/docs/docs/sdk/offline.md:132-149` and `:193-201`

The replayed update is a bare `PUT` with the changed fields. There is no version column, no
`If-Match`/ETag, no `updated_at` precondition and no conflict callback. Because the server merges
rather than replaces, fields the offline client did not touch survive — but for any field it *did*
touch, a change made on the server while the client was offline is overwritten without a signal.

The documentation never says this. "When the server says no" covers rejections; "Limits" mentions only
that local reads may be stale. A reader who has been told writes "replay in order when the connection
returns" and that rejections are surfaced will reasonably conclude that a conflicting server edit is
one of the things that gets surfaced. It is not.

**Failure scenario.** Two users open the same record. A goes offline and edits `status`. B edits
`status` on the server. A reconnects; A's replay wins; B's change is gone and neither user is told.

**Fix direction.** The documentation fix stands alone and should land regardless: state plainly that
conflict resolution is last-writer-wins per field with no detection. The code fix is a version/`ETag`
captured at read time and sent as a precondition, with a `412` mapped to a new
`onConflict(mutation, serverRow)` callback — a distinct outcome from `onSyncError`, because the local
write is not wrong, it is stale.

### M4 — `syncIntervalMs: 0` disables the `online`-event replay its own docblock promises

`packages/client/src/offline.ts:79-85` and `:299-312`

```ts
* `0` disables automatic retries entirely — `client.offline.sync()`, a sign-in, and the
* browser's `online` event still trigger one. Defaults to 60 000.
```

```ts
if (maxBackoffMs > 0) {
    this.connectivity.onRetryDue = () => { void this.sync().catch(() => undefined); };
}
```

`ConnectivityMonitor.handleOnline` reaches the queue only through `this.onRetryDue?.()`
(`offline-connectivity.ts:131-141`), which is left undefined in that mode. The other listener,
`connectivity.onChange`, calls `revalidateAll()` — which refreshes observers and never touches the
queue.

**Failure scenario.** An app that sets `syncIntervalMs: 0` (documented as "disables auto-retry", which
a caller may well want if they drive sync from their own UI). The user writes offline, then the wifi
comes back. `status().online` flips to true, lists revalidate, the badge says online — and the queued
writes sit there until the app happens to call `sync()` or the user signs in again.

Every test in `offline.test.ts`, `offline-integration.test.ts` and `offline-idb-store.test.ts` passes
`syncIntervalMs: 0`, and `offline-sync-engine.test.ts` defaults to it; the only two tests using
`60_000` exercise `shouldAttempt`, not the timer. So neither the retry timer nor the `online` → replay
path is covered anywhere in the manager's suite (bug class 3).

**Fix direction.** Wire `onRetryDue` unconditionally and let `ConnectivityMonitor` decide whether to
*schedule* a timer; `scheduleRetry` already no-ops when `respectBackoff` is off. Then add a test that
dispatches a `window` `online` event and asserts the queue drained.

### M5 — Cross-collection dependencies are neither id-remapped nor cascaded

`packages/client/src/offline.ts:1655-1678` (`adoptServerRow`), `:1728-1734` (rejection cascade)

Both loops skip entries in other collections (`if (queued.collection !== slug) continue;` and
`if (later.collection !== op.collection) continue;`). Yet `PendingMutation`'s docblock
(`offline-store.ts:43-49`) states the queue is ordered globally *because* "a create in one collection
may be the parent a later insert in another references", and `offline.md:72` sells the same property.
The ordering half was implemented; the identity half was not.

**Failure scenario.** Offline: create an author (client uuid `off-abc`), then create a post with
`author_id: "off-abc"`. Online: the author replays, the server's `authors.id` is a serial and returns
`42`. `adoptServerRow` rewrites the author's own local row and any queued `authors` op — but the queued
`posts` create still carries `author_id: "off-abc"`. On a real FK it fails, is rolled back, and the
post is lost (with `onSyncError`); on a `text` column it is written and becomes a dangling reference
that nothing will ever correct.

**Fix direction.** The remap has to be global, which means knowing which columns are references. The
cheap version is to walk every queued mutation in every collection and replace any *value* equal to
the old id — sound only because the old id is a freshly minted uuid that cannot collide. The correct
version consults the collection's relation metadata. Either way, the rejection cascade needs the same
widening: a child create whose parent create was rejected is doomed too.

### M6 — The assembled page ignores `limit`

`packages/client/src/offline.ts:1060-1133`

The snapshot branch builds `rows` from `snapshot.ids`, appends every locally-created row that matches
at offset 0, sorts, and returns. Nothing slices to `snapshot.limit`, and `meta.limit` is reported as
`snapshot.limit` regardless.

**Failure scenario.** `find({ limit: 20 })` against a collection where the server's page is full and
the user has created three rows offline: `data.length === 23` while `meta.limit === 20`. A UI paging on
`limit` shows the same three rows again on page two, and a virtualised list sized from `meta` clips
them. The no-snapshot branch does not have this problem — `runLocalQuery` slices correctly
(`offline-query.ts:460-461`).

**Fix direction.** Slice to `snapshot.limit` after the sort, and let the injected rows displace the
tail of the server page rather than extending it — that is what a refetch would return.

### M7 — `find()`, `iterate()` and `findAll()` cannot tell a partial answer from a complete one

`packages/client/src/offline.ts:436-439`, `:454-458`, `:464-466`;
`packages/common/src/data/paginate.ts:243`

`answer()` computes `partial` carefully and `find` then returns `{ data, meta }`, dropping it —
`FindResult` has nowhere to put it. `paginateFind` terminates on `page.meta.hasMore !== true`, and for
a page with no cached snapshot that value comes from `runLocalQuery` over whatever rows happen to be in
the cache.

**Failure scenario.** Offline, `await client.data.posts.findAll()`. Page one is served from a cached
snapshot with the server's `hasMore: true`; page two (offset 20) has no snapshot, so the no-snapshot
branch evaluates the query over the cached rows only and reports `hasMore: false`. The walk stops. The
caller receives an array that looks like the whole collection and is a fraction of it, with no flag,
no error and no `isOfflineError` to catch. `collectAllPages` goes to considerable trouble to refuse to
return a truncated answer silently (`paginate.ts:290-297`) and this defeats it from below.

**Fix direction.** Either refuse — throw `offlineError` from a paginated walk that cannot be served
exactly, which is the same choice `collectAllPages` makes for `maxRows` — or surface the flag on
`FindResult` so the walker can stop and say why. Silently short is the one option that should not
remain.

### M8 — No durability request and no version stamp on anything persisted

`packages/client/src/offline-store.ts:192-250`; no `navigator.storage.persist()` anywhere in
`packages/client/src`

The IndexedDB database is best-effort storage. Under pressure — and unconditionally after seven days
of inactivity under Safari's ITP — the browser evicts the origin's IndexedDB, taking the queue with it.
Nothing requests persistence, nothing detects the loss, and on the next load `pending()` returns 0.

Separately, neither cache entries nor `PendingMutation` carry a schema version. The v1 → v2 upgrade
solved exactly this problem by deleting both object stores, and its comment records why that was
acceptable: "Offline support had not shipped in a release when v2 landed, so nothing in the wild loses
a queued write to this." It has shipped now (0.11.0), so the next incompatible change has no such
escape. And an older client opening a database a newer one upgraded gets a `VersionError` from
`indexedDB.open`, which rejects `dbPromise` and turns every write into an opaque IndexedDB rejection —
a stale tab or a rolled-back deploy takes the app down rather than degrading.

**Fix direction.** Call `navigator.storage.persist()` when the first mutation is queued (the moment
there is something worth keeping), and record the result so a UI can warn. Stamp each queue entry with
a schema version and refuse-with-report rather than replay-blindly on an unknown one — a dropped entry
must at least reach `onSyncError`. For the downgrade case, catch `VersionError` specifically and fall
back to the memory store with a loud warning rather than failing every call.

### M9 — `withLock` re-runs the work outside the lock when the work throws

`packages/client/src/offline.ts:1778-1789`

```ts
try {
    return await locks.request(`rebase-offline-sync:${this.scope}`, fn) as T;
} catch {
    // A browser that denies the lock (or a policy that blocks it) must
    // not stop the queue from draining at all.
    return fn();
}
```

`navigator.locks.request` resolves and rejects with the *callback's* outcome — the test's own shim
makes this explicit (`offline-idb-store.test.ts:246-250`: `previous.then(fn, fn)`). So the `catch`
cannot distinguish "the lock was refused" from "the flush threw", and in the second case it runs the
flush again with no lock held. This is bug class 16 in a non-Postgres setting: a retry that runs
*inside* the failure.

**Failure scenario.** `flush` calls application callbacks with no guard — `onSyncError` (`:1749`),
status and queue listeners (`:1868`, `:1881`), and `observer.emit` → `onResult` via
`notifyCollection` (`:1549`). One of them throws (a React render error in a status badge is enough).
`flush` rejects, `withLock` catches, and the remaining queue is replayed a second time with no mutual
exclusion — concurrently with whichever other tab was waiting on the lock. Duplicate `update` and
`delete` requests follow, and a duplicate delete lands in M2.

**Fix direction.** Acquire and release explicitly, or distinguish the two outcomes: run `fn` through a
wrapper that records whether it started, and only fall back when it did not. Separately, wrap
application callbacks so a listener that throws cannot abort the drain (see L5).

### M10 — Cross-tab exclusion silently does not exist without Web Locks

`packages/client/src/offline.ts:1779-1781`, `website/src/content/docs/docs/sdk/offline.md:151-153`

`navigator.locks` requires a secure context, so it is absent over plain HTTP to a non-localhost host,
in some embedded webviews, and in Safari before 15.4. The fallback runs `fn()` unlocked, which means
both tabs replay the whole queue. The documentation states without qualification that "only one tab at
a time replays the queue. Nothing to configure." The IndexedDB two-tab test installs a locks shim
(`offline-idb-store.test.ts:241-256`), so the fallback path has no coverage at all.

**Failure scenario.** Two tabs, no Web Locks, both flush a queued delete. One succeeds; the other gets
404 → `rejectMutation` → the row is restored locally *and broadcast*, so it reappears in both tabs.
Creates and bulk writes are protected by their idempotency keys; single updates and deletes (M1) are
not.

**Fix direction.** A BroadcastChannel-based leader election is the usual substitute and this code
already has the channel. Failing that, say so in the documentation and expose it on `status()` so an
app can decide.

### M11 — `count()` and `pendingDelta` disagree with both the server and the local rows

`packages/client/src/offline.ts:707-727`, `:1452-1469`

`pendingDelta` folds only `create`, `createMany` and `delete` into a cached count. `update` and
`updateMany` are ignored, so an offline edit that moves a row into or out of the filter does not move
the count — even though `answer()` *does* remove it from the list (`:1076-1079`). `deleteMany` is
ignored entirely, so deleting fifty rows offline leaves the count fifty too high. A queued `create`
with a caller-supplied id that already exists on the server is counted twice.

And with no cached count at all, `count()` falls back to `runLocalQuery(...).meta.total` over cached
rows and returns it as a number, with no way for the caller to know it counted a cache rather than a
collection.

**Failure scenario.** "Showing 20 of 214" where 214 is the server's count from before the user deleted
fifty rows on a plane; then, after eviction or a cold start, "Showing 20 of 20" for the same
collection.

**Fix direction.** Extend `pendingDelta` over the remaining verbs, using each op's rollback row to
decide whether the row was in the filter before. For the no-cache fallback, throwing `offlineError` is
more honest than a confidently wrong number.

---

## LOW

### L1 — A `where` the local evaluator cannot parse filters nothing, and the answer is still labelled exact

`offline-query.ts:239-260` with `:402-414`. `matchesWhere` builds its tuple list through `isTuple`,
which requires `toCanonicalOp` to recognise the operator. Anything it does not recognise — an operator
added to a newer server than this client build, or the bare-string PostgREST form — yields zero tuples
and the field is simply not filtered, while `isExactlyEvaluable` returns `true` for the same input. So
the local answer is *wider* than the server's and is presented as equivalent (`partial: false`). Fails
open, which is the direction bug class 1 warns about. `matchesOperator`'s `default: return true`
(`:233-236`) is the same choice one layer down; the comment defends it as "must not silently drop
rows", but silently *adding* rows to a result labelled exact is the worse half of the trade.

### L2 — Queue payloads bypass the codec, so a pending row loses its class instances across a reload

`offline-codec.ts:9-20` states the contract — "A row read from the cache must be indistinguishable from
the same row read from the network" — and `setLocalRow`/`ingest` honour it. `enqueue`
(`offline.ts:1418`) persists `mutation.data` raw, and `listQueue` returns it raw. `applyPendingToRow`
(`:1244-1269`) then overlays that raw payload onto server rows. After a reload, a pending row's
`GeoPoint` is a bare `{ latitude, longitude }` and an `EntityReference` is a bare `{ __type, id, … }` —
and `ingest` re-dehydrates the flattened value back to the cache, so it stays flattened. Wire
serialization is unaffected (the JSON shapes coincide), so this is a UI-side type regression rather
than a data-loss one.

### L3 — Two eviction bounds that do not bind

`offline.ts:1312-1330`. The tombstone cap lives *inside* `evictRows`, after
`if (state.rows.size <= this.maxCachedRows) return` — so `absent` is only trimmed when the row cache is
also over its cap, and a browsing pattern that looks up many missing ids without filling the row cache
grows it without limit. Separately, `evictSnapshots` deletes from `snapshots` but never from
`state.fresh`, which is only ever added to.

### L4 — A backoff floor with no ceiling

`offline.ts:301` clamps `maxBackoffMs` upward (`Math.max(1_000, maxBackoffMs)`) and never downward;
`offline-connectivity.ts:202-208` feeds it to `setTimeout`. A `syncIntervalMs` above 2 147 483 647
overflows the 32-bit delay and fires at 1 ms — bug class 23's exact signature, a bounded lower side and
an unbounded upper one. Config-only, so low, but the guard is one line.

### L5 — Application callbacks are invoked unguarded

`offline.ts:1868` (`notifyQueue`), `:1881` (`patchStatus`), `:948` (`notifyCollection`), `:1749`
(`onSyncError`). None wraps the call, so one throwing listener skips every listener after it in the
set — and, inside `flush`, aborts the drain and triggers M9.

### L6 — The codec writes object keys taken from stored data

`offline-codec.ts:49` and `:65` both do `out[key] = …` where `key` comes from `Object.entries` of a
value that originated in a JSON response. `JSON.parse` creates `__proto__` as an own enumerable
property (verified), so a column literally named `__proto__` reparents the reconstructed row instead of
being carried, and the column disappears. No global pollution — the write lands on a fresh object, not
on `Object.prototype` — so this is bug class 22 in its contained form. Worth an `Object.defineProperty`
or a refusal, since the store round-trip is the one place the key survives to reach the loop.

### L7 — The fake server disagrees with the real one about deleting a missing row

`offline.test.ts:86-90`: `delete` removes from the map and returns, no 404. The real route throws
`ApiError.notFound` (`api-generator.ts:766`), and `deleteMany` in the same fake *does* 404
(`:91-97`). So M2 is invisible to the suite by construction — bug class 7, a fixture agreeing with the
bug.

### L8 — `hasPending` is a linear queue scan called per row

`offline.ts:1428-1437`, called from `answer` once or twice per row (`:1071`, `:1076`, `:1091`,
`:1129`) and from `evictRows` once per row. A 500-row page against a 200-entry queue is 100 000
comparisons per emit, and `observe` emits on every local write. An id → ops index maintained alongside
the queue removes it.

---

## Checked and clean

- **Replay ordering is FIFO and global.** `createMutationId` pads the base-36 millisecond to ten
  characters so lexicographic order equals chronological order (`offline-store.ts:111-116`);
  `listQueue` returns key order in both backends (`:173-178`, `:343-349`); `flush` always takes
  `this.queue[0]` and `break`s rather than skipping on a failure it cannot resolve
  (`offline.ts:1494-1542`). A restart preserves it (`offline.test.ts:877`).
- **A dependent write within one collection is safe.** `update` and `delete` refuse the network
  whenever the row already has a queued write (`offline.ts:653`, `:684`), so create-then-update keeps
  its order instead of 404ing against a server that has never heard of the row; `updateMany` and
  `deleteMany` send the *whole* batch to the queue if any row in it is pending (`:579`, `:617`), which
  is the right call. If the create is then rejected, the cascade in `rejectMutation`
  (`:1721-1750`) discards the updates built on it and keeps a later `create`/`delete`, which is the
  correct stopping rule and is tested from both sides
  (`offline-sync-engine.test.ts:356`, `:384`).
- **The in-flight guards are id-based and correct.** Both `enqueue` shortcuts exclude
  `this.inFlightId` (`offline.ts:1371`, `:1399`, `:1405`), and `flush` holds it across `drop` as well
  as `replay` (`:1501`, `:1539-1541`), which closes the ACK-to-dequeue window. The reasoning is
  written out at `:255-272` and matches the code.
- **The `IDEMPOTENCY_KEY_IN_PROGRESS` separation is coherent end to end.**
  `isDuplicateKeyError` excludes it (`offline-connectivity.ts:93`), `isRetryableError` includes it
  (`:70`), and the retry budget is widened to 12 for it specifically (`offline.ts:1521-1523`), which is
  longer than the claim's lease. Covered by `offline.test.ts:321` and `:353`.
- **Reconnect reconciliation does not clobber unsent work.** `ingest` folds the queue over each server
  row (`:1214-1216`) and refuses to resurrect a row with a queued delete (`:1217-1222`);
  `ingestReplaced` skips only the mutation that produced the response and keeps everything queued after
  it (`:1690-1707`).
- **Rollback restores through the surviving queue** rather than to the raw base
  (`:1738-1744`), so undoing a rejected write in the middle of a chain leaves the row where the
  remaining writes put it.
- **Eviction never evicts a row with an unsent write** (`:1315-1316`), and is per collection
  (tested at `offline-sync-engine.test.ts:214` and `offline.test.ts:748`).
- **The async load paths all carry a scope guard** — `ensureCollection` (`:991`),
  `ensureQueueLoaded` (`:1350`), `reloadCollection` (`:1824`), `reloadQueue` (`:1854`) — and
  `resetCollections` replaces the state objects rather than emptying them so an in-flight load fails
  its identity check (`:385-407`). Tested at `offline.test.ts:396`. The gap is that the *write* paths
  do not (H3).
- **Cross-tab messages are filtered by scope and sender** (`:1805`), and the channel is `unref`'d so a
  Node script can exit (`:327`).
- **`api.pending()` deep-copies**, so a caller cannot mutate a live queue entry that tail-coalescing
  will edit in place (`:341`).
- **The IndexedDB store handles the connection lifecycle properly**: `onversionchange` closes and
  clears the cached promise so another tab's upgrade is not blocked (`offline-store.ts:255-258`), and
  `onerror`/`onblocked` reset `dbPromise` so a transient failure does not poison every later call
  (`:264-271`).
- **The local evaluator's SQL fidelity is real and deliberate**: NULL comparisons are unknown rather
  than false (`offline-query.ts:194-196`, `:209`, `:227`), `ORDER BY` puts nulls last ascending and
  first descending (`:320-324`) with an id tiebreak, wire-erased numeric strings compare numerically
  (`:91-95`), and `resolvePagination` delegates to the shared window resolver rather than keeping a
  local default (`:345-348`) — with the docblock recording the 20-vs-50 bug that motivated it.
- **`isLocallySortable` and `isExactlyEvaluable` refuse rather than guess.** The collation argument
  (`:380-400`) is correct: a text `<` cannot be reproduced client-side without knowing the database's
  collation, and refusing exactness is the conservative direction. `answer` uses it to keep the
  server's row order when a local sort would replace it (`offline.ts:1116-1132`).
- **The `LIKE` → RegExp translation collapses runs of `%`** (`offline-query.ts:157-166`), which closes
  the adjacent-quantifier ReDoS in the local path.
- **Realtime feeds the local database on its way past** without bypassing the pending overlay
  (`offline.ts:764-783`, `:910-917`), and `listenById` receiving a null row does not delete a row with
  a queued write (`:912`).
- **`clear()` is genuinely scoped**: `IndexedDBOfflineStore.clear` deletes both stores over a prefix
  range (`offline-store.ts:351-356`), tested at `offline-idb-store.test.ts:85`.

---

## Open questions

1. **Is `authFlowMode: "cookie"` used together with `offline: true` in any shipped app?** H2's severity
   depends entirely on that. In JSON mode the window is narrow (writes made before sign-in); in cookie
   mode it is every reload. Worth checking the demo, the examples and `prospector` before deciding how
   urgent the fix is.
2. **What should happen to a write the engine gives up on?** Today the only record is the
   `onSyncError` callback — a function the app may not have passed, firing once, with the mutation as
   an argument. After it returns, the write is gone from disk and from memory. A dead-letter area in
   the store, surfaced through `client.offline`, would make every "silently dropped" finding above at
   worst a "reported and parked" one, and it is a smaller change than fixing each path individually.
3. **Was `partial` deliberately withheld from `find()`?** It is computed for every answer and only
   `observe()` can see it. If widening `FindResult` is off the table for compatibility reasons, the
   `iterate`/`findAll` truncation in M7 still needs *some* answer, and refusing is the only other one.
4. **Is last-write-wins the intended policy, or the current one?** M3's documentation fix and its code
   fix are different sizes and the choice between them is a product decision. Nothing in the code
   reads as a deliberate LWW design — there is simply no conflict machinery — which suggests it was
   never decided rather than decided this way.
5. **Would keying `update`/`delete` (M1) need a server change?** `withIdempotency` is generic over
   method, path and body (`api-generator.ts:304-360`) but is mounted only on the create and bulk
   routes. Whether the PUT/DELETE handlers can take the same wrapper without disturbing the
   `stampActualTarget`-style side effects around them was not verified here.
6. **Does anything hold `navigator.storage.persist()` back?** It prompts in some browsers and is
   granted silently in others; whether the SDK should ask on the app's behalf, or expose it for the app
   to call, is a policy question M8 does not settle.
