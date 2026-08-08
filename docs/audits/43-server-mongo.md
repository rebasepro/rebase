# Unit 43 — `packages/server-mongo`, as an alternative backend driver

Read-only audit, 2026-08-08. Scope: `packages/server-mongo` measured against the
Postgres driver and the platform contracts it plugs into (`BackendBootstrapper`,
`DataDriver`, `RealtimeProvider`, `AuthRepository`).

**Is it published and installable?** Yes. `@rebasepro/server-mongo` is on npm at
`0.13.0` stable (plus canaries), `files: ["dist", "src"]`, and it is wired into
the driver registry — `packages/server/src/boot/sources.ts:106-107` maps
`mongodb`/`mongo` to it, and `packages/server/test/boot-sources.test.ts:72` pins
that. So a developer reaching for it gets a real, installable, first-party
driver.

**Does it implement the current driver interface?** Structurally yes, with one
arity drift (H2 below). It implements every required member of `DataDriver`, and
omits the optional bulk methods, which the REST layer refuses cleanly with
`BULK_UNSUPPORTED` — that one is exemplary.

**The headline.** The platform's security model is Postgres RLS. Mongo has no
RLS, and the answer to "what enforces row access instead" is not "nothing" and
not "an equivalent" — it is **two different mechanisms on two different code
paths, and the one guarding writes and single-row reads returns `true` by
construction**. The listing path filters correctly, so the admin UI and the list
endpoint both *show* the security working, while `GET/PUT/DELETE
/api/data/<slug>/<id>` do not enforce it. That is the worst available shape: not
an honest absence a developer can plan around, but a security model they
watch functioning on one endpoint and do not have on the next.

---

## Parity table

Columns: Postgres / Mongo / does the gap surface as a clear error.

| Capability | Postgres | Mongo | Gap surfaces? |
|---|---|---|---|
| **Filter operators** | all of `ALL_WHERE_FILTER_OPS` | all mapped, incl. `like`/`ilike` → anchored regex with `%`-run collapsing | n/a — parity |
| **`or()`/`and()` groups (`logical`)** | honoured | honoured *unauthenticated*; **dropped on the authenticated path** (H1) | **No** — silently *widens* the result |
| **Ordering** | invalid `orderBy` → 400 | sorts by a missing field, returns unsorted | **No** — silent |
| **Pagination** | `limit`/`offset` | `limit`/`offset`/`startAfter` | n/a — parity |
| **Count** | narrowed identically to the listing | narrowed identically (`logical` dropped in the same place as H1) | No |
| **Relations / joins / `?include=`** | `restFetchService`, eager loading | none; `supportsRelations: false`; falls back to `fetchRawCollection` | Partly — `getCollectionByPath` throws on a relation path for a non-relational engine; `?include=` is just ignored |
| **`?fields=` projection** | yes | yes (applied above the driver by `projectResponseFields`) | n/a — parity |
| **Vector search** | yes | `vectorSearch` forwarded into the driver and **silently ignored** (M2) | **No** |
| **Transactions** | per-request tx (also where `SET LOCAL ROLE` binds RLS) | none; no `withTransaction`, `saveMany`, `updateMany`, `deleteMany` | Yes for bulk (`BULK_UNSUPPORTED`); **No** for the missing atomicity in `save` (H4) |
| **RLS / row security — list & count** | database-enforced | app-level filter from `securityRules`, **fail-open on unparsed SQL** (C2) | **No** |
| **RLS / row security — fetchOne, save, delete** | database-enforced | **no-op** — `checkOperation` returns `true` for `supportsRLS: false` engines (C1) | **No** |
| **RLS / row security — realtime** | database-enforced | **none** on the driver `.listen()` path (C3); none on single-doc push (C4) | **No** |
| **Realtime / CDC** | LISTEN/NOTIFY + triggers | change streams (requires a replica set); capability table declares `supportsRealtime: false` (M3) | Partly — standalone Mongo logs "falling back to polling" and does not poll (M8) |
| **History** | full service + revert | `MongoHistoryService` with retention; served only when Mongo is the *default* engine (per `docs/data-sources.md`) | Documented, not enforced at runtime |
| **Search** | tsvector, `?searchExplain=` | regex over declared `type: "string"` properties; `$text` fallback needs a text index or throws | Partly — `IndexNotFound` is loud but unexplained; `searchExplain` ignored |
| **Backups** | `pg_dump`/`pg_restore` in `server-postgres` | none — admin routes still mount and list an empty destination (M11) | **No** |
| **Migrations / schema** | Drizzle + Atlas + boot DDL + RLS policies | deliberately excluded (`relationalCollections()`); collections are schemaless | Yes — documented and intentional |
| **Auth tables** | migrations + real constraints | `ensureAuthCollectionsExist` creates indexes on **field names nothing writes** (C5) | **No** at boot; a hard `E11000` on the *second* login/role/identity |
| **MFA** | implemented | write methods throw, **read methods answer "no factors"** (M5) | Partly |
| **Storage** | engine-independent | engine-independent | n/a — parity |
| **Studio SQL/aggregate panel** | `EXECUTE_SQL` | `executeAggregate` targets `pipeline[0].$from`, a stage MongoDB does not have (M12) | **No** — returns `[]` |

---

## Findings

### CRITICAL

#### C1. Row authorization for `fetchOne`, `save` and `delete` returns `true` by construction

`packages/common/src/util/permissions.ts:96-99`:

```ts
const securityRules = getDataSourceCapabilities(collection.engine).supportsRLS ? collection.securityRules : undefined;
if (!securityRules || securityRules.length === 0) {
    return true;
}
```

`MONGODB_CAPABILITIES.supportsRLS` is `false`
(`packages/types/src/types/data_source.ts:227`). So for any collection carrying
`engine: "mongodb"`, `checkOperation` discards the collection's rules and
returns `true` before evaluating anything.

Every enforcement site in `AuthenticatedMongoDriver` is that call:

- `fetchOne` — `packages/server-mongo/src/services/MongoDriver.ts:802`
- `save`, pre-write update check — `:830`
- `save`, pre-write insert check — `:837`
- `save`, post-write `withCheck` — `:848`
- `delete` — `:861`

All five pass `{ onUnknown: "deny" }`. That argument is what makes the code
*read* as fail-closed, and it is never reached — the capability gate short-
circuits above it. This is class 18 (a predicate that discriminates nothing)
sitting under a fail-closed-looking call site.

Three things make this worse than a plain absence:

1. **The listing path uses a different mechanism and does enforce.**
   `fetchCollection`/`count` call `buildMongoFilterFromSecurityRules`
   (`MongoDriver.ts:1046`), which reads `collection.securityRules` **directly**,
   with no capability gate. So a collection with `ownerField: "owner_id"` lists
   only your rows — and then hands any row to anyone who asks for it by id.
   Class 2: one predicate, two implementations, disagreeing about whether this
   engine has row security at all.

2. **The behaviour flips on spelling.** `checkOperation` reads the *unresolved*
   `collection.engine`, not `resolveDataSource(...).engine`. So:
   - `{ slug, engine: "mongodb" }` — the shape `MongoDBCollectionConfig`'s own
     docblock demonstrates (`packages/types/src/types/collections.ts:400-404`)
     and `docs/data-sources.md:170` instructs — **disables** write authorization.
   - `{ slug, driver: "mongodb" }` (`docs/data-sources.md:89`) leaves
     `collection.engine` undefined → `getDataSourceCapabilities(undefined)`
     returns `POSTGRES_CAPABILITIES` (`data_source.ts:300`) → rules **are**
     evaluated.
   - `{ slug, dataSource: "analytics" }` with the engine on the registry
     definition — same as above, rules evaluated.

   Configuring the collection more correctly is what removes the enforcement.

3. **The boot warning describes the intended design, not this.**
   `packages/server/src/init.ts:777-783` warns that a non-RLS engine enforces
   "only at the application layer". A developer reads that, writes application-
   layer `securityRules`, and gets them applied to lists and discarded for
   objects.

#### C2. An unparsed rule expression fails **open**

`getMongoFilterForSQL` (`MongoDriver.ts:923-1020`) recognises exactly four
shapes: a `string_to_array(auth.roles(), ',') && ARRAY[…]` intersect, the `@>`
containment variant, `<col> = auth.uid()` / `current_setting('app.user_id')`
anchored at the start of the string, and `<col> = 'literal'`. Everything else
falls through to:

```ts
return {};                      // MongoDriver.ts:1019
```

An empty filter is "match every document". `buildMongoFilterFromSecurityRules`
then treats an always-true permissive rule as a reason to apply **no** narrowing
at all (`:1100-1107`), so the whole listing is returned.

So `using: "tenant_id = current_setting('app.tenant')"`, anything with `NOT`,
`IN`, `EXISTS`, a subquery, a function call, `auth.jwt()`, or a column
comparison — every one of them silently becomes "allow all rows" rather than an
error or a refusal. Compare `checkOperation`'s design, which has an explicit
`"unknown"` tri-state and an `onUnknown` policy precisely so an undecidable rule
can be made to deny. The Mongo translator has no such state.

Related, smaller: `getMongoFilterForRule` (`:1031-1039`) applies `rule.withCheck`
as a **read** filter. `withCheck` constrains writes; ANDing it into a `select`
narrows reads by a predicate that was never meant to gate them.

#### C3. Realtime subscriptions taken through the driver carry no row security, and the field that was supposed to give them some is never read

`AuthenticatedMongoDriver.listenCollection` (`MongoDriver.ts:785-796`) and
`listenOne` (`:810-821`) delegate to the unauthenticated driver, then reach into
the subscription map and stamp the last entry:

```ts
lastSub.authContext = authContext;      // MongoDriver.ts:793, :818
```

That writes `Subscription.authContext`. **Every read path reads
`config.authContext` instead** — `MongoRealtimeService.ts:143` and `:267` in the
fetch functions, and `:324` passes `subscription.config` to the re-fetch.
`Subscription.authContext` is assigned at `:93`, `:121`, `:215`, `:245`, `:793`
and `:818`, and read nowhere. Class 20: a value computed and discarded, in the
one place that decides who sees what.

With `config.authContext` undefined, `fetchAndNotifyCollection` takes the `else`
branch and calls `this.dataService.fetchCollection(...)` directly — the raw
repository, below the driver, with no rules and no filter. Class 29 exactly: the
authenticated branch honours the contract, the fallback stubs it out, and the
fallback is the one that grants *more*.

Two independent things also make the stamp too late even if it were read: the
initial fetch is fired from inside `subscribeToCollection` (`:99`) before
`listenCollection` returns, and `MongoCollectionRegistry` never resolves the
collection anyway (H3), so `securityRules` are `undefined` on that path
regardless.

The WebSocket route is better — `websocket.ts:291-297` builds a real
`authContext` and `handleClientMessage` puts it *into the config* (`:403`,
`:425`) — but it still lands on a collection the registry cannot find (H3), so
`buildMongoFilterFromSecurityRules(undefined, …)` returns `{}` and no rules
apply there either.

#### C4. `notifyUpdate` pushes the raw row to single-document subscribers with no authorization

`MongoRealtimeService.ts:312-327`. The collection branch re-fetches through
`fetchAndNotifyCollection`, which at least *attempts* the authorized path. The
single branch does not:

```ts
if (config.path === path && config.id.toString() === id) {
    if (subscription.callback) {
        subscription.callback(row);      // :317 — the row as saved, verbatim
    }
}
```

`notifyUpdate` is called after every `save` (`MongoDriver.ts:480`) and every
`delete` (`:624`). So any write to a document broadcasts it to every subscriber
watching that id, whoever they are.

#### C5. The auth indexes are created on field names the auth services never write

`packages/server-mongo/src/auth/ensure-collections.ts:49-74` creates indexes in
**snake_case**; `auth/services.ts` writes **camelCase**:

| Index (`ensure-collections.ts`) | Fields actually written (`services.ts`) |
|---|---|
| `{ provider: 1, provider_id: 1 }` unique, `:53` | `provider`, `providerId` (`:120-126`) |
| `{ user_id: 1, role_id: 1 }` unique, `:59` | `uid`, `roleId` (`:251-255`, `:264`) |
| `{ token_hash: 1 }` unique, `:65` | `tokenHash` (`:373-386`) |
| `{ user_id, user_agent, ip_address }` unique, `:66` | `uid`, `userAgent`, `ipAddress` |
| `{ token_hash: 1 }` unique, `:73` | `tokenHash` (`:456-462`) |
| `{ email: 1 }` unique, `:49` | `email` — **the only correct one** |

MongoDB indexes a missing field as `null`. A unique index whose every key
component is always missing therefore admits **exactly one document in the whole
collection**. Consequences:

- `rebase_refresh_tokens`: the **second login on the entire deployment** raises
  `E11000` and fails. Two unique indexes cause it independently.
- `rebase_user_roles`: the second role assignment anywhere fails — including
  `assignDefaultRole` on the second registration.
- `rebase_user_identities`: the second OAuth identity for a given provider fails.
- `rebase_password_reset_tokens`: the second outstanding reset token fails.

The `{user_id, user_agent, ip_address}` index is also the *reverted* Postgres
constraint. `createToken`'s comment (`services.ts:368-371`) explains that
evicting by `(uid, userAgent, ipAddress)` used to sign a second browser out and
that the `deleteMany` was removed for it — but the unique index expressing the
same rule was left behind in the Mongo bootstrap.

**Why nothing caught it.** `test/MongoAuthServices.test.ts` never calls
`ensureAuthCollectionsExist`; it drops every collection in `beforeEach` (`:28-33`)
and drives the services directly. So no index exists during the tests. Class 3,
tests that bypass the wiring. The suite is one line from proving it: `:171-172`
creates two password-reset tokens back to back, which is the exact insert the
real index rejects.

Compounding, `ensureAuthCollectionsExist` catches, logs and continues
(`:80-82`) — class 4 — so nothing about the boot would look wrong even if index
creation itself failed.

---

### HIGH

#### H1. `logical` is dropped on the authenticated path — the widening kind of drop

`AuthenticatedMongoDriver.fetchCollection` (`MongoDriver.ts:725-740`) rebuilds
the query by hand from three fields and passes the result as `rawQuery`:

```ts
const userQuery = MongoConditionBuilder.buildQuery({
    filter: props.filter,
    searchString: props.searchString,
    properties: resolvedCollection?.properties
});                                             // no `logical`
…
const rows = await originalService.fetchCollection<M>(props.path, {
    ...props,                                   // carries `logical` …
    rawQuery: combinedQuery,                    // … and this wins
```

`MongoDataService.fetchCollection:212` is `options.rawQuery ?? buildQuery(...)`,
so the spread `logical` is never consulted. `count` has the identical shape at
`:889-903`.

This is the last hop of a chain that was fixed everywhere else. `MongoDriver`'s
own `fetchCollection` forwards the props object whole and carries a comment
saying why (`:115-120`); `MongoDataService` has the parameter and its own comment
(`:196`); `api-generator.ts:1037-1041` forwards it on the non-`restFetchService`
fallback with a comment naming mongo. Every authenticated request — which is
every real request — then loses it in the wrapper. Class 17's second axis: the
feature was applied at most of its call sites.

A dropped `logical` does not fail, it **widens**: `?or=(status.eq.draft,status.eq.review)`
returns everything the (frequently empty, see C1/C2) rule filter allows.

`test/query-narrowing.test.ts` covers `MongoConditionBuilder` only, so it cannot
see this.

#### H2. `initializeWebsockets` drops the AuthAdapter — class 11, recurring

| Declaration | Arity |
|---|---|
| `packages/types/src/types/backend.ts:836` | 5 — `(server, realtimeService, driver, config?, authAdapter?)` |
| `packages/server/src/init.ts:1824` (the call) | 5 — passes `config.auth, authAdapter` |
| `packages/server-postgres/src/PostgresBootstrapper.ts:926` | 5 — forwards all five |
| **`packages/server-mongo/src/MongoBootstrapper.ts:185`** | **4** — `authAdapter` discarded |

JavaScript drops the surplus argument silently and TypeScript has nothing to
object to, because each side is individually consistent — the same boundary and
the same silence that `docs/bug-classes.md` §11 records.

What goes missing: `createMongoWebSocket` verifies tokens only with
`extractUserFromToken` (`websocket.ts:119`), the built-in JWT path. Postgres's
socket prefers `authAdapter.verifyToken` when one is present
(`server-postgres/src/websocket.ts:187-197`). Meanwhile `resolveRequireAuth`
returns `true` for any AuthAdapter (`server/src/auth/require-auth.ts:48`).

So on a Mongo-default backend using an `AuthAdapter` — Clerk, Auth0, the
documented way to unify identity (`docs/data-sources.md:135-139`) — **every
realtime `AUTHENTICATE` fails and every realtime message is refused**, and the
only signal the client gets is `"Invalid or expired token"`. Mongo's boot warning
(`websocket.ts:75-80`) checks only `jwtSecret`, so it fires with a message about
a missing secret rather than about the adapter it was never handed; Postgres's
equivalent names all three cases (`server-postgres/src/websocket.ts:128`).

#### H3. `MongoCollectionRegistry` registers by display name and looks up by path

`packages/server-mongo/src/factory.ts:65-74`:

```ts
register(collection: CollectionConfig): void {
    this.collections.set(collection.name, collection);       // :66  — display name
}
getCollectionByPath(path: string): CollectionConfig | undefined {
    return this.collections.get(path);                        // :73  — slug / data path
}
```

`slug` is the routing key and `name` is the human label — the type's own Mongo
example is `slug: "mongo_customer"`, `name: "Customers (MongoDB)"`
(`packages/types/src/types/collections.ts:400-403`). Every lookup therefore
misses. It misses on a second count too when `path` is set, since the REST layer
addresses the driver with `getCollectionDataPath(collection)`, which returns
`collection.path` for a Mongo collection (`collections.ts:522-524`) — neither
`name` nor `slug`.

`MongoBootstrapper.initializeDriver:54-56` fills this registry with every
collection, so it is the registry the driver actually runs with. The registry is
the only source of the collection on the realtime path
(`MongoRealtimeService.ts:141`, `:265`), which means every realtime read runs
with `collection: undefined` — no `securityRules`, no `properties` (so search
falls to `$text` and throws without a text index), no lifecycle callbacks.

The HTTP path survives because the route passes the collection explicitly and
`resolveCollectionCallbacks` falls back to it (`MongoDriver.ts:88-93`) — which is
also why nothing has surfaced this.

#### H4. The post-write check throws 403 after the write has landed and been broadcast

`MongoDriver.ts:842-850`:

```ts
const saved = await this.delegate.save({ ...props, collection: resolvedCollection });
// After save / withCheck rules verification
if (!checkOperation(…, props.status === "existing" ? "update" : "insert", { onUnknown: "deny" })) {
    throw ApiError.forbidden("Forbidden");
}
```

By the time this runs, `delegate.save` has written the document, recorded
history, and called `notifyUpdate` to push it to subscribers
(`MongoDriver.ts:466-484`). There is no transaction, so nothing is rolled back:
the caller gets a 403 and the mutation stands. In Postgres the same rule is a
`WITH CHECK` clause evaluated by the database inside the transaction.

(Currently vacuous because of C1 — which means fixing C1 turns this from
"nothing happens" into "403 with the write committed".)

#### H5. `save` returns the input values, not the stored document

`MongoDataService.save:312-337` returns `{ ...values, id }` in both branches
rather than reading the document back. For a partial update, everything
downstream sees only the changed fields:

- the REST response is a partial row where Postgres returns the full one;
- `afterSave` receives partial `values`;
- the history entry's `values` is partial, so a revert restores a partial row;
- `notifyUpdate` broadcasts a partial row to single-doc subscribers;
- the `withCheck` re-evaluation in H4 evaluates rules against a row missing the
  fields those rules reference.

Same method, second issue: `updateOne(..., { upsert: true })` (`:315-319`) means
addressing an id that does not exist **creates** it rather than 404-ing.

---

### MEDIUM

- **M1. The realtime hop re-lists the request fields and drops two.**
  `MongoRealtimeService.handleClientMessage:394-402` forwards `path`, `filter`,
  `orderBy`, `order`, `limit`, `startAfter`, `searchString` — no `logical`, no
  `offset`. Class 17 on the same object as H1.
- **M2. `vectorSearch` is silently ignored.** `api-generator.ts:1046` forwards it;
  `MongoDriver.fetchCollection` spreads it into `MongoDataService`, which has no
  parameter for it. `MONGODB_CAPABILITIES.supportsVectors` is `false`, so the
  honest outcome is a 400 — instead a vector query returns unranked rows that
  look like an answer.
- **M3. The capability table says Mongo has no realtime.**
  `MONGODB_CAPABILITIES.supportsRealtime: false`
  (`packages/types/src/types/data_source.ts:252`) while the package ships a
  complete `RealtimeProvider` with change streams and the WS wiring. One of the
  two is wrong, and consumers branching on the flag will hide a feature that
  works (or the reverse).
- **M4. Any write re-fetches and re-broadcasts the whole subscribed listing.**
  `MongoRealtimeService.ts:102-106` — one change to one document re-runs the full
  query for every collection subscription on that path and re-sends every row.
  Cost is O(writes × subscribers × limit).
- **M5. MFA read stubs answer "no", write stubs throw.** `auth/services.ts:776-814`:
  `createMfaFactor`/`verifyMfaFactor`/… throw `"MFA is not implemented for
  MongoDB"`, but `getMfaFactors` returns `[]`, `hasVerifiedMfaFactors` returns
  `false`, `getUnusedRecoveryCodeCount` returns `0` and `deleteAllRecoveryCodes`
  is a no-op. Enrollment fails loudly; anything that *gates* on MFA is told
  "this user has none". Nothing declares the gap at boot — a developer discovers
  it as a 500 on the enrollment button.
- **M6. Both `ensure*` bootstraps catch, log and continue.**
  `auth/ensure-collections.ts:80-82`, `history/ensure-history-collection.ts:17-21`.
  Class 4: "it booted" proves nothing about the indexes.
- **M7. No index on the field every user lookup uses.** `_id` is set to the same
  string as `id` (`services.ts:70-71`) but every query is `findOne({ id })`,
  `find({ uid })`, `find({ roleId })` — none of which are indexed. That is a
  collection scan on the auth hot path of every authenticated request.
- **M8. "Falling back to polling" describes a mechanism that does not exist.**
  `MongoRealtimeService.ts:112-128` and `:238-252` catch a failed
  `collection.watch()`, log `"Change streams not available, falling back to
  polling"`, store the subscription without a change stream, fetch once — and
  never poll. On a standalone `mongod` (no replica set), which is the default
  local install, subscriptions deliver one payload and then go quiet. Class 5 +
  class 29. *(UNCONFIRMED which way it actually fails: `watch()` on a standalone
  usually surfaces the error on the stream's `error` event rather than by
  throwing synchronously, in which case the `catch` never runs and the handler at
  `:108-110` merely logs — the subscription is dead either way.)*
- **M9. `orderBy` is unvalidated.** `MongoConditionBuilder.buildSort:285-291`
  builds `{ [orderBy]: ±1 }` for any string. A typo sorts by a field no document
  has and returns arbitrarily ordered rows. Postgres now answers 400 for this.
- **M10. `withCheck` is ANDed into read filters.** `MongoDriver.ts:1036-1039`.
- **M11. Backups are mounted and can never contain anything.**
  `init.ts:1721-1738` mounts `/admin/backups` unconditionally; the `pg_dump`
  machinery lives in `server-postgres` (`server/src/backup/index.ts:3`). On Mongo
  the panel reports `configured: false` or lists an empty bucket forever, with
  nothing saying this engine has no backup implementation.
- **M12. The Studio aggregate panel always targets a non-existent collection.**
  `MongoBootstrapper.ts:141-144` (and the identical copy in `factory.ts:154-156`)
  reads the target from `pipeline[0].$from`. MongoDB has no `$from` aggregation
  stage and nothing in this repo emits one, so `collName` is always
  `"__admin__"` and `executeAggregate` returns `[]` — a successful-looking empty
  result for every query. Class 14: a field with no reader that can disagree.

---

### LOW / DX

- `src/index.ts` does not export `./services/MongoHistoryService` or
  `./auth/services`, yet `MongoBackendConfig.historyRetention` is typed with
  `HistoryRetentionConfig` from the unexported module — a consumer cannot name
  the type of a field on an exported config interface.
- `isAdminSession` (`websocket.ts:43-46`) tests `roles.includes("admin")` — a
  role *name* — where Postgres uses the adapter's `isAdmin` flag. A role named
  `admin` with `isAdmin: false` passes the Mongo gate.
- Mongo's socket has no service-key path; Postgres's does (`safeCompare` on
  `serviceKey`), so the platform identity cannot use the Mongo socket.
- `MongoRoleService.createRole:310-321` returns the raw document including `_id`,
  so `RoleData` carries a field its type does not declare.
- `MongoDataService.documentToRow:44-51` calls `_id.toString()` unguarded; a
  document without `_id` throws rather than being skipped.
- `cachedAdmin` in `MongoBootstrapper` is populated as a side effect of
  `getAdmin()` and read by `initializeWebsockets()`. It works only because
  `init.ts` happens to call them in that order (`:1567` before `:1823`) — an
  undeclared ordering dependency between two interface methods.

---

## Checked and clean

- **Bulk operations refuse rather than degrade.** `saveMany`/`updateMany`/
  `deleteMany` are absent, and `api-generator.ts:384-387`, `:436`, `:501-504`
  answer `BULK_UNSUPPORTED` instead of looping single writes. This is the
  reference shape for how the rest of the parity gaps should read.
- **`?fields=` works.** Projection is applied above the driver by
  `projectResponseFields`, so it is engine-independent.
- **LIKE-pattern ReDoS is closed.** `likePatternToRegExp`
  (`MongoConditionBuilder.ts:36-56`) collapses runs of `%` to a single `.*`, so
  adjacent unbounded quantifiers cannot be constructed from a query string, and
  `escapeRegExp` covers the metacharacter set. `test/like-pattern-redos.test.ts`
  pins it. Search terms are escaped the same way (`:178-179`).
- **The `dataType` → `type` fix is real.** `buildSearchConditions:192` reads
  `prop?.type`, the parameter is typed `CollectionConfig["properties"]` rather
  than `Record<string, any>`, and the docblock records why. The `$text` fallback
  is now genuinely unreachable for a collection with any string property.
- **`logical` and `offset` are honoured on the unauthenticated driver path.**
  `MongoDriver.fetchCollection:120` forwards the props object whole;
  `MongoDataService:237-241` handles `offset` with `startAfter` taking
  precedence. Only the authenticated wrapper regressed (H1).
- **`count` is narrowed by the same predicate as the listing** on both paths —
  `filter`, `logical` and `searchString` all reach `MongoDataService.count:290-295`.
- **EntityReference round-trips unambiguously.** The `__type: "reference"`
  sentinel plus a tightly-scoped legacy shape (`MongoDataService.ts:94-106`)
  avoids rewriting ordinary embedded objects, and the tests assert the negative
  case (`MongoDataService.test.ts:202`).
- **Empty logical groups are handled correctly.** `$or: []` is a Mongo error and
  `$and: []` matches everything; `buildLogicalConditions` returns `undefined` for
  both rather than picking one (`MongoConditionBuilder.ts:135-157`).
- **Multi-engine realtime routing is sound.** `createRoutedRealtimeService`
  fans `addClient` out to every provider and routes `subscribe_collection` /
  `subscribe_one` by collection path; the message-type names agree across the
  client, the Postgres socket and `MongoRealtimeService.handleClientMessage`.
- **`resolveRequireAuth` is shared and correct.** Mongo's socket uses the same
  function as the HTTP routes (`websocket.ts:73`) and returns `true` for an
  AuthAdapter, so the class-10 "`false` grants instead of skipping" inversion is
  not present here.
- **Session storage is per-factory, not module-level** (`websocket.ts:58`), so
  sessions do not leak across hot reloads.
- **Password normalization is shared.** `normalizeEmail` from `@rebasepro/common`
  is applied on create, update and lookup (`auth/services.ts:72`, `:140`, `:90`).
- **Refresh-token semantics match the corrected Postgres design**: no
  `deleteMany` on create, tokens accumulate under a shared `sessionId`,
  `markRotated` supersedes rather than deletes, `prune` is time-bounded. Only
  the leftover unique index contradicts it (C5).
- **History retention** enforces both `maxEntries` and `ttlDays`, prunes off the
  write path, and `MongoHistoryDocument` is deliberately named apart from the
  wire type with a docblock explaining the earlier name collision.
- **The npm packaging is correct**: `files: ["dist", "src"]`, a `prepack` guard
  against publishing `workspace:` ranges, and published stable at `0.13.0`.

---

## Open questions

1. **Which side of C1 is the intended design?** Either `MONGODB_CAPABILITIES.supportsRLS`
   means "the *database* enforces this" — in which case `checkOperation` must not
   use it to decide whether to evaluate rules at all — or it means "row security
   is unavailable", in which case `buildMongoFilterFromSecurityRules` should not
   exist. Both cannot be right, and today the two answers are split across read
   paths of the same collection.
2. **Should `securityRules` on a Mongo collection be accepted at all?** If the
   translator can only express four predicates and everything else fails open
   (C2), the honest options are (a) refuse at boot any rule the translator cannot
   compile, or (b) accept only the structured fields (`ownerField`, `roles`,
   `access`) and reject `using`/`withCheck` raw SQL for non-Postgres engines.
   Silently accepting a rule and applying nothing is the one option that should
   be off the table.
3. **Is Mongo realtime supported or not?** `supportsRealtime: false` in the
   capability table (M3) versus a complete implementation, a WS integration, and
   a routing composite that names MongoDB change streams in
   `docs/data-sources.md:102-103`.
4. **Does anyone run this against a real replica set?** The whole realtime
   surface requires one, and the fallback for a standalone `mongod` is a log line
   for a mechanism that was never written (M8). No test in the package exercises
   change streams — `mongodb-memory-server` is used in single-node mode.
5. **Is `path` (the Mongo collection-name override) exercised anywhere?** It is
   honoured by `getCollectionDataPath` and is a third distinct name for the same
   collection alongside `slug` and `name`, which is what makes H3 miss twice.
6. **Should `docs/data-sources.md` keep recommending `engine:` on Mongo
   collections** while that is the declaration that switches off write
   authorization (C1.2)?
