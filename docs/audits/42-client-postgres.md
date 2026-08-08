# Audit 42 — `packages/client-postgres`

*Read-only audit, 2026-08-08. Scope: `packages/client-postgres`, plus the paths it
rides (`packages/common/src/data/buildRebaseData.ts`, `packages/app/src/core/Rebase.tsx`,
the WS ingress in `packages/server-postgres/src/websocket.ts`) wherever they define
the contract this package is supposed to honour.*

## Verdict

`@rebasepro/client-postgres` is a **published, typechecked, tested, and entirely
unused** package: 156 lines of source in one file, a hook that wraps
`RebaseWebSocketClient` in a `DataDriver` shape. Nothing in the monorepo imports it
— not the admin, not `app`, not `examples/`, not the e2e suite, not the website,
not the templates. The only non-self references are a vite alias in
`cloud-fleet-safety/frontend/vite.config.ts:130` that no file resolves, and one
`README` table row. It is nevertheless published to npm at `0.13.0` (latest) and
re-shipped every release by `scripts/release.sh:279`. It is also **architecturally
contradicted by its own docs**: `docs/data-sources.md:20` states "Server sources
need no frontend driver" and `:50` says "Postgres/Mongo ride the `client`" — which
is exactly what the admin does (`Rebase.tsx:182`, `wrapAsEntityData(client.data)`).
The name in the audit map ("direct/PostgREST path") is wrong twice over: it is not
direct (it goes through the Rebase backend) and it is not PostgREST (it is the
WebSocket protocol).

Because it is dead, none of its bugs have ever fired. That does not make them
theoretical: the package is on npm under a first-party scope with a README telling
people to use it, and the first person who does hits a silent pagination
corruption on page two. Its `fetchCollection` is the one surviving instance of the
exact class-2 defect that the file's *own comments* (lines 84–94) boast of having
fixed on its two siblings — `count` and `listenCollection` were converted to
whole-object forwarding and `fetchCollection` was left re-listing seven field names
by hand, dropping `offset` and `logical`. Its `count` sibling now keeps them. So
the rows and the total that are reported beside each other describe different
queries, which is `docs/bug-classes.md:1358` verbatim.

The honest recommendation is **delete the package and deprecate it on npm**, or
— if a WS-transport driver is genuinely wanted — fix F1, wire it into `<Rebase>`
in an example, and give it a docs page. Keeping it published, undocumented,
unused, and subtly wrong is the worst of the three options.

---

## Findings

### HIGH

#### F1 — `fetchCollection` drops `offset` and `logical`; its own `count` keeps them

`packages/client-postgres/src/usePostgresClientDriver.ts:45-55`

```ts
const { path, filter, limit, startAfter, orderBy, searchString, order } = props;
return client.fetchCollection({ path, filter, limit, startAfter, orderBy, searchString, order });
```

`FetchCollectionProps` (`packages/types/src/controllers/data_driver.ts:103-125`)
carries twelve fields. This hand-written list names seven. Dropped: **`offset`**,
**`logical`**, `searchExplain`, `vectorSearch`, `collection`. The server honours
all of them — the WS handler passes the payload straight through
(`packages/server-postgres/src/websocket.ts:313-315` →
`PostgresBackendDriver.ts:1645` → `services/dataService.ts:59-76`, whose options
type lists `logical`, `offset` and `vectorSearch` explicitly).

Meanwhile `count` on the very next method (`:83-88`) forwards `props` **whole**,
with a comment explaining why. So the two disagree.

`buildRebaseData.find()` is the only consumer shape that matters here: it calls
`driver.fetchCollection({ path, limit, offset: driverOffset, filter, logical, … })`
(`packages/common/src/data/buildRebaseData.ts:200-209`) and then
`driver.count({ path, filter, logical, searchString })`
(`:219-224`), deriving `hasMore = offset + rows.length < total` (`:225`).

**Failure scenario.** A collection of 500 products, `data.products.find({ offset: 50, limit: 25 })`:

- the driver sends no `offset`, so the server returns rows **1–25**, not 51–75;
- `count` correctly returns 500, so `hasMore` is `true` and the caller happily asks
  for offset 75 — and gets rows 1–25 again.

`iterate()` / `findAll()` make this catastrophic. `paginate.ts:223` sets
`pageParams.offset = offset` on every page and `:270` advances it by
`rows.length`; `hasMore` is driven by the (correct) count, so the walk terminates
normally after `ceil(500/200)` pages — having yielded **page one, three times**,
with no error, no warning, and a plausible-looking row count. `findAll()` returns
duplicates up to `DEFAULT_FIND_ALL_MAX_ROWS`.

Independently, an `or(...)` group is dropped: `find({ logical: or(...) })` returns
every row policy allows while `count` returns the narrowed total — the same
divergence in the other direction.

**Fix direction.** Forward the props object whole, exactly as `count` (`:87`) and
`listenCollection` (`:95-96`) already do. There is nothing on
`FetchCollectionProps` the WS payload should not carry; `client.fetchCollection`
(`packages/client/src/websocket.ts:1083-1089`) already takes `FetchCollectionProps`
and puts it in `payload` verbatim. The whole method collapses to
`return client.fetchCollection(props);`.

---

### MEDIUM

#### F2 — the WS one-shot `FETCH_COLLECTION` ingress applies no list-limit bound

`packages/server-postgres/src/websocket.ts:311-325`

`packages/types/src/controllers/data_driver.ts:44-61` names
`resolveClientListLimit` "the single shared enforcement point so every untrusted
ingress behaves identically", and calls out an absent limit as "a trivial
OOM/DoS". Two of the three ingresses honour it — REST at
`packages/server/src/api/rest/query-parser.ts:217` and `:351`, and the realtime
subscribe path at `packages/server-postgres/src/services/realtimeService.ts:447`.
The third, `FETCH_COLLECTION` (and `COUNT`), does not: `const request:
FetchCollectionProps = payload; const rows = await
delegate.fetchCollection(request);`. No clamp, no default.

`usePostgresClientDriver.fetchCollection` is the client-side entry to precisely
that unbounded path — which is why it belongs in this audit even though the fix
lands in `server-postgres`.

**Failure scenario.** Any authenticated WS client sends
`{type:"FETCH_COLLECTION", payload:{path:"events"}}` with no `limit`. The adapter
streams the entire table into the server process and then into a JSON frame.
`limit: 100000000` is honoured verbatim. The rate limiter
(`websocket.ts:46`, 2000 msg/min) does not help: one message suffices.

**Fix direction.** Apply `resolveClientListLimit(payload.limit)` in the
`FETCH_COLLECTION` case before handing the request to the delegate, same as
`realtimeService.ts:447`. Class 2 — three ingresses, one predicate, two
implementations of it.

#### F3 — every WS handler error collapses to `INTERNAL_ERROR`, so `e.code` is useless on this transport

`packages/server-postgres/src/websocket.ts:646-668`

The single `catch` around the message dispatch answers every failure with
`code: "INTERNAL_ERROR"` and, under `NODE_ENV=production`, the message
`"An unexpected error occurred"`. The WS client faithfully turns that into
`new RebaseApiError(errorMessage, { code: errorCode })`
(`packages/client/src/websocket.ts:641`).

`packages/types/src/errors.ts:15-22` documents the contract with an example that
switches on `e.code`:

```ts
switch (e.code) {
  case "NOT_FOUND": return null;
  case "FORBIDDEN": return redirect();
```

On the REST path those codes arrive. On the client-postgres path they never can:
a missing row, an RLS denial, a unique-constraint violation and a schema drift are
one indistinguishable `INTERNAL_ERROR`, and `status` is `undefined` by design
(`errors.ts:46-51`). Only the *pre-dispatch* gates emit real codes
(`UNAUTHORIZED` `:245`, `RATE_LIMITED` `:261`, `FORBIDDEN` `:271`) — everything
downstream of the switch does not.

**Failure scenario.** A developer ports error handling from the HTTP client to a
client-postgres-backed app. `catch (e) { if (e.code === "NOT_FOUND") return null; }`
never matches, so a routine 404 propagates as an unhandled error to the UI.

**Fix direction.** Map the caught error through the same `ApiError`/code table the
REST layer uses before building the ERROR frame, rather than stamping every
failure `INTERNAL_ERROR`. Class 29 — the second transport stubs out the error
contract the primary honours.

#### F4 — `include`, `vectorSearch` and `searchExplain` are silently unavailable on any DataDriver path

`packages/common/src/data/buildRebaseData.ts:182-209`

The primary path (`client.data`, HTTP) serializes all three:
`packages/client/src/transport.ts:193` (`searchExplain`), `:199-205`
(`vector_search`/`vector`/`vector_distance`/`vector_threshold`), `:207-209`
(`include`). The `buildRebaseData` `find()` used for every registered `DataDriver`
passes `include` **only** to the `restFetchService` branch (`:198`), and never
reads `params.vectorSearch` or `params.searchExplain` in either branch — even
though `QueryBuilder.vectorSearch()` (`:505-511`) and `.search(s, {explain})`
(`:504`) set them, and `listen` (`:336`) does forward `searchExplain`.

`POSTGRES_CAPABILITIES` (`packages/types/src/types/data_source.ts:202-219`)
advertises `supportsVectors: true` for this engine key, which the client-postgres
driver claims (`usePostgresClientDriver.ts:39`).

**Failure scenario.** `data.products.vectorSearch("embedding", vec).limit(10).find()`
against a client-postgres source returns the first ten rows in table order — no
distance ordering, no threshold, no error. The results look like a plausible
answer and are not one.

**Fix direction.** Have `buildRebaseData.find()` forward `vectorSearch` and
`searchExplain` to `driver.fetchCollection` (both are on `FetchCollectionProps`
already) and throw — not silently ignore — when `include` is requested of a driver
with no `restFetchService`. Then fix F1 so the client-postgres driver actually
relays them.

#### F5 — `isBranchAdmin` narrows to an interface the driver does not satisfy

`packages/client-postgres/src/usePostgresClientDriver.ts:142-150`,
`packages/types/src/types/backend.ts:523-535` and `:582-584`

`BranchAdmin` declares four **required** methods, including
`getBranchInfo(name): Promise<BranchInfo | undefined>` (`backend.ts:534`). The
guard narrows on `createBranch` alone (`:583`). `DatabaseAdmin` is
`Partial<…> & …` (`:546`), so an object literal missing `getBranchInfo` is
assignable and TypeScript never complains.

The driver's `admin` supplies `createBranch`/`deleteBranch`/`listBranches` and no
`getBranchInfo`. `RebaseWebSocketClient` has no `getBranchInfo` either. Neither
does the duplicate derivation in `Rebase.tsx:323-327`. Only the *backend* driver
implements it (`packages/server-postgres/src/PostgresBackendDriver.ts:127`).

**Failure scenario.** `if (isBranchAdmin(admin)) admin.getBranchInfo(name)` —
which is precisely the usage `backend.ts:541-542` instructs — typechecks and
throws `admin.getBranchInfo is not a function` at runtime. The package's own test
(`test/usePostgresClientDriver.test.tsx:99`) performs this exact narrowing and only
avoids the crash because it does not call the fourth method.

**Fix direction.** Either make `getBranchInfo` optional on `BranchAdmin`, or widen
the guard to check all four, or add the missing method to the WS client and both
frontend derivations. Class 2 — a predicate ("is this a branch admin?") with a
narrower implementation than the type it certifies.

#### F6 — the documented Quick Start produces an anonymous-only driver

`packages/client-postgres/README.md` (Quick Start),
`packages/client-postgres/src/usePostgresClientDriver.ts:15-17`

```tsx
const wsClient = new RebaseWebSocketClient({ url: "ws://localhost:4100" });
const driver = usePostgresClientDriver({ wsClient });
```

`RebaseWebSocketClient` authenticates only when it is given a `getAuthToken`
(`packages/client/src/websocket.ts:229`, `:342-343`) — which
`createRebaseClient()` wires for its own instance (`index.ts:375`) but which
nothing wires here. `PostgresDataDriverConfig` has exactly one field, `wsClient?`,
and the hook never calls `setAuthTokenGetter`.

The server does not leak: `getScopedDelegate` (`websocket.ts:280-307`) binds
`ANONYMOUS_USER_ID` with `roles: ["anon"]` and RLS applies. But the failure is
silent in the wrong direction — the driver **works**, returning whatever the anon
policies permit, so a developer sees an empty (or partial) collection and hunts
for a data bug rather than an auth one. If `requireAuth` is on (`:242-248`) every
call fails with an equally opaque `UNAUTHORIZED`.

**Fix direction.** Either accept a `getAuthToken` on `PostgresDataDriverConfig` and
call `wsClient.setAuthTokenGetter` in the hook, or drop the standalone recipe from
the README and document the driver as requiring a socket obtained from
`createRebaseClient()`.

---

### LOW

#### F7 — the README documents method names that do not exist

`packages/client-postgres/README.md`, "`PostgresDataDriver` Methods" table

The table names `fetchSnapshot`, `saveSnapshot`, `deleteSnapshot`,
`countSnapshots`, `listenSnapshot`, `listenCollection(props)` returning
"snapshots". The actual surface is `fetchOne`, `save`, `delete`, `count`,
`listenOne`, and every method returns **flat rows**, not snapshots — the driver is
typed `Promise<Record<string, unknown>[]>` throughout
(`usePostgresClientDriver.ts:45`, `:57`, `:64`). Rows-canonical has been the
architecture for some time; this README predates it and was never updated. The
admin table also omits `fetchApplicationRoles`, which the code does expose
(`:130-132`).

The Quick Start additionally passes `<Rebase driver={driver} />`. There is no
`driver` prop on `<Rebase>` — the prop is `dataSources`
(`packages/app/src/core/RebaseProps.tsx:191`, consumed at `Rebase.tsx:60`). The
documented example does not compile.

**Fix direction.** Regenerate the table from the source, or delete the README with
the package.

#### F8 — dead `useEffect` import

`packages/client-postgres/src/usePostgresClientDriver.ts:1`

`import { useMemo, useEffect } from "react";` — `useEffect` is never used. eslint
reports it (`'useEffect' is defined but never used`), but `test:lint` runs
`eslint "src/**" --quiet`, which suppresses warnings, so the package's own lint
gate reports success. `scripts/check-unused-locals.mjs` has the two rest-destructure
locals baselined (`scripts/unused-locals-baseline.json:97-98`) but not this one.

#### F9 — `Rebase.tsx` re-derives the same `DatabaseAdmin` from the same socket

`packages/app/src/core/Rebase.tsx:310-328` vs
`packages/client-postgres/src/usePostgresClientDriver.ts:120-151`

Two hand-written adapters turning a `RebaseWebSocketClient` into a
`DatabaseAdmin`, listing the same ten methods. They currently agree; there is no
mechanism keeping them in agreement, and `Rebase.tsx`'s copy is the one that
actually runs. Class 2. If the package survives, `Rebase.tsx` should call a shared
helper (or the hook) rather than duplicate the mapping; if the package is deleted,
this stops being a duplication.

Note that `Rebase.tsx:323`'s capability probe (`typeof wsAdmin.createBranch ===
"function"`) is vacuous — `RebaseWebSocketClient` always defines the method,
whether or not the *server* supports branching — so both implementations advertise
branch admin unconditionally.

#### F10 — narrowed signatures that the `DataDriver` contract does not

`packages/client-postgres/src/usePostgresClientDriver.ts:79`, `:116-118`, `:121`, `:139`

- `checkUniqueField(…, id?: string, …)` — `DataDriver` declares
  `id?: string | number` (`data_driver.ts:334`). A numeric primary key is passed
  through a parameter typed `string`. Runtime is unaffected (it is forwarded
  verbatim); method bivariance hides it from tsc.
- `isFilterCombinationValid(): boolean` — the contract takes props
  (`data_driver.ts:347-349`). Returning an unconditional `true` while ignoring the
  argument is fine for Postgres, but the signature no longer documents that it is a
  deliberate blanket answer.
- `executeSql(sql, options?: { database?; role? })` — `SQLAdmin.executeSql`
  (`backend.ts:432`) also accepts `params?: unknown[]`. The value survives at
  runtime (the object is forwarded by reference through
  `websocket.ts:1115-1122`), so this is a declaration-only gap, but a caller
  reading the driver's type will believe parameterized SQL is unsupported.
- `fetchTableMetadata(): Promise<unknown>` while the client returns
  `Promise<TableMetadata>` (`websocket.ts:1183`) — the driver erases a type its
  own dependency provides. `SchemaAdmin` (`backend.ts:499`) is deliberately
  `unknown`, so this is conformant, but every consumer must now re-cast.

---

## Checked and clean

- **Published state.** `npm view @rebasepro/client-postgres` → `latest 0.13.0`,
  `canary 0.13.1-canary.g501e3cb`. In lockstep with the rest of the monorepo;
  `prepack` guards against `workspace:` protocol leaking; `files: ["dist"]` is
  correct for a package whose CLI does not resolve `src`.
- **Typechecking.** `packages/client-postgres/src` is in
  `tsconfig.typecheck.json`'s `include`, and `packages/client-postgres/test` is in
  `tsconfig.tests.json`'s. Both halves are gated — unusually good for this repo
  (contrast the `Untypechecked test dirs` class).
- **Tests.** `npx jest` in the package: 1 suite, 5 tests, all pass in 0.6s. The
  `listenCollection` test (`test/usePostgresClientDriver.test.tsx:116-156`)
  asserts on the *whole* query object rather than field-by-field — which is the
  right shape of assertion, and is exactly the test F1's `fetchCollection` lacks.
  `pnpm -r test` at the root picks the suite up.
- **Auth / RLS.** No bypass. Every WS message is gated by `requireAuth`
  (`server-postgres/src/websocket.ts:242-248`), rate-limited (`:250-265`),
  admin-gated for the nine `ADMIN_ONLY_TYPES` (`:51-61`, `:268-275`), and every
  data handler goes through `getScopedDelegate()` → `driver.withAuth(user)`
  (`:280-307`), so RLS binds reads and writes exactly as on the REST path. The
  `admin.executeSql` surface the driver exposes is the same one `Rebase.tsx:315`
  exposes and is server-side admin-only.
- **Filter operator dialect.** The driver does not touch `filter`; the canonical
  `[op, value]` tuple normalization happens above it in
  `buildRebaseData.ts:164` (`deserializeFilter`) on the `find` and `count` paths.
  No operator divergence attributable to this package.
- **Relation shape.** No divergence. `FetchService.fetchCollection` returns
  "columns only" (`packages/server-postgres/src/services/FetchService.ts:1033-1034`),
  the same flat rows the REST pipeline serves. The `{ __type: "relation" }`
  envelope is not produced on this path.
- **`listenCollection` / `count`.** Both forward the props object whole
  (`:87`, `:95-96`) and are correct. `listenOne`'s hand-listed
  `{ path, id, databaseId }` drops only `collection`, which
  `buildRebaseData.ts:360-365` never sends.
- **`save` / `delete` field drops.** `save` (`:64-72`) drops `collection` and
  `upsert`; `delete` (`:74-77`) drops `collection`. Harmless in practice:
  `buildRebaseData` never passes `collection` to either (`:245-250`, `:266-272`,
  `:276-281`) and routes `upsert` only through `saveMany` (`:256-260`), which this
  driver does not implement. Left out of the findings deliberately — but they are
  the same hand-written-list pattern as F1 and should be fixed with it.
- **Missing optional driver methods** (`saveMany`, `updateMany`, `deleteMany`,
  `deleteAll`, `initTextSearch`, `restFetchService`, `currentTime`) are absent from
  `RebaseWebSocketClient` too, so the driver cannot supply them.
  `buildRebaseData` correctly gates each behind a presence check
  (`:254`, `:287`, `:298`) rather than looping single writes — the deliberate
  non-fallback documented at `:283-286`. Class 29 avoided.

---

## Open questions

1. **Is this package meant to exist?** `docs/data-sources.md:20,50` says Postgres
   rides the `client` and only `direct`/`custom` sources need a frontend driver.
   `MODULAR-ARCHITECTURE.md:291` calls `client-postgres` "the one that really is an
   adapter over `client`". These two statements are in tension, and no code
   resolves it. If the answer is "no", `scripts/deprecate-old-packages.sh` already
   has the machinery.
2. **Does anything outside this repo import it?** It is published, so the answer is
   not knowable from here. That is the only reason F1 is not simply "delete it".
3. `rebase-agent-skills/skills/rebase-basics/SKILL.md:136` tells agents to reach
   for this package "When connecting directly to PostgreSQL from client". That is
   factually wrong on both counts — the data path is the Rebase backend over
   WebSocket, and no Postgres wire protocol is involved. Should be corrected or
   removed regardless of what happens to the package.
4. `scripts/docs-verify/sdk-exports.mjs:24` registers
   `@rebasepro/client-postgres` as a documented SDK entry point, so
   `usePostgresClientDriver` is in the allowlist of API names docs may mention —
   yet no page in `website/src/content/docs/**` mentions it outside the
   `upgrading` rename tables. UNCONFIRMED whether `verify:docs` would flag a zero-
   coverage entry; it appears only to gate names that *are* mentioned.
5. F2 (unbounded `FETCH_COLLECTION`) is a `server-postgres` defect surfaced from
   here. It should be re-checked under audit 43/whichever unit owns
   `server-postgres/src/websocket.ts`, since the same handler also skips the bound
   on `COUNT`.
