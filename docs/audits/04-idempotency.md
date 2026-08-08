# Audit — Unit 4: idempotency

Read-only audit of `packages/server/src/api/rest/idempotency.ts` and every call
site across `packages/server`, `packages/common`, `packages/client` and
`packages/types`. 2026-08-08.

## Verdict

The mechanism is genuinely wired — this is not a declared extension point nobody
reads (class 21): four HTTP write routes claim, replay, release and complete a key,
and the client SDK really does send one on every offline replay of `create`,
`createMany`, `updateMany` and `deleteMany`. The core claim is atomic (a single
`INSERT … ON CONFLICT DO UPDATE … WHERE expired RETURNING`), which is the correct
answer to bug class 19, and the record lives in Postgres (`rebase.idempotency_keys`),
so it survives a restart and is shared by every pod. What it lacks is the other half
of class 19's own warning — *"a claim needs a release path on every exit"*. There is
no exit path for a process that dies (or a `complete` that fails) between the claim
and the answer: the pending row is only reclaimable after the full 24-hour replay
TTL, and for those 24 hours every retry of that write is answered `409
IDEMPOTENCY_KEY_IN_PROGRESS`. The client SDK then classifies that 409 as
non-retryable *and* as a duplicate-key error, so the queued mutation is either
rolled back or silently dropped. A crash mid-write therefore turns a write that
would have succeeded on retry without any idempotency at all into permanent,
silent data loss — the mechanism is a net negative in exactly the scenario it was
built for. Separately, the key is scoped to `(uid, key)` only: no route, no method,
no request fingerprint, so one key reused across two different writes silently
replays the first one's body, and the docs actively recommend a reusable business
id (`importId`) as the key. Nothing in the test suite ever executes the real SQL.

---

## Critical

None. (The highest-impact finding below is data loss, but it needs a crash, a
dropped connection, or a `complete` that fails — not a plain request.)

---

## High

### H1. A claim has no lease: a crash between claim and answer strands the key for 24 hours

`packages/server/src/api/rest/idempotency.ts:138`, `:170`, `:187`;
`packages/server/src/api/rest/api-generator.ts:313`

The only release paths are (a) the handler throwing in-process
(`api-generator.ts:318`, `:631`) and (b) the row ageing past `TTL_HOURS = 24`
(`idempotency.ts:30`, `:143`). Nothing else reclaims a pending row. The takeover
predicate is `created_at < NOW() - INTERVAL '24 hours'` — the *replay* window is
reused as the *lease* window, so a claim held by a process that no longer exists is
indistinguishable from a claim held by a request still running, for a day.

`complete()` (`:170`) is a second, separate statement that swallows its own errors
(`:182`). A `complete` that fails leaves the row pending forever too, even though
the write committed.

Failure scenario: a pod is rolled (or OOM-killed, or `SIGKILL`ed by a node drain)
between `claim` and `complete` on `POST /data/orders` with
`Idempotency-Key: mut-abc`. The row was never inserted. The client retries `mut-abc`
→ `claim` finds a live pending row → `409 IDEMPOTENCY_KEY_IN_PROGRESS`. Every retry
for the next 24 hours gets the same 409. Without the key the second attempt would
simply have written the row.

Fix direction: give a pending claim its own short lease (a `claimed_at`/`expires_at`
column, or reuse `created_at` with a separate `PENDING_LEASE_SECONDS` in the takeover
predicate: `response IS NULL AND created_at < NOW() - INTERVAL '60 seconds'` OR
`response IS NOT NULL AND created_at < TTL`). A pending row past its lease should be
takeable; a completed row keeps the 24-hour window.

### H2. The SDK treats `409 IDEMPOTENCY_KEY_IN_PROGRESS` as fatal — the message tells the caller to do the one thing the SDK will not do

`packages/server/src/api/rest/api-generator.ts:305`;
`packages/client/src/offline-connectivity.ts:39`, `:61`;
`packages/client/src/offline.ts:1482`, `:1548`

The server answers `409` with *"Retry once it has answered; its result will be
replayed."* (`api-generator.ts:306`, and the identical text at `:613`). On the
client:

- `RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504])`
  (`offline-connectivity.ts:39`) — 409 is absent, so `isRetryableError` is `false`
  and `flush()` goes straight to `rejectMutation` (`offline.ts:1491`), which drops
  the op and rolls the local row back (`offline.ts:1694-1702`).
- `isDuplicateKeyError` returns `true` for **any** 409
  (`offline-connectivity.ts:61`: `error.code === "23505" || error.status === 409`),
  including `IDEMPOTENCY_KEY_IN_PROGRESS` — it never looks at `code`.

So the remediation text is untested against its own SDK (class 5), and the two
outcomes are both wrong:

Failure scenario A (silent loss). An offline-created row with an SDK-minted id
(`op.generatedId === true`) is replayed after H1 stranded its key. `inner.create`
throws 409 → `isDuplicateKeyError` says "my earlier attempt landed"
(`offline.ts:1548`) → `findById(op.id)` finds nothing because nothing was ever
written → `if (!row) return;` (`:1553`) → `replay()` resolves without throwing →
`flush()` calls `markSuccess()` and `drop(op)` (`offline.ts:1494-1496`). The queued
write is deleted from the queue. The user's record exists only in the local store,
will never be sent, and disappears at the next server reconciliation. No error is
surfaced.

Failure scenario B (visible rollback). Same 409 on any other op type (or a
caller-supplied id): `rejectMutation` restores the pre-edit row locally and fires
`onSyncError`. The user watches their edit revert for a write the server may be
about to commit.

Fix direction: add 409 to `RETRYABLE_STATUSES` only when
`code === "IDEMPOTENCY_KEY_IN_PROGRESS"` (a plain 409 conflict must stay fatal), and
make `isDuplicateKeyError` require `code === "23505"` or a 409 that is *not*
`IDEMPOTENCY_KEY_IN_PROGRESS`. The status alone does not discriminate (class 18).

### H3. The key is scoped to `(uid, key)` — no route, no method, no request fingerprint

`packages/server/src/api/rest/idempotency.ts:109` (`PRIMARY KEY (uid, key)`),
`:131` (`claim(key, uid)`); `packages/server/src/api/rest/api-generator.ts:298`,
`:605`; `website/src/content/docs/docs/sdk/querying.md:144`

Nothing about *what* the request was enters the key. A key claimed by
`POST /data/posts` is the same key as far as `POST /data/comments/bulk` or
`POST /data/orders/bulk/delete` is concerned, and the replay serves the stored body
of whichever came first, with that route's success status.

Failure scenario 1 (destructive silent no-op): `createMany(rows, { idempotencyKey:
importId })` then, in the same job, `deleteMany(staleIds, { idempotencyKey: importId
})`. The delete never runs; the caller gets `200` with `{ data: […], meta: { written:
N } }` — a response shape from a different endpoint — and `deleteMany` returns
`void`, so nothing looks wrong. The rows are still there.

Failure scenario 2 (silently discarded correction): the documented pattern is
`createMany(rows, { idempotencyKey: importId })` (`querying.md:147`) with a business
id. Re-running the import with corrected rows under the same `importId` inside 24
hours returns the *original* rows with `200` and writes nothing. Stripe answers this
case with an error; here it is indistinguishable from success.

Failure scenario 3 (wrong body, right shape): `create(a, undefined, { idempotencyKey:
"order-42" })` on `orders`, then `create(b, undefined, { idempotencyKey: "order-42" })`
on `invoices` → the caller is handed the *order* row, typed as an invoice, with `201`.

Fix direction: include a request fingerprint in the stored row — at minimum
method + route (collection slug), ideally a hash of the body — and answer
`422 IDEMPOTENCY_KEY_REUSED` when a live key is presented with a different
fingerprint, rather than replaying. Also worth documenting the key as
single-request-scoped in `WriteOptions` (`packages/types/src/controllers/data.ts:548`)
and in `querying.md`.

---

## Medium

### M1. Every anonymous caller shares one principal, which the file's own rationale says must not happen

`packages/server/src/api/rest/idempotency.ts:40` (`principal()` →
`"\u0000anon"`), `:17-20` (the docstring), `packages/server/src/init.ts:1349`

The header comment states: *"A key is honoured only for the principal that created
it. Mutation ids are generated on the client, so keying on the id alone would let
anyone who learned (or guessed) another user's id replay their key and be handed
that user's row back — a read of someone else's data through a write endpoint."*
For unauthenticated callers that guarantee does not hold: `principal(undefined)`
collapses *all* of them into `\u0000anon`, a single global namespace. This is
reachable in a supported configuration — `auth.requireAuth: false` is a warned but
legal setting (`init.ts:1347-1355`) that delegates access control to RLS and leaves
`c.get("user")` unset for anonymous writes.

Failure scenario: a public contact-form backend with `requireAuth: false`. Client A
posts with `Idempotency-Key: submission-1`; client B posts a different message with
the same key within 24 hours. B's row is never written and B receives A's submission
body (name, email, message) with `201`. Same class as `service` — every service-key
caller is `uid: "service"` (`packages/server/src/auth/middleware.ts:150`), so two
unrelated backend jobs collide on a shared key string.

Fix direction: refuse to honour a key for an unauthenticated principal (treat it as
absent, and log once), or mix a stable client identifier into the principal. The
current behaviour is worse than no idempotency for anonymous callers.

### M2. Single-row `PATCH`/`PUT`/`DELETE` ignore the header entirely, including on the offline replay path

`packages/server/src/api/rest/api-generator.ts:646-684` (`updateEntity`),
`:710-742` (delete); `packages/client/src/collection.ts:199`, `:223`;
`packages/client/src/offline.ts:1584`, `:1591`

`updateEntity` and the delete handler never read `IDEMPOTENCY_HEADER`; the client's
`update()` and `delete()` do not accept `WriteOptions` at all (`collection.ts:199`,
`:223`, matching `packages/types/src/controllers/data.ts:679`, `:725`). So the
offline queue replays single `update` (`offline.ts:1585`) and single `delete`
(`:1592`) unkeyed — while the *bulk* variants are keyed, with a comment
(`offline.ts:1572-1575`) explaining that the key "is what stops a lost ACK from
re-applying a stale batch over newer data". The single-row edit is the far more
common offline operation and has none of that protection.

Failure scenario: user edits a row offline; the replay commits but the ACK is lost;
meanwhile another writer updates the same row; the queue replays the same `PUT` and
clobbers the newer value. For delete: the first attempt committed, the ACK was lost,
the replay gets `404` (`api-generator.ts:723`) → non-retryable → `rejectMutation`
restores the deleted row into the local store from `op.rollback` and reports a sync
error for a delete that actually succeeded.

Fix direction: read the header in `updateEntity` and the delete handler (they can
reuse `withIdempotency` with a `respond` that emits `200`/`204`), add
`options?: WriteOptions` to `update`/`delete` in `SDKCollectionClient` and the HTTP
client, and pass `op.mutationId` from the two unkeyed replay branches.

### M3. The in-process SDK silently drops `WriteOptions` — two implementations of one interface disagree

`packages/common/src/data/buildRebaseData.ts:545` (`const client:
SDKCollectionClient<M> = {`), `:564`, `:567`, `:584`, `:604`;
`packages/types/src/controllers/data.ts:637`, `:671`, `:719`, `:751`

The interface declares `create(data, id?, options?: WriteOptions)`,
`createMany(data, options?: {upsert} & WriteOptions)`, `updateMany(updates,
options?: WriteOptions)` and `deleteMany(ids, options?: WriteOptions)`. The
in-process implementation used by `rebase.data` / `context.data`
(`buildSdkData` → `toSdkCollectionClient`) declares `create(data, id)` (`:564`),
`createMany(data, options?: { upsert?: boolean })` (`:567` — reads only `upsert`),
`updateMany(updates)` (`:584`) and `deleteMany(ids)` (`:604`). TypeScript accepts
fewer parameters, so this compiles and no test can see it (class 11 / class 21).

Failure scenario: a cron job or webhook handler writes
`await rebase.data.orders.createMany(rows, { idempotencyKey: batchId })` — the exact
line the docs recommend (`querying.md:147`) — and gets no idempotency whatsoever.
A retried job duplicates the whole batch. The call site looks correct and typechecks.

Fix direction: either implement the option in the in-process path (it has the driver;
it could reach the same store) or make the in-process client reject a supplied
`idempotencyKey` with a clear error instead of ignoring it. Silently accepting an
option that does nothing is the worst of the three.

### M4. `ensure()` caches its own failure for the life of the process, and the per-call catches are silent

`packages/server/src/api/rest/idempotency.ts:99-128` (`ready ??=`), `:163`
(`catch { return { status: "claimed" } }`), `:182`, `:196`

`ready` memoises a `Promise<boolean>`; a `false` is cached forever. One transient DDL
failure on the first request that ever carries a key — the database still starting,
a lock on the `rebase` schema, a concurrent `CREATE TABLE IF NOT EXISTS` from a
sibling pod (see M5) — permanently disables idempotency on that pod, after exactly
one `logger.warn`. Worse, the three per-call `catch` blocks (`:163`, `:182`, `:196`)
log nothing at all: if the claim SQL is ever rejected (a column added by an older
version, a permission change, a statement the driver refuses), every request
degrades to "claimed" and the whole mechanism is off with **zero** signal, while the
routes keep behaving as if it were on. Class 4 — a safety net that swallows its own
failure.

Failure scenario: a deploy where the DB is briefly unreachable; the first keyed write
lands during that window; from then on every replayed offline write on that pod
inserts duplicates, and the only evidence is one line in the boot logs.

Fix direction: do not cache a `false` (retry `ensure` on the next call, with a
backoff), and log at `warn` — rate-limited — from the `claim`/`complete` catches so
a permanently degraded store is visible.

### M5. `CREATE TABLE IF NOT EXISTS` is check-then-act between pods

`packages/server/src/api/rest/idempotency.ts:103-112`

The table is created lazily on the first request carrying a key. In a multi-pod
deployment (the managed runtime's normal shape) several pods reach that first request
within the same second. Concurrent `CREATE TABLE IF NOT EXISTS` in Postgres is not
race-free: the losers can raise `23505` on `pg_type_typname_nsp_index` /
`duplicate key value violates unique constraint`, which is caught at `:119` and, per
M4, cached as a permanent `false`. Same class already recorded for boot-time schema
ensure ("CREATE IF NOT EXISTS races, 8/10 boots lose").

Fix direction: retry `ensure()` once on a duplicate-object error (`23505`, `42P07`)
before giving up, and do not cache the failure.

### M6. `release()` assumes the failed write did not commit — `afterSave` breaks that

`packages/server/src/api/rest/api-generator.ts:315-322`, `:628-635`;
`packages/server-postgres/src/PostgresBackendDriver.ts:652` (`dataService.save`),
`:707-744` (`afterSave`), `:767` (`notifyUpdate`)

The route releases the key on *any* throw from `run()` / `driver.save`. But
`driver.save` commits the row at `PostgresBackendDriver.ts:652` and *then* runs
`afterRead` (`:663`), `afterSave` (`:707`) and the realtime notify (`:767`), outside
any surrounding transaction. A throw from any of those propagates out of `save` after
the row is durable.

Failure scenario: `afterSave` on `orders` calls a payment provider and throws on a
timeout. The order row is committed; the route releases `mut-abc`; the offline queue
retries `mut-abc`; the key is free; a second order row is inserted. This is the exact
duplicate the mechanism exists to prevent, produced by the mechanism's own release
path.

Fix direction: release only for failures known to precede the commit. Either move
the post-commit callbacks inside the transaction, or have the driver mark an error
as "already committed" (it already distinguishes SQLSTATEs elsewhere) and skip the
release for those — leaving the key pending so the retry replays instead of rewriting.

---

## Low

### L1. No test ever executes the real SQL

`packages/server/test/api-generator-idempotency.test.ts:19-60` (and the duplicated
store at `:222-260`)

The fake `executeSql` is explicit that it models "the semantics the real SQL relies
on rather than matching its text" (`:21`). It matches on `/^\s*INSERT INTO/` and
returns `[]` whenever a row exists — so the TTL-takeover branch
(`ON CONFLICT … DO UPDATE … WHERE created_at < NOW() - INTERVAL '24 hours'`,
`idempotency.ts:141-144`), the `response IS NULL AS pending` projection (`:155`), the
`response IS NULL` guard on `release` (`:193`) and the prune (`:180`) are never
executed by anything. `grep -rl "Idempotency-Key" packages/*/test` returns exactly
one file, and no `server-postgres` e2e test mentions `idempotency_keys`. Given M4's
silent catches, a syntax or semantics error in that SQL would present as "idempotency
quietly does nothing" and every test would still pass (class 3).

Fix direction: one `server-postgres` e2e that posts the same key twice against a real
database, and one that back-dates `created_at` to assert the takeover.

### L2. Pruning only happens inside `complete()`, at 1%

`packages/server/src/api/rest/idempotency.ts:179-181`

Rows are deleted only on a 1-in-100 successful `complete`. A workload whose keyed
writes mostly fail (each `release`s, never `complete`s) never prunes, and neither
does one that is merely low-volume — the table then holds every key ever claimed. It
is small and indexed, so this is housekeeping, not a bug; worth noting because the
comment presents opportunistic pruning as sufficient.

### L3. The store is built from the default driver only

`packages/server/src/api/rest/api-generator.ts:70`;
`packages/server/src/init.ts:1449-1452`

`createIdempotencyStore(this.driver)` uses the *default* driver, while writes use
`getScopedDriver(c)`, which in a multi-engine project may be another engine
entirely. Sharing one store across engines is the right call, but if the default
driver is not a SQL driver (`isSQLAdmin` false, `idempotency.ts:94`) the store is
`undefined` and idempotency is silently off for *every* collection, including the
Postgres ones. No log fires on that path at all — `createIdempotencyStore` returns
`undefined` without a word.

Fix direction: build the store from any registered SQL-capable driver, and log once
at `info`/`warn` when no driver can host it.

### L4. `Idempotency-Key` is documented on the three bulk routes but not on the single create that honours it

`packages/server/src/api/openapi-generator.ts:303-312`, `:336`, `:382`, `:443`

`POST /data/{slug}` honours the header (`api-generator.ts:599`) but its OpenAPI
operation carries neither the parameter nor the `409` response, so a generated client
has no way to reach the feature on the most common write, and a spec-validating
gateway may strip the header. The inverse of the usual drift.

### L5. Auth-collection creates are deliberately unkeyed, and nothing says so to the client

`packages/server/src/api/rest/api-generator.ts:556-593`, `:595-598`

The signup branch returns before the idempotency block, with a good reason (the
response may carry a temporary password). But the client cannot tell: the offline
queue will still send `Idempotency-Key` on a `users` create and receive no
idempotency, and `WriteOptions.idempotencyKey`
(`packages/types/src/controllers/data.ts:534-549`) documents no exception. The
duplicate is usually caught by the email unique constraint, which is why this is low.

Fix direction: document the exception on `WriteOptions`, or answer `400` when a key
is sent to an auth-collection create rather than accepting and ignoring it.

---

## Checked and clean

- **The claim is genuinely atomic.** `INSERT … ON CONFLICT (uid, key) DO UPDATE SET
  … WHERE <expired> RETURNING 1` (`idempotency.ts:138-146`) claims a free or expired
  key and yields no row for a live one. This is the correct fix for class 19 and the
  concurrent-replay test (`api-generator-idempotency.test.ts:161-176`) asserts
  `[201, 409]` for two simultaneous requests.
- **Pending vs. stored-null is handled.** `SELECT response, response IS NULL AS
  pending` (`:155`) distinguishes an unanswered claim from a legitimately stored
  JSON `null`, and `complete` stores `JSON.stringify(response ?? null)` (`:175`) so a
  null body is a real JSONB null, not SQL NULL.
- **The table is not reachable by the end-user role.** `revokeInternalTableSql`
  runs at creation (`:117`) and `idempotency_keys` is in `REBASE_INTERNAL_TABLES`
  (`packages/common/src/util/internal-tables.ts:83`), so `rls:check` will catch a
  regression.
- **The store never fails a write.** Every method swallows and degrades to "no
  idempotency" (`:132`, `:163`, `:182`, `:196`) — correct policy, though M4 covers
  the missing signal.
- **Replay preserves the original status code.** `201` on the create path
  (`api-generator.ts:609`) and `200` via `respond` on the bulk paths (`:301`).
- **The claim happens after authorization and validation.** `enforceApiKeyPermission`,
  `assertBulkShape` and `assertKnownWriteFields` all run before the claim
  (`api-generator.ts:369-401`, `:526-546`), so a malformed request cannot burn a key.
- **The NUL sentinel is written as an escape** (`:41`), so the file is not treated as
  binary by grep — the class-mitigation noted in its own comment holds.
- **Storage:** Postgres, `rebase.idempotency_keys`, so it survives a restart and is
  shared across pods. Not in-memory.
- **Client SDK does send keys** on `create`, `createMany`, `updateMany`,
  `deleteMany` (`packages/client/src/collection.ts:158`, `:177`, `:216`, `:249`) and
  the offline queue sets `op.mutationId` on every one of those replays
  (`offline.ts:1532`, `:1565`, `:1579`, `:1589`).
- **Header lookup is case-insensitive** — Hono lowercases in `c.req.header()`, so
  the `Idempotency-Key` spelling in `IDEMPOTENCY_HEADER` (`idempotency.ts:204`)
  matches whatever casing a client sends.
- **Cross-tab double-flush** is already prevented by a Web Lock
  (`offline.ts:1736-1747`), so the "two tabs replaying together" case the store's
  comment cites is not the main source of in-flight collisions in a browser — the
  crash/stranded-key case (H1) is.

---

## Open questions

1. **Multi-tenant scope (UNCONFIRMED).** `TABLE` is hard-coded to
   `"rebase"."idempotency_keys"` (`idempotency.ts:22`). This is safe if every tenant
   runtime holds its own database, which is what the managed runtime appears to do,
   but if any tenancy tier ever puts two tenants in one database separated by schema,
   two tenants' keys would collide in one table (and `uid` values are not
   tenant-qualified). Confirm by checking how `DATABASE_URL` is issued per tenant in
   the shared-pool tier.
2. **Is `INSERT INTO "rebase"."idempotency_keys" … ON CONFLICT … DO UPDATE … WHERE
   "rebase"."idempotency_keys".created_at < …` accepted by Postgres?** Schema-
   qualified column references to the conflict target should resolve, but per L1 no
   test executes it. One `psql` run against a scratch database would settle it; if it
   is wrong, M4's silent catch means nobody would ever find out.
3. **Should a replayed response be re-authorized?** A stored body is served back
   without re-checking RLS or API-key permissions. With `(uid, key)` scoping the
   original principal is the only one who can reach it, so this is currently sound —
   but it stops being sound the moment M1 (shared anonymous principal) or H3
   (cross-route reuse) is in play.
4. **How long can a legitimate bulk write run?** The 409 window is the whole duration
   of the first request. If a 1000-row batch behind a 60-second load-balancer timeout
   is normal, H2's failure mode is not rare — it is the default outcome of every
   slow batch on a flaky connection.
