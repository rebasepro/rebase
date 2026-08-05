# API surface audit — 2026-08-05

Every developer-touching surface, read against itself for coherence: the client
SDK, the server SDK, the collection/property authoring API, the REST + OpenAPI
contract, the CLI, and `rebase.json`.

**Method.** Every finding below was reproduced against the code or by running
the real binary, not inferred from naming. Where a claim is about behaviour, the
command or the file:line that proves it is given.

Companion to [`dx-audit-2026-07-25.md`](./dx-audit-2026-07-25.md), which covered
the first-run path. This one covers the APIs you live in afterwards.

---

## Verdict

The surface is in better shape than most projects this size, and in three places
it is genuinely exceptional: the client barrel is an explicitly curated export
list with a written rule for adding to it; the `admin` block is kept off the core
types by declaration merging so a BaaS install *cannot* write one; and the
`RebaseServerClient` type deletes `data` so the RLS-bypassing accessor has to be
spelled `dataAsAdmin` at every call site. Those are real design decisions, not
accidents.

The incoherences cluster in four places:

1. **One privilege boundary, four spellings.** The work done to make
   `dataAsAdmin` unmissable is undone in cron and in collection callbacks, where
   the same admin plane is reached as `client.data` and the *user-scoped* plane
   is reached as `context.data` — same type, opposite privilege, no doc.
2. **The contract types disagree with what ships.** `RebaseBrowserClient` claims
   to be what `createRebaseClient()` returns and has zero consumers; the OpenAPI
   spec describes `PUT` as a full replace while the server does a partial merge;
   the published `rebase.json` schema rejects a key the CLI documents and tests.
3. **The CLI's second level has no help.** Every `rebase cloud <group> --help`
   collapses to the same page, so ~44 flags are undiscoverable, and seven files
   carry `--help` handling that can never run.
4. **Doc rot on the highest-traffic fields.** The JSDoc on `slug` — the single
   most-read field in the product — describes a different feature.

Nothing here is a security hole. Item 1 is the one with a plausible path to
becoming one.

---

## Findings

Ordered by consequence.

### 1. The admin/user data-plane distinction is spelled four different ways

`packages/server/src/singleton.ts:66` goes to real lengths to make privilege
visible: `RebaseServerClient` omits `data` entirely so that the RLS-bypassing
accessor has exactly one name, `dataAsAdmin`, and the runtime keeps a `data`
alias only so untyped JS does not break.

That guarantee holds for `import { rebase }` and for `defineFunction`. It does
not hold anywhere else:

| Surface | Spelling | Type | Privilege |
| --- | --- | --- | --- |
| `import { rebase }` | `rebase.dataAsAdmin` | `RebaseServerClient` | admin, bypasses RLS |
| `defineFunction((app, { rebase }))` | `rebase.dataAsAdmin` | `RebaseServerClient` | admin, bypasses RLS |
| `defineCron({ handler({ client }) })` | **`client.data`** | `RebaseClient` | **admin, bypasses RLS** |
| collection callbacks | **`context.data`** | `RebaseSdkData` | **user-scoped, RLS applies** |
| collection callbacks | `context.client.data` | `RebaseClient` | admin, bypasses RLS |

`packages/types/src/types/cron.ts:105` states the problem in its own docstring —
*"it is only named `client` here"* — and then documents the RLS bypass. The
callback context does not: `packages/types/src/call_context.ts:45` documents
`context.data` purely in terms of row shape ("identical to the frontend SDK
client") and never says whose privileges it runs under. It is in fact
user-scoped (`buildCallContext` passes the request driver's own `this.data`,
`packages/server-postgres/src/PostgresBackendDriver.ts:151`), which is the safe
answer — but a reader who learned `client.data` from the cron docs and carries
that to a callback has inverted the meaning without any signal.

`context.client.dataAsAdmin` is the sharp edge: inside a user-scoped callback,
one extra hop reaches the admin plane under a name the type system no longer
flags.

**A bigger find came out of checking this.** The callbacks guide asserted, in all
six locales, that `context.data` *bypasses* RLS and has "full database access
regardless of the triggering user's permissions" — the opposite of the table
above. Reading `AuthenticatedPostgresBackendDriver.withTransaction` settles it:
it builds a fresh base driver bound to the RLS-scoped transaction
(`new PostgresBackendDriver(tx, …)`) after `applyAuthContext` has downgraded the
role, then runs the operation on it, so `buildCallContext` closes over a
`this.data` that speaks through `tx`. A callback on a user request is
user-scoped; only server-context work bypasses.

Nothing tested it either way, which is how it stayed wrong. It is also wrong in
the unsafe direction: RLS filters rather than raises, so a callback written on
the "sees everything" promise finds its sibling row when an admin task saves and
silently finds nothing when an end user does.

**Recommend.** Make `CronJobContext.client` a `RebaseServerClient` so `data` is
`Omit`ted there too, and rename it to `rebase` for consistency with
`defineFunction` (keep `client` as a deprecated alias for a major). Document the
privilege scope on `RebaseCallContext.data` in the same words used everywhere
else.

### 2. `RebaseBrowserClient` is a published lie with zero consumers

`packages/types/src/controllers/client.ts:425` exports `RebaseBrowserClient`,
documented as *"the shape produced by `createRebaseClient()` in
`@rebasepro/client`"*. It is not: that factory returns
`CreateRebaseClientResult<DB>`, which derives from `RebaseClient`, not from this.

A repo-wide search finds **no** producer, consumer, or reference outside its own
declaration. It hand-duplicates ~16 members of `RebaseClient` rather than
deriving from it, so it is also a standing drift source.

**Recommend.** Delete it, or redefine it as the type `createRebaseClient()`
actually returns and have the factory annotate against it.

### 3. OpenAPI describes `PUT` as a full replace; the server does a partial merge

`packages/server/src/api/rest/api-generator.ts:468` serves updates as
`PUT /data/{slug}/{id}` and applies the body as a partial merge — which is what
the SDK's `update(id, data: Partial<M>)` sends. There is no `PATCH` route at all.

The generated spec then makes it worse: `buildCollectionInputSchema`
(`packages/server/src/api/openapi-generator.ts:462`) is used for **both** POST
and PUT and emits `required` for every `validation.required` property. So the
published contract says a partial update must carry every required field.
Anyone generating a client from the spec — a first-class developer surface —
gets a wrong contract, and a spec-validating gateway will reject writes the
server would have accepted.

**Recommend.** Add `PATCH /data/{slug}/{id}` with the merge semantics, keep
`PUT` for replace (or alias it during a deprecation), and give PUT/PATCH their
own input schema without `required`.

### 4. Every `rebase cloud <group> --help` prints the same page

Reproduce:

```bash
for g in deploy projects link env databases; do rebase cloud $g --help | sed -n 3p; done
```

All five print `rebase cloud — Manage your apps on Rebase Cloud`.

Cause: `packages/cli/src/cli.ts:82` rewrites the subcommand to the literal
`"--help"` whenever the flag appears anywhere, and
`packages/cli/src/commands/cloud/index.ts:79` short-circuits on that value
before dispatch. Seven cloud command files (`databases`, `domains`, `env`,
`extensions`, `settings`, `orgs`, `debug`) declare `"--help": Boolean` in their
own `arg` spec; none of it is reachable.

The cost is concrete: ~44 flags across the cloud namespace with no way to list
them per command.

**Recommend.** Pass the real subcommand through and let each group handle its
own `--help`; reserve the index page for `rebase cloud --help` with no group.

### 5. `rebase doctor --help` refuses to run outside a project

```bash
cd /tmp && rebase doctor --help
# ✗ Could not find a Rebase project root.
```

`doctor` never declares `--help`, so the flag falls through to the command body
and hits the project-root guard. `--help` should never require project context.
`generate-sdk` and `telemetry` have the same gap with milder symptoms
(`telemetry --help` prints status and ignores the flag).

### 6. The published `rebase.json` schema rejects a documented key

`website/public/schemas/rebase.json` has `additionalProperties: false` at the top
level and declares only `$schema`, `rebase`, `apps`, `storage`.

`RebaseProjectManifest` also declares `telemetry?: boolean`
(`packages/types/src/types/project_manifest.ts:217`) — the repository-wide
telemetry opt-out. It is implemented (`packages/cli/src/telemetry/project.ts:53`),
surfaced in CLI output (`consent.ts:126`), and unit-tested
(`consent.test.ts:213`).

So an organisation that follows the documented opt-out gets
`Property telemetry is not allowed` in VS Code. The app-level `$defs` are in
exact sync with the TS types — only the top level drifted.

**Recommend.** Add `telemetry` to the schema, and generate the schema from the
TS types (or add a test asserting key parity) so this cannot drift again.

### 7. `-p` means three different things

| Command | `-p` |
| --- | --- |
| `rebase dev` | `--port` |
| `rebase auth`, `rebase cloud login` | `--password` |
| every `rebase cloud *` group | `--project` |

`--out` (`build`, `cloud env`) vs `--output` (`generate-sdk`) is the same class
of drift on long flags.

**Recommend.** Give `--project` sole ownership of `-p` (it has 52 call sites vs
4 and 7); move `dev` to `-P` for port and drop the short form for `--password`,
which should not be on a command line anyway. Standardise on `--output`.

### 8. ~~`@rebasepro/ui` publishes a second, stale `WhereFilterOp`~~ — WITHDRAWN

**This finding was wrong.** `VirtualTableProps.tsx` declares all 16 operators,
the built `dist/**.d.ts` ships all 16, and
`packages/types/test/filter-operators-duplication.test.ts` already guards the
two copies against drift — thoroughly, including a non-vacuity check.

The claimed drift came from reading
`packages/ui/src/components/VirtualTable/VirtualTableProps.d.ts` — a **stale,
gitignored build artifact** sitting next to its own `.tsx` source in a
long-lived checkout. It had 10 operators because it was generated before the SQL
pattern and null checks were added. A fresh clone does not contain it, and it is
excluded from the npm tarball.

Which makes it a live demonstration of the "smaller note" further down rather
than a finding of its own: a generated `.d.ts` beside its source is a file that
looks authoritative, answers greps first, and can be arbitrarily old.

**Done anyway.** The prose above `VirtualTableWhereFilterOp` did list only eight
operators — a comment enumerating a union it had fallen behind — so it now
points at the type instead of copying it, and the deliberate duplication carries
a note naming the guard that holds it together.

### 9. Bulk and idempotency support is asymmetric

`SDKCollectionClient` has `createMany` but no `updateMany` or `deleteMany`
(`packages/types/src/controllers/data.ts:519`). An ETL job can insert 1000 rows
in one transaction and must then delete them one HTTP request at a time.

`WriteOptions.idempotencyKey` is accepted on `create` only — not on `createMany`,
`update`, or `delete`. That is load-bearing, not cosmetic: the offline queue sets
it on every replay (`packages/client/src/offline.ts:1445`), but the `createMany`
replay one branch below (line 1469) has no key to send. **An offline
`createMany` whose ACK is lost replays and duplicates every row in the batch**
unless the caller passed `upsert: true`. `update`/`delete` replays are naturally
idempotent, so the gap that bites is `createMany`.

**Recommend.** Thread `WriteOptions` through `createMany` and have the offline
replay pass `op.mutationId`. Add `updateMany`/`deleteMany` (or document the
omission).

**Done.** Both, plus the idempotency gap. `updateMany` takes `{ id, data }`
entries rather than flat rows — on a table keyed on a `sku` or a composite key a
flat row cannot say whether a column is the address or a value — and
`deleteMany` takes ids rather than a filter, because a mistyped condition that
empties a table cannot be reviewed at the call site the way an explicit list
can. Served at `POST /<collection>/bulk/delete` rather than `DELETE
/<collection>/bulk`: bodies on DELETE are permitted but widely dropped by
proxies, and several OpenAPI generators ignore `requestBody` on a DELETE
operation, so a generated client would send no ids at all.

The bulk endpoints turned out to be missing from the generated OpenAPI spec
altogether — the same defect as finding 3, and adding two more routes would have
widened it, so all three are described now.

### 10. Two realtime entry points with no stated precedence

`SDKCollectionClient` declares `listen?` / `listenById?`; `CollectionClient`
extends it and adds `observe` / `observeById`, so both pairs sit on the same
object. `observe` is clearly the intended one — it is offline-aware,
de-duplicates emissions, and has a thorough docstring
(`packages/client/src/collection.ts:72`) — and it is implemented by wrapping
`listen`. The base contract's `listen` doc says only *"Subscribe to a collection
for real-time updates"* and never points at `observe`.

Both are honest about optionality (`listen` is only assigned when realtime is
on, line 311), so this is a guidance problem, not a broken API. It still means
the transport-agnostic type — the one the docs tell you to program against —
advertises the wrong primitive.

`count` has the matching split: optional on `SDKCollectionClient`, required on
`CollectionClient`, always implemented. So `client.data.posts.count()` compiles
in the browser and needs `count?.()` from a server callback, on an API whose
docstring promises it is *"identical in shape on both sides of the stack"*
(`packages/types/src/controllers/data.ts:608`).

### 11. `client.call()` is an undocumented escape hatch that mangles responses

`packages/client/src/index.ts:622`:

```ts
const res = await transport.request<{ data: T }>(...);
return res.data ?? (res as T);
```

Two problems. It is public and typed on `RebaseClient` with a one-line comment
("Make a raw HTTP call to the backend"), sitting beside the documented
`functions.invoke()` — so there are two ways to call a backend function with
different response contracts (`invoke` returns the raw body). And the unwrap is
wrong: an endpoint that legitimately returns `{ data: null }` gets the whole
envelope back instead of `null`.

**Recommend.** Either document `call` as the deliberate raw escape hatch and
stop unwrapping, or mark it `@internal`.

### 12. `slug`'s JSDoc describes a feature that no longer exists

`packages/types/src/types/collections.ts:26`:

> You can set an alias that will be used internally instead of the collection name.

`slug` is required and is the collection's primary identity — what the URL, the
REST path, the SDK accessor, and reference properties all key on. The text is a
leftover describing an optional `alias` field. This is the most-read docstring in
the authoring API.

Two smaller ones nearby:
- `BaseProperty.excludeFromApi` contrasts itself with `ui.hideFromCollection`
  (`properties.ts:228`). The key is `admin.hideFromCollection`; the `ui`
  namespace is gone.
- `CollectionCallbacks` says callbacks fire on *"server-side `rebase.data`"*
  (`entity_callbacks.ts:11`) — the name deleted from the type in finding 1.
- `RebaseData`'s summary reads *"the **admin admin**"*
  (`data.ts:561`).

### 13. `packages/client/src/collection.ts` contains a raw NUL byte

Line 267 embeds a literal `U+0000` in a sentinel string rather than the escape
`"\0missing"`. `file(1)` reports the source as `data`, and **grep and ripgrep
silently skip the entire file** — 418 lines of the client's core collection API,
including `CollectionClient`, `observe`, and `createMany`, are invisible to every
default code search. It is the only such file in the repository (swept across all
tracked `.ts/.tsx/.js/.jsx/.md`).

This is the failure mode already named in [`bug-classes.md`](./bug-classes.md).
Functionally the value is correct and cannot collide with `JSON.stringify`
output; only the source encoding is wrong.

**Recommend.** Replace with the escape `"\0missing"` (identical value, plain-ASCII
source). Add a CI guard rejecting control
characters in tracked sources — the class recurs and is invisible by
construction.

---

## Smaller notes

- **`defineCollection` exists twice** — `@rebasepro/common` and
  `@rebasepro/admin-types`. The split is deliberate and well-argued, but because
  the `admin` augmentation is program-global (and the templates pull it in via
  `config/admin.d.ts`), both behave identically in a scaffolded project. The docs
  need to arbitrate which one a reader should import, or the split is two names
  for one function.
- **`buildCallContext` is cast, not typed.**
  `PostgresBackendDriver.ts:151` returns `{ user, driver, data, client,
  storageSource } as unknown as RebaseCallContext` — `driver` is not on the
  contract, and the double cast disables checking for the whole object. Callbacks
  therefore receive an undocumented field, and the contract is unverified.
- **`e.code` is untyped.** `RebaseApiError.code?: string`
  (`packages/types/src/errors.ts:49`) while the server emits a finite set
  (`BAD_REQUEST`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `UNAUTHORIZED`,
  `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `DB_PERMISSION_DENIED`,
  `SCHEMA_DRIFT`). Export a `RebaseErrorCode` union so callers can switch
  exhaustively.
- **`rebase.sql!` in the flagship example.**
  `packages/server/src/functions/define-function.ts:47` uses a non-null
  assertion that is no longer needed — `RebaseServerClient.sql` was narrowed to
  required. The canonical example of the server API teaches an unnecessary `!`.
- **`telemetry` is filed under "API Keys"** in `rebase --help`
  (`cli.ts:231`).
- **No `afterDeleteError`** to match `afterSaveError` in `CollectionCallbacks`.
- **Stale generated `.d.ts` files beside their sources.** A long-lived checkout
  accumulated 126 of them — `packages/ui` (109), `packages/utils` (11),
  `packages/forms` (6). Gitignored, absent from a fresh clone, and excluded from
  the published tarball, so nothing ships wrong. They are still worth clearing:
  one of them (`VirtualTableProps.d.ts`, six operators out of date) is what
  produced finding 8, which was withdrawn. A generated declaration next to its
  own source answers searches first and carries no indication of its age.

      find packages/*/src -name '*.d.ts' | while read f; do
        [ -f "${f%.d.ts}.ts" ] || [ -f "${f%.d.ts}.tsx" ] && rm "$f"
      done

## What is already right

Worth not breaking:

- The `@rebasepro/client` barrel is an explicit curated list with the rule
  written down in the file, and internal factories are deliberately withheld.
- The `admin`-block augmentation (`packages/admin-types/src/augment.ts`) — the
  interface-vs-type constraint, the program-scope caveat, and the `M` forwarding
  bug are all documented at the point where someone would otherwise reintroduce
  them.
- Module format is uniform: every package is `type: module`, ESM-only, with
  `types` + `import` conditions and no half-CJS build to keep in sync.
- The error surface: one class (`RebaseApiError`), one subclass, `status`
  present only for HTTP, and a documented reason for it.
- `iterate()` / `findAll()` terminate on `meta.hasMore` rather than page length,
  and `findAll` throws past its cap instead of returning a short array that reads
  as complete.

---

## Suggested order

1. Findings 1 and 3 — the two that can produce wrong behaviour in someone else's
   code (privilege confusion, generated clients).
2. Finding 9's `createMany` idempotency — a real data-duplication path.
3. Findings 4, 5, 6 — cheap, high-visibility CLI/config fixes.
4. Findings 2, 12, 13 and the smaller notes — mechanical.
5. Findings 7, 8, 10, 11 — need a deprecation window.
