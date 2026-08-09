# Audit 32 — entity realtime and change data capture

Read-only audit, 2026-08-09, against `main` at `c678e1745`. Scope:
`packages/server-postgres/src/services/realtimeService.ts`,
`packages/server-postgres/src/services/cdc/**` (`trigger-cdc.ts`, `CdcListener.ts`,
`junction-tables.ts`), `packages/server-postgres/src/services/pg-notify-listener.ts`,
`packages/server-postgres/src/websocket.ts`, the CDC wiring in
`packages/server-postgres/src/PostgresBootstrapper.ts`, the realtime call sites in
`PostgresBackendDriver.ts`, `packages/server/src/services/routed-realtime-service.ts`,
`packages/client/src/websocket.ts`, and the published realtime docs. Channel/presence/broadcast
belong to audit 33 and are excluded except where they share a code path.

## Verdict

The CDC half is genuinely well built and its central security claim is true *for the path it
describes*. Triggers are idempotent and correctly quoted; the payload has an overflow guard so a
wide row cannot abort a write; the listener validates its first connect and rethrows so
`REALTIME_CDC=auto` can degrade deliberately rather than run blind; `handleCdcEvent` refuses to
forward the captured tuple and instead marks the row invalidated so each subscriber re-reads it
inside `db.transaction` + `applyAuthContext` + `SET LOCAL ROLE rebase_user`; junction tables are
routed to the child list they actually change; and the app/CDC de-duplication is keyed correctly so
external writes always flow through. `applyAuthContext` itself is the strongest single function in
the subsystem — it coerces a blank uid to the anonymous sentinel at the one chokepoint precisely so
that a realtime caller cannot escalate to the server context by omission.

The problem is that the invalidation marker — the entire mechanism that makes delivery RLS-safe —
is produced by exactly **two** lines, both inside `handleCdcEvent`
(`realtimeService.ts:2147`, `:2186`). It is consumed by three branches in `notifyPathUpdate`
(`:694`, `:702`, `:723`), and the *other* side of each of those branches sends the row it was
handed straight to the socket. Two of the three ways a change enters this pipeline take that other
side: every mutation made through the Rebase API (`PostgresBackendDriver.save` →
`notifyUpdate(path, id, savedRow)`), and every cross-instance notification on the legacy
LISTEN/NOTIFY path — where the row is additionally re-read on the **owner** connection that
bypasses RLS entirely. So a subscriber receives rows it cannot read on the two paths that carry
most traffic, and the third path — the one the comments, the doc-block and three places in the
published docs all describe — is the only one where the guarantee holds.

This is class 36 with the receipts already written down: `trigger-cdc.ts:50-53` states *"It is not
trusted for delivery … so a subscriber never receives a row it cannot read"*, and
`website/src/content/docs/docs/backend/realtime.md:150` describes Phase 1 as *"pushes a lightweight
`collection_patch` message containing the modified entity values directly to subscribers …
bypassing the database entirely"* — the leak, documented as a feature, two hundred lines above the
sentence that denies it exists (`:328`, `:526`). It is also class 2: the identical defect was found
and fixed on the Mongo engine four commits ago (`065e2b615`, item C4, *"`notifyUpdate` re-fetches
through the subscriber's own driver rather than broadcasting the row as saved to whoever watches
that id"*), with a dedicated regression suite
(`packages/server-mongo/test/realtime-authorization.test.ts`). Postgres was not touched. Two
Postgres tests currently pin the leaking behaviour as correct.

Counts: **3 high, 7 medium, 6 low.**

---

## HIGH

### H1. Every API mutation pushes the written row verbatim to every subscriber on that path

**Where**
- `packages/server-postgres/src/PostgresBackendDriver.ts:767-772` — `save` calls
  `notifyUpdate(path, savedId, savedRow, …)` with the row it just read back through
  `fetchOneForRest` under the **writer's** RLS scope.
- `packages/server-postgres/src/services/realtimeService.ts:692-698` — single subscriptions:
  when the row is not marked invalidated, `sendSingleUpdate(subscription.clientId, subscriptionId,
  row)`. No refetch, no auth context, no correction afterwards.
- `packages/server-postgres/src/services/realtimeService.ts:699-704` — collection subscriptions:
  `sendCollectionPatch(subscription.clientId, subscriptionId, id, row, notifyPath)`. No RLS, and no
  evaluation of the subscription's own `filter`/`logical` either.
- `packages/server-postgres/src/services/realtimeService.ts:722-728` — the same for in-process
  driver subscriptions: `callback(row)`.
- `packages/client/src/websocket.ts:728-780` — the client merges the patch into
  `collectionSub.latestData` and fires `onUpdate`; `:786-812` caches `single_update` and fires
  `onUpdate`.
- Pinned as correct by `packages/server-postgres/test/realtimeService.test.ts:249` (*"sends instant
  row patch for valid row updates without `_rebase_invalidated`"*) and `:320` (*"sends instant row
  update if valid payload (local mutation)"*).

**What's wrong.** `notifyPathUpdate` matches subscriptions on **path only** (`:664-676`). Nothing
between the write and `client.send()` asks whether *this* subscriber may see *this* row. The
`authContext` stored on the subscription (`:207`) is read by `fetchCollectionWithAuth` /
`fetchEntityWithAuth` and by nothing on this branch. The row was read under the writer's scope, so
it also carries whatever the writer's `afterRead` produced — a redactor that unmasks for admins
(`packages/server-postgres/test/row-callbacks-redaction.test.ts` is the suite that enumerates the
read paths which must run `afterRead`; this is a read path and it is not in that enumeration)
delivers the unmasked value to every subscriber.

Note this is the **default** configuration. `REALTIME_CDC=auto` is on and CDC being active does not
help: `notifyUpdate` with `origin: "app"` records the dedup key and then falls straight through to
`notifyPathUpdate` with the real row (`:615-640`), and the CDC echo that *would* have carried the
invalidation marker is then suppressed as a duplicate.

**Failure scenario.** Attacker capability: one ordinary account (or none, on a `requireAuth: false`
RLS-only backend) that can open the socket and name a collection path.

1. Victim's row `orders/4711` is denied to the attacker by RLS.
2. Attacker sends `subscribe_one { path: "orders", id: "4711" }`. `handleEntitySubscription`
   (`:547-583`) does not refuse an unreadable row — it registers the subscription and replies
   `single_update: null`.
3. Any user or any server process updates `orders/4711` through the Rebase API.
4. The attacker's socket receives `single_update` with the complete row. **Nothing corrects it
   afterwards** — the single-subscription branch schedules no refetch when the row is unmarked.

The collection variant is broader and only transiently visible: subscribe to `orders`, receive a
`collection_patch` for every write to the table regardless of RLS *and* regardless of the
subscription's own filter, then have the list corrected ~300 ms later by the debounced refetch. The
row is already in the client callback and in the browser by then.

The question "what happens when a row a subscriber *can* see is updated so they can no longer see
it" resolves to the worst available answer on this path: they are pushed the new values of the row
that just became invisible to them.

**Fix direction.** Do what Mongo's C4 did: make the marker the only thing `notifyUpdate` ever fans
out. Drop the `row` argument's privileged use — for a non-delete, always take the
`debouncedSingleRefetch` / `debouncedCollectionRefetch` branch, so every delivery is a per-subscriber
read under `applyAuthContext`. If the instant patch is worth keeping for latency, it has to be
re-derived per subscriber (a `fetchEntityWithAuth` per matching subscription, deduplicated by
auth context, not by row) — but the honest first move is to delete the fast path and keep the
300 ms refetch, which is what the debounce was built for. Delete or invert the two tests that
currently pin the leak; port `realtime-authorization.test.ts` to Postgres so the two engines are
gated by the same property rather than by one engine's memory.

---

### H2. The legacy cross-instance path re-reads on the owner connection and pushes the result raw

**Where** `packages/server-postgres/src/services/realtimeService.ts:2315-2360`.

```
const fetched = await this.driver.fetchOne({ path: p, id: eid, collection });
refetchedRow = fetched ?? null;
…
await this.notifyUpdate(p, eid, refetchedRow, db ?? undefined, false);
```

**What's wrong.** `this.driver` is the **base**, unscoped `PostgresBackendDriver` installed at
`PostgresBootstrapper.ts:359` — the server/owner context that `PostgresBootstrapper.ts:361-372`
documents as bypassing RLS. So a change on pod A causes pod B to read the row with full privilege
and hand it to `notifyUpdate` unmarked, which lands on the H1 branches and ships it to every
subscriber of that path on pod B. This is strictly worse than H1: the read itself is privileged,
and the fan-out crosses a pod boundary where no subscriber's context was ever consulted.

**Reachability.** `startListening` runs whenever `directUrl` is set and CDC did not come up
(`PostgresBootstrapper.ts:562-570`). CDC failing is a *normal, silent* outcome under
`REALTIME_CDC=auto`: it needs privilege to `CREATE OR REPLACE FUNCTION` in a new `rebase` schema and
`CREATE TRIGGER` on every managed table, which a managed-Postgres app role frequently lacks. The
failure is logged at `info` (`:552-558`).

**Failure scenario.** Attacker capability: an account on a multi-replica deployment whose CDC
provisioning failed. Subscribe to the target path on any pod; every write made on any *other* pod
delivers the row as read by a superuser/owner connection.

**Fix direction.** Same as H1 — this handler should call
`notifyUpdate(p, eid, { _rebase_invalidated: true }, …)` for a change and `null` for a delete, and
delete the privileged `fetchOne` entirely. The refetch already exists per subscriber; this one adds
nothing but the leak. (The comment at `:2335-2337` explains the fetch was added so single
subscriptions would not read the update as a deletion — the invalidation marker solves that
correctly, which is exactly what the CDC path does.)

---

### H3. A subscription's auth context is a snapshot that nothing expires, refreshes or revokes

**Where**
- `packages/server-postgres/src/websocket.ts:169-174` — the session is created once.
- `packages/server-postgres/src/websocket.ts:252-257` — `AUTHENTICATE` sets
  `session.user` / `session.authenticated = true`. Nothing ever sets them back.
- `packages/server-postgres/src/websocket.ts:274-280` — the only gate on every later frame is
  `session?.authenticated`, a boolean with no expiry attached.
- `packages/server-postgres/src/websocket.ts:709-713` — the context is materialised from the
  session at subscribe time and copied into the subscription
  (`realtimeService.ts:511-528`, `:562-568`).

**What's wrong.** `extractUserFromToken` → `verifyAccessToken` checks `exp` at the instant
`AUTHENTICATE` is processed and never again. The socket's authenticated state, the socket's roles,
and every subscription's `authContext` are all frozen at that instant. There is no timer, no
re-verification on subsequent frames, no re-scoping when a client re-`AUTHENTICATE`s (existing
subscriptions keep the entry they were created with), and no path by which a logout, a disabled
account, a password reset or a role revocation reaches an open socket. Short access-token lifetimes
— the mechanism the auth subsystem is built around — are simply not a control on this transport.

This is the same shape as the `aal` case in class 36: the value is minted with care and then read
once, at a door the attacker has already walked through.

**Failure scenario.** Attacker capability: a user whose access is about to be withdrawn.

1. Sign in, open a socket, `AUTHENTICATE`, subscribe to every collection of interest.
2. Get fired / demoted / have the account disabled. Refresh tokens are revoked; HTTP is closed
   immediately.
3. The socket stays open and every subscription keeps refetching under the old
   `{ uid, roles }` — including `roles: ["admin"]` for a demoted admin — for as long as the process
   lives and the TCP connection holds.

**Fix direction.** Carry `exp` into `ClientSession` and refuse (or downgrade to anonymous, and tell
the client) once it passes, so the client's existing `resubscribeAfterAuthRefresh`
(`packages/client/src/websocket.ts:576-623`) does the rest — that machinery is already there and is
never triggered because the server never rejects. Then make `authContext` a *reference* to the
session rather than a copy, so a re-`AUTHENTICATE` re-scopes live subscriptions instead of leaving
them on the old identity. Revocation needs a push: a session-version or token-jti check consulted
on each refetch, or a socket-close broadcast on logout/role change.

---

## MEDIUM

### M1. A subcollection write patches the child row into the parent collection's subscribers

`realtimeService.ts:627-640` expands a nested path into its parents, and `:699-708` applies the
collection branch **without** the `notifyPath === originalPath` guard that the single branch at
`:692` has. So `POST /posts/1/comments` (`packages/server/src/api/rest/api-generator.ts:956-986`
calls `driver.save({ path: "posts/1/comments", … })`) sends every subscriber of `posts` a
`collection_patch` whose `row` is the new **comment**, which the client prepends to its cached posts
list (`packages/client/src/websocket.ts:760-763`). Two defects in one: a row from a different
collection is injected into a list, and the child collection's access rules were never consulted for
the parent's subscribers. Corrected by the 300 ms refetch, but delivered first. Fixing H1 fixes this
by construction; independently, the collection branch should carry the same
`notifyPath === originalPath` condition and treat a parent-path notification as invalidation only.

### M2. The CDC channel broadcasts full row contents, including the auth table, to any session on the database

`trigger-cdc.ts:65-91` emits `to_jsonb(NEW)` / `to_jsonb(OLD)` — every column — through
`pg_notify('rebase_cdc', …)`. Postgres has **no privilege model for LISTEN**: any session that can
connect to the database can `LISTEN rebase_cdc` and receive every changed row of every managed
table, with RLS irrelevant. `PostgresBootstrapper.ts:725-742` deliberately attaches the trigger to
the auth users table after `ensureAuthTablesExist`, so `password_hash` and
`email_verification_token` (`packages/server-postgres/src/auth/ensure-tables.ts:139`, `:492`) go out
on that channel on every registration and password change.

The mitigation in place is that `rebase_user` is `NOLOGIN`
(`packages/server-postgres/src/security/rls-enforcement.ts:182`, `:211`), so the RLS role cannot be
used to connect. **UNCONFIRMED** whether any supported deployment shape hands a lesser party a
database login — a BI/analytics read-only role, a second service, a Supabase project role — but
that is the common reason to create one, and such a role would be granted `SELECT` on one table and
receive the contents of all of them. Fix direction: notify identity + operation only
(`schema`, `table`, `op`, key columns) rather than the whole tuple. Nothing downstream consumes more
than that — `handleCdcEvent` uses `event.row` solely for `deriveRowAddress` (`:2202-2206`) and the
two junction columns (`:2174-2175`). This would also shrink the payload below the overflow guard in
every realistic case, making M4 and L6 moot.

### M3. No cap on subscriptions per client, and each one costs a full query per write

`_subscriptions` (`realtimeService.ts:198`) is an unbounded map keyed by a **client-supplied**
`subscriptionId`; grepping `MAX_SUBSCRIPTIONS|maxSubscriptions|subscriptionLimit` across
`packages/*/src` returns nothing. The only ceiling is the general WebSocket rate limit of 2000
messages per 60 s (`websocket.ts:49-51`). `resolveClientListLimit` bounds each subscription's page
size (`realtimeService.ts:500-508`) but not the number of them.

One socket can therefore register ~2000 subscriptions per minute on the same hot collection, each
at the maximum page size. A single write to that collection then runs `notifyPathUpdate` over all
of them (`:664`, O(subscriptions) per write) and arms one debounced refetch per subscription
(`:743-764`) — N full collection queries, each in its own `db.transaction` on the pooled connection,
every 300 ms for as long as the collection is being written to. This is a write-amplified DoS from
an authenticated client, and it exhausts the connection pool rather than a rate-limit budget. Fix:
a per-session subscription cap refused with a named error code, and an index from path →
subscriptions so the fan-out is not a linear scan of every subscription in the process.

### M4. "CDC can never break a write" is enforced for the payload cap and not for the queue

`trigger-cdc.ts:35-40` and `:78-89` guard the 8000-byte `pg_notify` limit carefully, with the stated
guarantee *"Never let CDC abort the write"*. There is a second way NOTIFY aborts a write and it is
not guarded: Postgres holds undelivered notifications in a shared queue (8 GB), and when that queue
fills, **transactions calling NOTIFY fail at commit**. One stuck LISTEN session — a paused pod, a
listener that stopped reading, a `CdcListener` whose reconnect loop is wedged — is enough to fill it
given a busy table emitting up to 7.9 KB per changed row, at which point every write to every
managed table starts failing with an error about a queue the operator never configured.

Nothing in the subsystem observes this: there is no `pg_notification_queue_usage()` check, no
warning threshold, and `PgNotifyListener` logs a disconnect (`pg-notify-listener.ts:95-100`) without
ever reporting that it has been down long enough to matter. Fix direction: shrink the payload (M2),
and add a periodic `pg_notification_queue_usage()` gauge that warns loudly past ~25 %, since the
first symptom otherwise is a total write outage.

### M5. `markAppEmit`'s purge is quadratic, and a large transaction floods subscribers at commit

`realtimeService.ts:2215-2224`:

```
this.recentAppEmits.set(key, now + CDC_DEDUP_WINDOW_MS);
if (this.recentAppEmits.size > 1000) {
    for (const [k, expiry] of this.recentAppEmits) if (expiry <= now) this.recentAppEmits.delete(k);
}
```

The purge only removes *expired* entries, and the window is 5 s. Above ~200 writes/s the map never
drops below 1000, so every subsequent write scans the whole map and deletes nothing — O(n²) in the
number of writes inside one window. `saveMany` / `withTransaction` make this concrete: notifications
are deferred into `_pendingNotifications` (`PostgresBackendDriver.ts:1146-1153`, unbounded, each
holding a full row) and then flushed serially at commit (`:1633-1645`). A 100 k-row import therefore
runs 100 k `notifyUpdate` calls back to back, each scanning a map that has grown to 100 k entries —
roughly 5×10⁹ iterations on the event loop — while also emitting one `collection_patch` frame per
row to every subscriber of that collection.

The comment at `PostgresBackendDriver.ts:1626-1631` says *"Realtime notifications are already
deferred to commit by `withTransaction`, so a batch does not flood subscribers mid-flight."* It does
not flood them mid-flight; it floods them at commit. Fix: purge by insertion order with a bounded
eviction (the map is already insertion-ordered, so `while (size > MAX) delete first`), and coalesce
a deferred flush by `path` before fanning out.

### M6. Server-side `listenCollection` / `listenOne` register no auth context and drop `logical`

`PostgresBackendDriver.ts:394-430` and `:511-536` call `registerDataDriverSubscription` with
`clientId: "driver"` and **no** `authContext`, and the stored `collectionRequest` omits `logical`
and `searchExplain` — both of which `ListenCollectionProps` carries, since it is
`FetchCollectionProps & { onUpdate, onError }`
(`packages/types/src/controllers/data_driver.ts:155-187`). Two consequences:

- The initial fetch runs through the driver (owner connection for `rebase.data`, or the scoped
  delegate) and every refetch afterwards falls to
  `{ uid: ANONYMOUS_USER_ID, roles: ["anon"] }` (`realtimeService.ts:820-823`). A
  `rebase.data.listenCollection()` in server code sees the full collection once and an
  anonymous-visible subset from the second tick on, silently.
- A `.where(or(...)).listen()` refetch widens past the group — exactly the class-17 defect that
  `realtimeService.ts:75-97` records as fixed for the WebSocket path. The fix was applied to one of
  the two registration sites.

`AuthenticatedPostgresBackendDriver` patches the first half after the fact (see L2) but not the
second. Fix: forward the whole props object into `StoredCollectionRequest` (`const { onUpdate,
onError, ...query } = props`) and pass the driver's own `this.user` as the auth context at
registration time rather than stamping it afterwards.

### M7. CDC triggers are provisioned but never dropped

`provisionTriggerCdc` (`trigger-cdc.ts:132-169`) is the only writer; grepping `DROP TRIGGER` across
`packages/*/src` finds it only inside `buildCdcTriggerSql`'s own idempotency preamble
(`:105`). Nothing removes the trigger when a collection is deleted from the config, renamed, or
moved to another engine. The table keeps firing `pg_notify` with its full row on every write
forever; `handleCdcEvent` resolves no collection and drops the event at `:2136-2138` after the
payload has already crossed the wire — so the cost (M2's exposure and M4's queue pressure) survives
the collection that justified it. `provisionTriggerCdc` also does not report which tables *already*
carry the trigger but are no longer managed, so there is no signal to act on. Fix: enumerate
`pg_trigger` for `rebase_cdc_trigger` at provisioning time and drop the ones not in `cdcTables`,
behind an explicit reconcile rather than silently.

---

## LOW

### L1. The subscription-id namespace is global and has no ownership check

`handleUnsubscribe(_clientId, subscriptionId)` (`realtimeService.ts:585-594`) deletes any id — the
`clientId` parameter is present, prefixed with `_` to mark it deliberately unused.
`handleCollectionSubscription` (`:511`) and `handleEntitySubscription` (`:562`) `set` any id
unconditionally, replacing whatever was there. One flat map holds WebSocket subscriptions from every
client *and* in-process `rebase.data.listen()` subscriptions (`clientId: "driver"`). A client that
names another client's id cancels or hijacks that subscription; naming a driver id silently kills a
server-side listener. Ids are `collection_${Date.now()}_${7 base36 chars}` (client) and
`sub_${Date.now()}_${7}` (driver), which makes blind guessing impractical under the rate limit — so
this is a robustness defect rather than a live attack, but the check costs one line and the
parameter is already threaded in.

### L2. `injectAuthContext` stamps "the last entry of a shared global map"

`PostgresBackendDriver.ts:1657-1670` applies the subscriber's auth context by taking
`Array.from(this.delegate.realtimeService.subscriptions.entries())`, reading the **last** element,
and writing to it if `clientId === "driver"`. It is a positional guess at shared mutable state whose
other writers are untrusted sockets. It happens to be safe today only because
`this.injectAuthContext(this.delegate.listenCollection(props))` evaluates without an intervening
`await` — a single `await` added anywhere in `listenCollection` makes it stamp a stranger's
subscription or silently no-op. The no-op branch is the dangerous one: it fails to *narrow*, leaving
the subscription anonymous with no signal. Also note `uid: this.user?.uid || "anonymous"` and
`roles: this.user?.roles ?? []` diverge from the `{ uid: ANONYMOUS_USER_ID, roles: ["anon"] }`
default used at `realtimeService.ts:820`. Fix: have `listenCollection` accept and store the context
directly (see M6) and delete this function.

### L3. `fetchCollectionWithAuth` and `fetchEntityWithAuth` build a `fetchFn` and never call it

`realtimeService.ts:803-815` and `:1004-1008`. Both are `const fetchFn = async () => this.driver!…`
with zero references — class 20, and reported by `no-unused-vars` under
*"assigned a value but never used"*, which `--quiet` suppresses. Harmless as it stands (the
transaction path below them is the correct one) but they are the shape a reviewer reads as "the
driver is consulted here", which it is not.

### L4. The no-driver fallback in both fetch helpers does no auth at all

`realtimeService.ts:911-939` and `:1070` fall through to `this.dataService` on the raw `this.db` —
no transaction, no `applyAuthContext`, no role downgrade — with the comment *"no auth wrapping
possible"*. Class 29: the fallback grants strictly more than the primary branch. Not reachable in a
bootstrapped backend, because `PostgresBootstrapper.ts:359` always calls `setDataDriver` before
anything can subscribe, so this only fires for a directly-constructed `RealtimeService` (tests). It
should still throw rather than serve unfiltered rows — an unreachable branch that fails open is one
refactor away from being reachable, and Mongo's C3 fixed precisely this shape on its own engine.

### L5. The RLS tests in `realtimeService.test.ts` assert through a fixture key the type does not have

`packages/server-postgres/test/realtimeService.test.ts:354`, `:381` pass
`{ userId: "user123", roles: [...] }` as the auth context. `SubscriptionAuthContext`
(`realtimeService.ts:31-34`) declares `{ uid, roles }`, and `websocket.ts:709-713` sends `uid`. With
`userId`, `activeAuth.uid` is `undefined`, `applyAuthContext` coerces it to `ANONYMOUS_USER_ID` —
and the assertions (`executeCalls.some(sql => sql.includes("set_config('app.user_id'"))`) pass
anyway, because that GUC is set on every path including the anonymous one. Class 7 crossed with
class 8: two tests named after RLS that cannot distinguish an authenticated refetch from an
anonymous one. Assert the bound *value*, not the presence of the statement.

### L6. The truncated CDC payload loses the row's identity for any table not keyed on `id`

`trigger-cdc.ts:86`: `CASE WHEN rec ? 'id' THEN jsonb_build_object('id', rec->'id') ELSE '{}'`. For a
composite key, or a single key column named anything other than `id`, an oversized row degrades to
`{}` → `deriveRowAddress` returns `""` → `extractIdFromCdcRow` yields `"*"` (`:2202-2206`).
Collection subscriptions still refetch, so they recover; single-row subscriptions never match and
hear nothing at all about that change, permanently and silently. The trigger does not know the
collection's key columns — only the consumer does — so the honest fix is M2's identity-only payload
computed from the collection config, which removes the truncation branch entirely.

### L7. `routed-realtime-service.notifyUpdate` drops two parameters

`packages/server/src/services/routed-realtime-service.ts:159-161` forwards four of
`notifyUpdate`'s six parameters, dropping `broadcast` and `origin`. Class 11 — the composite is
written against `RealtimeProvider` (`packages/types/src/types/backend.ts:336`), the concrete service
declares six (`realtimeService.ts:607`), and JavaScript discards the difference in silence. Not
currently exploitable because CDC calls `this.notifyUpdate` internally and never routes, but a
multi-engine deployment that ever routed a CDC-origin notification through here would lose the
de-duplication and double-deliver. Make the narrower declaration reference the wider one.

---

## Checked and clean

- **Trigger SQL construction.** `quoteIdent` doubles embedded quotes and `quoteLiteral` doubles
  embedded apostrophes (`trigger-cdc.ts:42-43`); the injection test at `cdc-trigger.test.ts:33`
  exercises `we"ird`/`ta"ble`. `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` in one statement string
  makes re-provisioning idempotent and picks up a signature change; `CREATE OR REPLACE FUNCTION`
  updates in place without dropping dependents. A table that does not exist yet is skipped with a
  warning rather than aborting the whole install (`:149-161`), which is the right trade for schema
  drift.
- **`applyAuthContext`.** The empty-uid coercion at
  `packages/server-postgres/src/security/rls-enforcement.ts:295` is the correct chokepoint, and its
  doc-block names realtime subscription auth as the exact caller it exists to protect against.
  GUCs are `is_local = true` and the role switch is `SET LOCAL`, so a pooled connection is not
  polluted; a failing role switch aborts the transaction rather than proceeding privileged.
- **The CDC delivery branch itself.** `handleCdcEvent` (`:2129-2150`) and
  `handleJunctionCdcEvent` (`:2168-2199`) never forward `event.row`. Both produce
  `{ _rebase_invalidated: true }` for a change and `null` for a delete, which is what the
  guarantee requires. Junction changes correctly notify the nested child path rather than either
  endpoint collection, with the reason written down.
- **App/CDC de-duplication.** `dedupKey` includes `databaseId`, `consumeAppEmit` deletes on read so
  a key can suppress at most one echo, and the expiry is checked after deletion so a stale key
  cannot suppress a later genuine event. External writes never match. Correct.
- **`PgNotifyListener`.** Channel name is validated against `^[A-Za-z_][A-Za-z0-9_]*$` before
  interpolation (`:34`, `:42-44`); the initial connect is validated and rethrown while reconnects
  are quiet, which is what `REALTIME_CDC=auto`'s fallback depends on; the `notification` handler
  wraps the async callback so a rejection cannot become an unhandled rejection inside pg's emitter
  (`:106-108`); `stop()` clears the reconnect timer before ending the client.
- **`parseCdcPayload`.** Returns `null` for anything malformed, validates `schema`/`table` as
  strings and `op` against the three literals, and defaults a non-object `row` to `{}`. A hostile
  payload on the channel cannot crash the listener.
- **Payload size guard.** `octet_length` on the assembled text against 7900 with the JSON envelope
  accounted for is the right measurement (bytes, not characters) in the right place (after
  assembly, before `pg_notify`).
- **Subscription list limits.** `resolveClientListLimit` is applied at `subscribe_collection`
  (`realtimeService.ts:500-508`) and at `FETCH_COLLECTION` (`websocket.ts:369-374`), refusing rather
  than clamping, with `INVALID_LIMIT` surfaced on both. The comment explaining why refusing matters
  more here than on REST — a `collection_update` frame carries no `total`, so a silently smaller
  page is undetectable — is correct.
- **Vector search on a subscription** is refused with a named code rather than silently answering a
  different query (`:479-487`).
- **`StoredCollectionRequest`** carries all eight fields on the WebSocket path, and both the search
  and non-search branches of `fetchCollectionWithAuth` forward `logical`. (The driver path does not
  — M6.)
- **Timer and subscription cleanup.** `removeClient` (`:389-424`) and `handleUnsubscribe`
  (`:585-594`) both clear all four debounce-timer prefixes, and every debounced callback re-checks
  `this._subscriptions.has(subscriptionId)` before firing, so a disconnect during the 300 ms window
  cannot resurrect a dead subscription.
- **`requireAuth` on the socket** is computed from the shared `resolveRequireAuth` rather than a
  local copy (`websocket.ts:154`), with a boot warning when authentication is required but no
  credential can satisfy it. The class-10 defect this file used to carry is genuinely fixed.
- **Client-side reconnect and backfill.** `resubscribeAll` (`packages/client/src/websocket.ts:1796`)
  mints a fresh backend id per subscription and rewrites both reverse maps, so a late frame carrying
  the old id cannot be dispatched to the new subscription. `createCollectionSubscriptionKey`
  (`:1826-1854`) is derived from the whole props object rather than a hand-listed subset, so two
  queries differing only in `offset` or `logical` no longer collide. The subscribe watchdog is armed
  only while connected and re-armed on connect, which is the right handling for backoff longer than
  the timeout.
- **Client auth ordering.** `doSendMessage` (`:1033-1053`) awaits `ensureAuthenticated` before any
  non-`AUTHENTICATE`, non-channel frame, so a well-behaved client cannot subscribe before
  authenticating. (The server does not require it — see the Open questions.)
- **Error dispatch.** An error frame that matches no waiter is no longer dropped
  (`packages/client/src/websocket.ts:911-916`), and `isAuthError` routes subscription errors into
  `resubscribeAfterAuthRefresh` with a fresh id.

---

## Open questions

1. **Is the Phase 1 patch worth keeping at all?** Removing it (H1's simplest fix) costs 300 ms of
   perceived latency on cross-tab updates and removes an entire class of bug. If it is worth
   keeping, the per-subscriber re-derivation needs a design — grouping subscriptions by auth context
   so one read serves many, and deciding what a subscriber whose read returns nothing should be
   told. Worth answering before writing the fix, because the two answers produce very different
   patches.
2. **Does any supported deployment give an untrusted party a Postgres login?** M2's severity turns
   entirely on this. `rebase_user` is `NOLOGIN`, which closes the obvious door, but the managed
   runtime's shared-pool tenancy tiers and any customer-provisioned analytics role would reopen it.
   Someone who knows the cloud topology should settle whether `LISTEN rebase_cdc` is reachable by
   anyone who should not read every table.
3. **Should a subscription to a row the caller cannot read be refused rather than answered with
   `null`?** `handleEntitySubscription` currently registers it. Refusing would remove the standing
   channel H1 exploits and would make "I lost access" distinguishable from "it was deleted" — which
   may or may not be wanted. Related: on the CDC path, losing read access already arrives as
   `single_update: null`, i.e. as a deletion, which is a small and probably acceptable inference.
4. **What is the intended relationship between `securityRules` and a subscription?** Nothing in
   `handleCollectionSubscription` consults them; RLS in the refetch transaction is the whole of the
   enforcement. That is coherent for a privileged connection with `rlsUserRole` set, but on a
   deployment where `detectConnectionPosture` reports non-privileged *and* the policies were never
   applied (memory: *"RLS policies are migration-applied — a `securityRules` edit is cosmetic
   without one"*), realtime has no gate whatsoever. Is a boot-time refusal to serve realtime on an
   unpoliced collection on the table?
5. **Should the server require `AUTHENTICATE` before `subscribe_*` even when `requireAuth` is
   false?** Today an early subscribe freezes an anonymous context on a socket that later
   authenticates, and the subscription never widens. It fails closed, so it is not a security bug —
   but it is the mirror image of the WS auth race that was just fixed, and it is invisible to the
   user.
6. **Is there a reason `notifyUpdate` takes a `row` at all?** After H1 and H2 the only information
   it needs is `(path, id, deleted: boolean)`. Narrowing the signature would make the leak
   unexpressible rather than merely fixed, and would make L7's dropped parameters harmless.
