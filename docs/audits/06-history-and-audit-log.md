# Audit — Unit 6: entity history and audit log

Read-only audit of `packages/server/src/history/`, `packages/server-postgres/src/history/`,
`packages/server-mongo/src/services/MongoHistoryService.ts`, every `recordHistory` call
site in both drivers, the admin history UI (`packages/cms/src/components/history/`,
`packages/cms/src/hooks/useHistory.ts`), and the mount in `packages/server/src/init.ts`.
2026-08-09.

## Verdict

**The read side is fixed and the fix is sound.** The class-33 hole that was already
found — a privileged reader on a route that never asked who was calling — is genuinely
closed: `authorizeEntityRead` (`packages/server/src/history/history-routes.ts:66`) now
runs the same two gates the REST generator applies (API-key permission list keyed on the
request method, then an RLS-bound `fetchOne` through `c.get("driver")`), refuses to fall
back to the unscoped driver, and answers 404 rather than 403 so the answer does not
confirm the row exists. `history-routes-authorization.test.ts` pins all of that against
faithful fixtures. The hypothesis that history returns fields the row endpoint strips
**does not hold**: `values`/`previous_values` are produced by `fetchOneForRest` →
`toRestRow` → `stripExcluded`, so `excludeFromApi` columns (password hashes, verification
tokens) never enter the table. The table itself is revoked from `rebase_user` at creation
and is listed in `REBASE_INTERNAL_TABLES`, so `rls:check` keeps it honest. Both routes are
the only HTTP surface that touches `rebase.entity_history`; the sibling audit surface
(cron logs) is admin-gated.

**The write side is where this subsystem is actually broken**, and it is broken in the
way that matters for something called an audit trail: *integrity*, not confidentiality.
The WebSocket `DELETE` handler forwards the client's `DeleteProps` straight to the driver,
and the driver writes `row.values` — attacker-supplied, unvalidated — into the history
record as the deleted row's final state, after first handing that same forged object to
every `beforeDelete` guard. History rows are inserted on the pool handle while the write
they describe runs in a transaction, so a rolled-back batch leaves permanent entries for
changes that never happened, and a failed insert is swallowed. Retention is enforced only
per-row on write, capped at 200 entries, which makes the trail self-erasing by anyone who
can write to the row; the global sweep the docs say runs every six hours has **zero call
sites**. And the "full audit trail" is silent on every auth write (signup, password
change, role grant), on `deleteAll`, and — for reads — on every subcollection write, which
is recorded under a key the read route never queries.

One design property deserves naming even though it is not a bug in any single line:
authorization for the *whole* history is the policy on the row *now*. Ownership, tenant
and visibility columns are mutable, so acquiring a row acquires everything it ever was.

---

## Critical

None.

---

## High

### H1. WebSocket DELETE writes attacker-supplied values into the audit record — and into `beforeDelete`

`packages/server-postgres/src/websocket.ts:420-426`
→ `packages/server-postgres/src/PostgresBackendDriver.ts:1037` (`targetRow`), `:1135-1141` (`recordHistory`)

The socket handler does:

```ts
case "DELETE": {
    const request: DeleteProps = payload;      // straight off the wire
    const delegate = await getScopedDelegate();
    await delegate.delete(request);
```

`DeleteProps.row.values` is never read back from the database on this path. The driver
builds `const targetRow = { ...(row.values ?? {}) }` from it, passes that to the three
`beforeDelete` callbacks (which may return `false` to veto), and then records
`values: row.values ?? {}` as the history entry for the deletion.

Both REST delete routes (`api-generator.ts:760`, `:1041`) fetch the row through the
scoped driver first, so their record is server-derived. The socket is the odd one out —
class 17 along the call-site axis: the feature ("the recorded row is the row that was
there") was applied at two of the three call sites.

Failure scenario — attacker capability → impact:

* An authenticated user who may delete one of their own rows sends the delete over the
  socket with `row.values` set to anything. The delete succeeds (RLS is enforced —
  `PersistService.delete` throws on zero rows, so the target must genuinely be theirs),
  and the audit log permanently records a fabricated final state. The one record whose
  entire purpose is to say what was destroyed is written by the party destroying it.
* Worse, the same tainted object is the input to `beforeDelete`. A collection that vetoes
  deletion on the row's contents — `if (row.values.status === "locked") return false`, a
  legal-hold flag, a non-zero balance — is bypassed by sending `values: {}`. That is an
  authorization decision made on attacker-controlled data, not an audit-quality issue.

Fix direction: the delete pipeline should read the row itself rather than trusting a
caller-supplied copy. `deleteMany` already does exactly this
(`PostgresBackendDriver.ts:993-1011` fetches, then calls `delete` with what it read); lift
that fetch into `delete()` so no caller can supply `values`, and narrow the wire
`DeleteProps` to `{ path, id }`. Failing that, the socket handler must fetch through
`getScopedDelegate()` and rebuild `row` before calling the driver, the way the REST routes
do.

---

## Medium

### M1. Reading a row today grants its entire past, including versions the caller could never have read

`packages/server/src/history/history-routes.ts:83` (`scoped.fetchOne` is the whole check)

The gate is "can you read this row *now*". The payload is every value the row has ever
held. Nothing re-evaluates the collection's policy against the historical values, and
nothing can: `rebase.entity_history` carries no tenant, owner or visibility column, only
`(table_name, entity_id)`.

Failure scenario:

* A policy of the shape `WHERE published = true` (or `status = 'public'`) is the common
  pattern for a CMS. Every unpublished draft of a currently-published row is readable by
  anyone who can read the published row — the history route serves the drafts the row
  endpoint exists to hide.
* A row whose `owner_id` / `assigned_to` / `org_id` is editable (ticket reassignment,
  record transfer, a lead moved between reps) hands the new owner every prior value,
  including columns the previous owner considered private. In a multi-tenant deployment
  where the tenant key is a column rather than a schema, this is a cross-tenant read
  reached by an ordinary, allowed write.

Fix direction: this is a product decision, and the honest first step is to say it out
loud in the docs — "history is readable by anyone who can currently read the row". Beyond
that, the two mechanisms that would actually close it: gate the route on a separate
capability (an `admin.history: { read: … }` rule, or the collection's `update` policy
rather than its `select` policy, on the theory that whoever may change a row may see how
it changed), and/or record on each entry the value of the collection's declared scoping
column(s) at write time so the route can filter. Do not add a JS-side filter over the
privileged read without deciding which column is the scope — that is how the original
class-33 bug was written.

### M2. The audit trail is self-erasing, silently, by anyone who can write the row

`packages/server-postgres/src/history/HistoryService.ts:84` (prune on every insert),
`:166-175` (`maxEntries`, default 200), `:20-23`

`pruneEntity` runs fire-and-forget after every recorded change and deletes everything past
the newest 200 entries for that row. There is no floor, no append-only copy, no export,
and no signal that entries were dropped — `meta.total` is the post-prune count, so a
client cannot tell 200-of-200 from 200-of-3000.

Failure scenario: an attacker (or a careless insider) makes a change they want hidden,
then flips any single field back and forth 200 times. `recordHistory` skips no-op updates,
so the writes must change something, but a boolean or a whitespace edit qualifies and each
costs one ordinary authorized request. Their earlier entry is deleted by the platform
itself. Total cost: 200 requests, no elevated privilege, no trace.

Fix direction: an audit log that the audited party can truncate is not one. Either the
retention floor becomes a policy the operator sets (and `maxEntries` becomes reachable —
see L2), or pruning stops being triggered by the writer. At minimum, record a
`pruned_before` watermark per `(table_name, entity_id)` so the API can report that entries
were removed, and prefer TTL-only retention for collections marked as audited.

### M3. History is written outside the transaction it describes, and its failures are swallowed

`packages/server-postgres/src/history/HistoryService.ts:29-37` (holds the pool handle),
`:68-89`; `packages/server-postgres/src/PostgresBackendDriver.ts:841`, `:911`, `:981`,
`:1623` (tx sub-drivers all receive `this.historyService`)

`HistoryService` is constructed once at boot with `internals.db` — the pool — and every
transaction-bound sub-driver is handed that same instance. So `saveMany`, `updateMany`,
`deleteMany` and every `withTransaction` write their history rows on a *different*
connection from the write, and commit independently of it.

Failure scenarios:

* A 10,000-row `createMany` that fails on row 9,999 rolls back every row and leaves 9,998
  history entries asserting creations that do not exist. Same for any user `beforeSave`
  hook that throws late, and for `updateMany`'s documented all-or-nothing abort.
* The insert is wrapped in `try { … } catch { logger.error(…) }` and the caller never
  awaits it (class 4). A history table that is missing, full, or revoked produces a
  perfectly healthy-looking API with no audit trail at all. `ensureHistoryTableExists`
  has the same shape one layer up (`ensure-history-table.ts:49-52`: log and continue).

Fix direction: pass the transaction handle down — `recordHistory` should take an optional
executor, and the tx sub-drivers should bind one, so the record commits with the write or
not at all. Then decide deliberately whether a history failure should fail the write for
collections marked audited; if it should not, surface it as a counter/health signal rather
than only a log line.

### M4. The global retention sweep does not exist, and the docs say it runs every six hours

`packages/server-postgres/src/history/HistoryService.ts:185` (`pruneExpired`, zero callers);
`website/src/content/docs/docs/backend/history.md` ("A background cleanup cron sweep
(`pruneExpired`) runs every **6 hours**")

Grepped across `packages/` and `saas/`: the only references to `pruneExpired` are its
definition and its docstring. TTL is therefore enforced *only* as a side effect of writing
to that specific row.

Consequences:

* A row that stops being written keeps its history forever, `ttlDays` notwithstanding.
* A **deleted** row's history is never pruned again by construction — and it is also
  unreadable, because `authorizeEntityRead` 404s once `fetchOne` returns nothing. The
  deletion records are write-only and immortal. For a collection holding personal data
  that is a retention-policy problem with a documented-but-absent control, and the
  deletion audit trail — the part anyone would actually want — cannot be read back through
  any API.
* Unbounded growth on one un-partitioned table shadowing every audited collection, with no
  index on `updated_at` alone (`ensure-history-table.ts:32-40` indexes
  `(table_name, entity_id)` and `(table_name, entity_id, updated_at DESC)`), so the sweep
  will seq-scan whenever someone does wire it up.

Fix direction: register `pruneExpired` on the cron scheduler (the machinery exists), add
the `updated_at` index it needs, and correct the doc. A retention control that is
documented and unwired is worse than one that is absent — an operator reads it and stops
looking.

### M5. Whole classes of mutation are absent from the "full audit trail"

The claim under audit is the doc's: *"who changed what, when"*. Measured:

| path | recorded? | where |
|---|---|---|
| REST create/update/delete | yes | `api-generator.ts:599/715/770` → driver |
| bulk create/update/delete | yes (loops single-row pipeline) | `PostgresBackendDriver.ts:831/904/974` |
| in-process SDK / functions / cron | yes, but attributed to `service` (M6) | `init.ts:1527` |
| WebSocket save/delete | yes, delete content forged (H1) | `websocket.ts:402/420` |
| **auth writes** — signup, password change, `setUserRoles`, email verification, MFA | **no** | `packages/server-postgres/src/auth/services.ts:252`, `:413`, `:522` write the users table directly through `withServerContext`, never through the driver |
| **`deleteAll`** | **no** — and no callbacks either | `PostgresBackendDriver.ts:1164-1168` |
| subcollection writes | recorded, but under an unreadable key (M7) | `api-generator.ts:976/1011/1048` |
| `executeSql` / `rebase.sql()` | no (expected) | — |

The auth row is the damaging one. `users` is the collection an operator is most likely to
mark `history: true`, and its History tab will faithfully show admin-panel edits while
showing nothing for the account being created, its password being reset, or its role being
escalated to `admin`. That is not an incomplete log, it is a misleading one: absence reads
as "nothing happened".

Fix direction: either route auth mutations through a history-recording path, or have
`initializeRebaseBackend` refuse/warn at boot when `history: true` is set on an auth
collection, naming exactly which operations are not covered. `deleteAll` should record a
single collection-scoped entry (or be documented as unaudited).

### M6. Every write from a function, cron job or hook is attributed to `service`

`packages/server-postgres/src/PostgresBackendDriver.ts:755`, `:1140` (`updatedBy: this.user?.uid`);
`packages/server/src/init.ts:1525-1528` (`scopeDataDriver(defaultDriver, SERVICE_IDENTITY)`);
`packages/server/src/auth/rls-scope.ts:38` (`{ uid: "service" }`)

`rebase.dataAsAdmin` is scoped once at boot as `service`, so every write made on a user's
behalf inside a custom function, a cron job or a collection callback records
`updated_by: "service"`. Privileged writes are precisely the ones an audit log is kept
for, and they are the ones whose actor is erased. The admin UI then renders the literal
string `service` in a chip where a user name goes (`EntityHistoryEntry.tsx:132`).

Fix direction: thread the originating identity into the call context (the callbacks
already receive a `RebaseCallContext`) and let `recordHistory` prefer it, with `service`
as the fallback for genuinely un-attributed work. Distinguishing "the platform did this"
from "the platform did this for Alice" is the whole value of the column.

### M7. Subcollection history is recorded under a key nothing reads

Write: `api-generator.ts:977` passes `path: parsed.collectionPath` — e.g.
`authors/111094/posts` — and `PostgresBackendDriver.ts:749` stores that verbatim as
`table_name`.
Read: `history-routes.ts:126` queries `table_name = collection.slug` — `posts`.

So a row edited through its nested route accumulates history that the History tab can
never show, and the tab reports the row as unmodified. Where a row is reachable by both
routes, its history is split across two keys and the panel shows half of it, with no
indication that it is a half. The same mismatch exists for any collection whose
`getCollectionDataPath()` differs from its slug (Mongo/Firestore collections declaring
`path`) — `authorizeEntityRead` also looks the row up by `collection.slug` rather than by
the data path, so those collections 404 on their own history.

Fix direction: one function decides the history key, used by both the recorder and the
reader — derive it from the *collection*, not from the request path, so a nested write and
a top-level write to the same row land in the same bucket.

---

## Low

### L1. In-process SDK `delete(id)` records an empty row

`packages/common/src/data/buildRebaseData.ts:275-280` sends
`row: { id, path: slug, values: {} }`. The resulting history entry says the row was
deleted and that it contained nothing. Same hop as H1, different symptom, and it also
starves `beforeDelete` of the row it is supposed to judge.

### L2. The documented retention config is not the one the code accepts

Docs: `history: { maxEntries: 200, ttlDays: 90 }`
(`website/src/content/docs/docs/backend/history.md`).
Code: `HistoryConfig = boolean | { retention?: number }`
(`packages/types/src/controllers/client.ts:232`), read as
`retention ? { ttlDays: retention } : undefined`
(`PostgresBootstrapper.ts:791`, `MongoBootstrapper.ts:126`).

An operator following the docs sets neither value and silently gets the defaults —
`maxEntries` is declared in a public type (`HistoryRetentionConfig`) and is unreachable
from any user config at all (class 21). `retention: 0` is falsy and also falls through to
90 days.

### L3. A negative `retention` purges the whole trail on the next write

`HistoryService.ts:161`: `updated_at < NOW() - MAKE_INTERVAL(days => ${ttlDays})`. With
`retention: -1` the cutoff is in the *future*, so the next write to any audited row
deletes that row's entire history. The value is parameterized (no injection) and never
validated. Refuse a non-positive integer at boot.

### L4. The documented REST response shape is not the one served

Docs show `collection_slug`, `operation`, `user_id`, `created_at`; the route serves
`table_name`, `action`, `updated_by`, `updated_at`
(`HistoryService.ts:111-112`, `packages/types/src/types/history.ts:26-37`). A client
written from the docs reads `undefined` for every field.

### L5. Mongo has no history read path at all

`MongoHistoryService` (`packages/server-mongo/src/services/MongoHistoryService.ts`)
implements `recordHistory` and `pruneHistory` only — no `fetchHistory`, no
`fetchHistoryEntry`. `init.ts:920` casts the bootstrapper's return to the route's
`HistoryService` interface, so on a Mongo backend `GET …/history` calls `undefined` and
500s. Two type declarations of one hop, agreeing only nominally (class 11). Mongo also
records under `getCollectionDataPath()` while the route reads `slug` (see M7).

### L6. Revert skips the write validators every other write runs

`history-routes.ts:209` calls `authDriver.save()` directly. `assertKnownWriteFields` and
`assertWriteValuesValid` — applied on every REST create, update and nested write — are not
applied here. The values are server-stored rather than caller-supplied, so this is not an
injection path; the reachable consequence is that a revert can restore a value that today's
declared constraints reject (a field tightened since the revision was written), producing a
row the API would refuse to accept. `beforeSave` and the driver's `assertWritableColumns`
backstop do still run.

### L7. `updated_by` uids are disclosed to every reader of the row

Anyone who can read a row learns the uid of everyone who ever edited it
(`history-routes.ts:141`, rendered at `EntityHistoryEntry.tsx:132`). Usually intended for
an admin panel; on a collection with `access: "public"` selects it is an unadvertised
identifier leak.

### L8 (UNCONFIRMED). `getValueInPath` on a data-derived key, in the history UI

`EntityHistoryEntry.tsx:153-154` reads `getValueInPath(entry.values, key)` where `key`
comes from `changed_fields`, i.e. from column names. `findChangedFields` skips keys
starting with `__`, but not `constructor`. This is the read half of the class-22 pair; it
requires a column literally named `constructor` to reach, and I did not confirm what
`getValueInPath` returns for it in `@rebasepro/utils`. Noted for the class sweep, not as a
live exposure.

---

## Checked and clean

* **The class-33 fix holds.** `authorizeEntityRead` runs before every privileged read on
  both routes, uses `c.get("driver")` with no fallback (500 when absent), and the revert
  route calls it *before* `fetchHistoryEntry`, so even "does this history id exist" is not
  answerable for a row you cannot read (`history-routes.ts:174-177`).
* **Denied and absent are indistinguishable.** 404 both ways, and the responses differ only
  in the id the caller themselves supplied — pinned by
  `history-routes-authorization.test.ts:120`.
* **API-key scoping is the same predicate REST uses**, keyed on the request method, so a
  `read`-only key gets 403 on revert and a key scoped to another collection gets 403 on the
  list (`history-routes.ts:71-78`, `api-key-permission-guard.ts:23`). API keys do not bypass
  RLS — `validateApiKey` scopes the driver like any other caller
  (`api-key-middleware.ts:122-135`), and both the built-in and adapter middlewares route
  `rk_` tokens through it, so `c.get("apiKey")` is always populated when it should be.
* **`excludeFromApi` columns are not in history.** Both `values` and `previousValues`
  originate from `fetchOneForRest` (`PersistService.ts:469`,
  `PostgresBackendDriver.ts:584`), which ends in `toRestRow` → `stripExcluded`
  (`row-pipeline.ts:239`, `:104-116`). Password hashes and verification tokens are absent
  from the table itself, not merely from the response — so the "history returns what the
  row endpoint strips" hypothesis is false for the save path. (Note the corollary: field
  values are stored *post*-`afterRead`, so any decrypt-on-read hook would persist plaintext
  into history. No core collection registers one; `saas`'s encryption hooks are on
  collections that do not set `history`.)
* **The table is out of `rebase_user`'s reach.** `ensure-history-table.ts:46` revokes at
  creation, after the schema-wide grant; `entity_history` is in `REBASE_INTERNAL_TABLES`
  (`packages/common/src/util/internal-tables.ts:83`) so the boot-time sweep and
  `pnpm rls:check` both cover it. Boot order is grant-then-revoke (driver init at
  `init.ts:~590`, history at `:918`).
* **No forgery of `updated_by`, `entity_id` or `table_name` from the wire.** `updatedBy`
  comes from `this.user?.uid`, never the request body; the delete's `entity_id`/`table_name`
  double as the delete target, so a bogus one fails the delete
  (`PersistService.ts:136-139` throws on zero rows). Only `values` is free (H1).
* **No route creates, edits or deletes history entries.** Retention is the only deletion
  path; there is no collection registered over `rebase.entity_history`, and the MCP server
  and CLI expose no history surface.
* **Revert cannot cross entities** — both `entity_id` and `table_name` are checked against
  the URL (`history-routes.ts:188`) — and it writes through the normal save path on the
  scoped driver, so it produces its own history entry and is bound by RLS.
* **Pagination is honest.** `limit` above 100 is refused with `INVALID_LIMIT` naming the
  ceiling rather than clamped, `offset` is floored at 0, and `meta` echoes what was applied
  (`history-routes.ts:104-147`).
* **SQL is parameterized throughout** `HistoryService`; the only interpolated identifiers go
  through `revokeInternalTableSql`, which validates against `^[A-Za-z_][A-Za-z0-9_$]*$`.
* **Bulk paths do record history** — `saveMany`/`updateMany`/`deleteMany` loop the
  single-row pipeline rather than emitting one statement, deliberately
  (`PostgresBackendDriver.ts:831-1027`) — and both REST delete routes fetch the row before
  deleting, so their records are server-derived.
* **The sibling audit surface is gated.** `createCronRoutes` (job logs, a privileged read of
  `rebase.cron_logs`) is mounted behind `applyAdminGate` (`init.ts:1777`).
* **The admin UI does not widen anything.** `useHistory` and `LastEditedByIndicator` call the
  same REST route with the user's bearer token; no `dangerouslySetInnerHTML`; values render
  through `PropertyPreview`.

---

## Open questions

1. **Is `history: true` used on an auth collection anywhere in practice?** M5's severity
   turns entirely on that. If the `users` collection is a common target, the boot-time
   refusal is worth more than the fix.
2. **H1's blast radius depends on whether any shipped collection uses `beforeDelete` as a
   veto.** I found the bypass by reading the pipeline, not by finding a victim. Worth a
   grep across `saas/` and the example apps before deciding between "audit forgery" and
   "authorization bypass".
3. **Column-level grants.** I found no deployment that revokes individual columns from
   `rebase_user`, so "history returns a column the row endpoint cannot" has no live
   instance. If one is ever added, history bypasses it — the strip is by `excludeFromApi`
   in the config, not by the database's grant.
4. **Multi-database.** `entity_history` has no schema/database qualifier, only
   `(table_name, entity_id)`. Today `databaseId` is threaded through the Postgres
   `FetchService` but ignored (`FetchService.ts:305`, `:947` take it as `_databaseId`), so
   two same-slug collections in different databases cannot currently collide. If that
   parameter is ever honoured, the history key becomes ambiguous — it should grow the
   qualifier before then, not after.
5. **Does the socket's SAVE path need the REST write validators?** It skips
   `assertKnownWriteFields`/`assertWriteValuesValid` as well. Out of this unit's scope, but
   it is the same "two transports, one pipeline, one set of checks" gap as H1 and probably
   belongs in the REST-surface unit's ledger.
