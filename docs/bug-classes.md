# Bug classes, and how to sweep for them

Every gate in `.github/workflows/verify.yml` has a comment that is a post-mortem.
Fourteen gates, fourteen bugs that had already shipped. That is a healthy reflex —
a bug that becomes a gate cannot come back — but it is a strictly reactive one:
each gate is added *after* an incident and scoped to that incident's exact shape,
so the net grows one hole at a time and the next bug falls through a hole nobody
has patched yet.

This document is the other half. When a bug is found, the fix is the easy part;
the leverage is in naming the **class** and sweeping for its siblings before
closing the ticket. What follows is the classes found so far, the sweep that
finds each one, and what the last sweep turned up.

---

## 1. Starting state

Every suite in this repo builds its own fixture, which means every suite starts
from a database the current code just created. That is one of three states a
deployment is actually in.

| state | who created the schema | covered by |
|---|---|---|
| **empty** — provisioned, zero rows | this code | `bootstrap-e2e.test.ts` |
| **fresh** — provisioned and seeded | this code | everything else |
| **aged** — created by an *older release*, then upgraded | a previous release | `upgrade-e2e.test.ts` + `schema-snapshots/` |

**Empty** is where first-run logic lives, and it is invisible to a normal fixture
from both directions at once: a fixture that seeds a user never enters the
bootstrap window, and one that seeds nothing never registers. The first-admin
dead end lived there for months.

**Aged** is where migrations live, and it is unreachable by construction — code
that writes the new shape cannot produce the old one. The `unique_device_session`
outage, the `user_id` → `uid` rename and the out-of-order migration skip all lived
there.

**Sweep:** for any branch on the existence or count of a resource, ask what the
zero side does — and whether any test ever reaches it. `first`, `needsSetup`,
`bootstrap`, `total === 0`, `.length === 0`, `?? []` on a permission or rule list.

**Watch for:** a zero-state branch that opens access rather than closing it. An
empty permission list must mean *no permissions*, never *all permissions*.
`api-key-permission-guard.ts` is the reference: it loops and returns `false` at
the end, so an empty or unparseable list fails closed by construction rather than
by a check someone has to remember.

---

## 2. One predicate, several implementations

The sharpest form: an endpoint that **advertises** a capability and a route that
**enforces** it, each computing the same rule independently. They agree on the
day they are written and diverge on the first change, and the failure is a user
staring at a form that can only ever 403.

`registrationEnabled` had drifted across *three* implementations. Two had been
fixed for the empty-database case; the third had never had the kill switch at
all — and the third was the live one, because `init.ts` registers
`GET /auth/config` directly and mounts the auth router afterwards, so Hono
resolves the direct registration first and the router's copy never runs.

**Sweep:** enumerate the capability surface — every field of
`AuthAdapterCapabilities` — and for each one find the code that enforces it.
Confirm they read the same function, not merely the same-looking expression.

**Fix shape:** do not correct the outlier. Extract the predicate
(`registration-policy.ts`) and route every caller through it, so the next term
added reaches all surfaces at once. Then pin **agreement** rather than behaviour:
`registration-policy.test.ts` asserts that what `/auth/config` advertises is what
`/auth/register` does, across the whole flag × table-state matrix. Any future
term is covered by that automatically, which a test written against either
endpoint alone is not.

---

## 3. Tests that bypass the wiring

`disableSelfRegistration` was declared on the route module, read by both config
endpoints, and covered by two passing tests — while being entirely unreachable in
production, because `BuiltinAuthAdapterConfig` never carried it. Nothing a user of
the framework could write ever set it. The tests passed because they constructed
`createAuthRoutes` directly, bypassing the adapter, which is the only wiring a
real backend uses.

**Sweep:** for any option, trace it end to end — public config type → the thing
that constructs the implementation → the implementation. A grep that finds an
option only in its consumer and its test is the signature of this bug.

**Fix shape:** test through the outermost constructor a real caller uses. The
replacement tests drive `createBuiltinAuthAdapter`, so the missing plumbing fails
them.

---

## 4. Safety nets that swallow their own failures

`ensureAuthTablesExist` wraps its migrations in `try { … } catch { logger.warn() }`
and continues, deliberately: a limping boot beats a crash loop. The cost is that a
migration which throws raises nothing for a test to catch, so **"it booted" proves
nothing at all**.

The same shape appears wherever a `catch` logs and continues, and wherever a step
is allowed to be skipped: `rls-check` had a "no Docker, skip" escape hatch that
reported success for a scan that never ran, which is why CI now sets
`RLS_CHECK_REQUIRE_DOCKER=1`.

**Sweep:** find every `catch` that logs and continues, and every conditional skip.
For each, ask what test would fail if the guarded work silently did nothing.

**Fix shape:** assert the *outcome*, never the absence of an exception.
`upgrade-e2e.test.ts` reads the catalogue and the rows, and its sharpest assertion
is a write — two live tokens for one session, the exact statement the old
constraint rejected. A vacuity floor helps too: that suite fails if the snapshot
directory has fewer than two files, because `describe.each([])` registers no tests
and reports green.

---

## 5. Remediation text nobody tested

An error that tells the user what to do is a code path, and it is one that no
test in this repo asserts. So the instruction rots — or is wrong from the start —
and the failure mode is the worst kind: the user follows the advice, the state
does not change, and they conclude the product is broken rather than the message.

`rebase db push` said:

> ✗ Could not find atlas binary.
> Install it with: `pnpm add -D @ariga/atlas`

`@ariga/atlas` downloads its binary in a **`preinstall`** script, and pnpm 10+
refuses to run a dependency's scripts unless it is allowlisted. So the common
way to reach that error is to have installed the package already: it sits on
disk with its `install.js`, `node_modules/.bin` is empty, and the install exited
**0**, with `Ignored build scripts: @ariga/atlas` several screens up. Running the
suggested command puts you in precisely the same state. The advice was a loop.

Note the two independent soft failures stacked here: a build step skipped
without a non-zero exit (class 4, in somebody else's tool), and a message that
named the wrong cause.

**Sweep:** grep for user-facing strings that contain a command — `Install it
with`, `Run `, `Try `, `Fix it with`, `pnpm add`, `npm i`. For each, ask: *what
state produces this message, and does the command actually change that state?*
Pay special attention to anything whose cause could be "installed but not
built", "present but not configured", or "cached".

**Fix shape:** diagnose before advising. `diagnoseMissingBin` distinguishes
"never installed" from "installed with its build script blocked" — two states
that look identical from a missing binary and need opposite instructions.

---

## 6. Tests that time an async path by counting ticks

`packages/client/test/auth.test.ts` awaited `Promise.resolve()` exactly eight
times and then asserted that a fatally-rejected token refresh had signed the
user out. Eight was however many microtasks that path took when the test was
written. The path grew — refresh-token rotation became concurrency-safe, which
added awaits — the sign-out stopped landing inside eight ticks, and a code path
that was still correct began reporting as a security regression. CI runs
`pnpm test`, so main was red on it.

The sibling test is what made it hard to read. "The session is NOT null" passes
trivially when nothing has run yet, so a file where *both* tests had stopped
waiting for anything reported exactly one failure, and the failure pointed at
the product rather than at the clock.

**Sweep:** `grep -rn "for (let i = 0; i < [0-9]*; i++) await Promise.resolve()"`
over the test suites, then neutralise each helper (set the loop bound to `0`)
and re-run. A test that still passes was never waiting for the thing it names.
Checked 2026-07-31: `channel-bus.test.ts` and `cdc-realtime.test.ts` both fail
when zeroed — they are genuinely synchronising — and
`packages/client/test/subscription-resilience.test.ts` passes when zeroed, but
its assertions are positive and specific (`onError` called, exactly one
subscribe frame), so growth there fails loudly rather than silently. Left alone.

**Fix shape:** wait for the condition, not for a tick count. Drain the microtask
queue until the predicate holds (positive assertions), or drain a fixed generous
budget before asserting something did *not* happen (negative assertions). Still
no timers and no wall-clock, so determinism is unchanged, and a real regression
fails in milliseconds instead of hanging.

**Watch for:** a negative assertion (`not.toBeNull`, `not.toHaveBeenCalled`)
sitting next to a positive one behind the same wait helper. The negative one
cannot fail early, so it will keep passing long after the helper stopped
working, and it will make the positive one look like the bug.

---

## 7. A test and the code agreeing on a fiction

`MongoConditionBuilder` picked searchable columns with
`prop?.dataType === "string"`. No property in `@rebasepro/types` has ever had a
`dataType` field — a real collection carries `type` — so the loop matched
nothing for every collection a user could declare, and every search fell
through to `$text`, which needs a text index and throws without one.

The suite was green because its fixtures were written with the same wrong key.
The test data agreed with the bug, and neither ever met a real collection.

This is the failure mode `tsconfig.tests.json` was created to stop, and its own
docblock records an earlier instance. But it covers only two packages: measured
2026-08-01, including every test directory yields **1,668** type errors
(server-postgres 974, client 266, server 122, common 106, admin 80, app 52,
then a tail of nine packages with 21 or fewer). Everything outside those two is
invisible to tsc, and the runners strip types without checking them.

A second instance sits in `common/test/collection_registry_property_gates.test.ts`,
which declares collections with `driver:` instead of `engine:` — so the engine
gates it exists to test are never exercised at all.

A third instance, found 2026-08-22 and the most expensive of them, is not a key
but a **filename**. `fetch-bundle.ts` decided whether an unpacked directory was
a bundle by looking for `rebase-bundle.json`. Nothing has ever written that file
— the CLI writes `manifest.json` and `loadBundle` reads `manifest.json`. The only
producer of `rebase-bundle.json` anywhere in the repository was the fixture in
`fetch-bundle.test.ts`, which wrote the marker it then asserted on.

So `REBASE_BUNDLE_URL` rejected every real bundle from the day it shipped, with
a message blaming the bundle. It took down the Cloud Run substrate and the Helm
chart's `bundle.mode: url` — both listed as "open" or "unreached" in later
audits, for reasons that were really this — and Kubernetes grew a whole init
container in shell to do the job the broken path was supposed to do. The
duplicate implementation was the *symptom*; six tests were green throughout.

The tell is scope: `bundleRootIn` and its test were the entire population of
that filename. A name that appears only in one module and its own test, but
describes an artifact produced *elsewhere*, has nothing holding it to reality.

**Sweep:** for any fixture key, `grep` it in `packages/types/src`. Zero hits on
a field the production code branches on is this bug. Then check whether that
test directory is in `tsconfig.tests.json`; if not, it cannot warn you.

For filenames and other cross-module identifiers, the same grep with a different
question: does anything *write* what this reads? If the only writer is a test,
the feature does not work. Prefer importing the constant from whoever owns the
artifact — `fetch-bundle.ts` now takes `MANIFEST_FILENAME` from `bundle.ts`,
which is where the loader's own definition lives, so the two cannot diverge
again.

**Fix shape:** fix the source, switch the fixtures to the real shape, and earn
the package a line in `include` so it cannot drift again. The tail packages are
cheap — 68 errors across nine of them.

---

## 8. A security-labelled test watching the wrong mechanism

Four tests named "CVE-FIX: registration NEVER assigns admin role, even for
first user" each asserted that `assignDefaultRole` was not called with
`"admin"`. The first user is promoted through a different call —
`setUserRoles(id, ["admin"])`, on both the password and OAuth paths — and in
that branch `assignDefaultRole` is never reached at all.

So they watched a function the escalation path does not use, and passed by
construction. Measured: changing `if (isFirstUser)` to `if (true)`, so that
*every* registrant becomes an admin, left three of the four green; the fourth
failed only incidentally, because that mutation also skips the `defaultRole`
branch.

Their names were also simply wrong about the system. Registration *does* make
the first user an admin — the documented bootstrap, asserted 1,100 lines
earlier in the same file. A reader of that block was told the opposite, under a
CVE label.

**Sweep:** for any test whose name contains NEVER, CVE, or a vulnerability id,
find the line of source that would have to change for the claim to break, and
check the test observes *that* line. A spy on a neighbouring function is the
signature.

**Fix shape:** assert the property, not a proxy for it — here, "no non-first
registration reaches admin **by any mechanism**", which reads every route to
the role rather than one of them. Pair it with a positive test that the
bootstrap still works, or the negatives can go green on a build where the
feature quietly died.

---

## 9. `toBeDefined()` on an API that returns `null`

`Headers.get` and `FormData.get` return `null` for a missing key, and `null`
*is* defined. So `expect(res.headers.get("Retry-After")).toBeDefined()` cannot
fail: the header could be dropped entirely and the rate-limiter test would stay
green. The same shape appeared on `formData.get("file")`, and on
`auth.getSession()`, which is typed `RebaseSession | null`.

**Sweep:** `grep -rn "toBeDefined()" ` over the test suites and, for each,
answer what the expression returns when the thing is absent. `null`, `[]`, `""`
and `0` all pass `toBeDefined()`.

**Fix shape:** `toBeTruthy()`, or better, assert the value. The nearby
`rate-limit-data.test.ts` already got this right, which is the tell that the
weaker one was a slip rather than a decision.

---

## 10. A flag whose `false` grants instead of skipping

`requireAuth` on both realtime sockets was resolved as

```ts
const requireAuth = authConfig?.requireAuth !== false && !!authConfig?.jwtSecret;
```

and the connection handler then seeded each session with
`authenticated: !requireAuth`. So the flag does not gate a check — it *is* the
check, inverted. Computing `false` did not skip authentication, it granted it to
everyone who connected, at connect time, silently. `requireAuth: true` on a
server whose auth came from an adapter rather than a local `jwtSecret`
evaluated to `false`: asking for authentication was what turned it off.

**Sweep:** grep for a boolean derived from config that is later consumed
*negated* — `!flag`, `flag ? x : y` where `y` is the permissive branch, or a
default assignment like `authenticated: !requireAuth`, `allowed: !restricted`,
`isPublic: !requireX`. For each, ask what the value is when the feature is
requested but its prerequisite is absent. If that state grants rather than
refuses, it is this class.

**Fix shape:** fail closed, and say so. An explicit request for a restriction is
honoured on its own; when there is no credential to enforce it with, refuse
everyone and log at boot. Refusing is visible and gets reported; admitting is
not, and does not.

---

## 11. Two interfaces for one call, disagreeing

`init.ts` passes the AuthAdapter as the fifth argument to
`initializeWebsockets`. `BackendBootstrapper` declares five parameters.
`DatabaseAdapter` — the other type describing the same hop — declared four. The
wrapper in `PostgresAdapter` was written against the shorter one and dropped the
argument. JavaScript discards a surplus argument without complaint, and
TypeScript had nothing to object to, because each side was individually
consistent.

What went missing was the argument that makes the socket secure by default. The
same file already carried a comment explaining that `ensureCollectionSchema` and
`ensureCollectionPolicies` had been dropped at this exact boundary before, with
the same silence — which is the tell that the boundary, not the method, is the
defect.

**Sweep:** for every hop where an object is re-wrapped or forwarded, diff the
two type declarations parameter by parameter, and diff both against the call
site. `grep -n "<method>" packages/types/src` will usually turn up more than one
declaration; if their arities differ, something is being dropped right now.

**Fix shape:** one declaration, or make the narrower one reference the wider.
Then pin it with a test that asserts the forwarded call receives *every*
argument, not that the method exists — a wrapper that drops an argument is still
a function of the right name.

---

## 12. A prop the component does not have

`render(<Alert severity="error">…</Alert>)` in a test named "renders alert with
correct message". `AlertProps` has no `severity`; the prop is `color`. React
drops an unknown prop silently, so the alert rendered in its default blue while
the test — which read only the text — passed. It is class 7 with a JSX face, and
it survived because `packages/ui/test` was not in `tsconfig.tests.json`.

Its neighbour in the same file was the inverse: `<VirtualTable<any> …>` did not
compile, and the reason was a product bug. `React.memo` takes the props type as
its *own* type argument, so `React.memo<VirtualTableProps<Record<string, unknown>>>(…)`
pinned `T` at the boundary and discarded the `<T>` the inner function declares.
The exported component was not generic at all.

**Sweep:** put the test directory in `tsconfig.tests.json` — that is the whole
sweep, and it is why the include list is the unit of progress rather than the
individual fix. Then read what tsc rejects rather than suppressing it: half of
these are the test's mistake and half are the product's.

---

## 13. Generated code, checked by substring

A code generator that emits *source text* has no compiler between it and its
output, so two mistakes are free.

The first is asking questions of the text with `includes`. The introspection
generator decided whether to emit a validation minimum with
`!extra.includes("min:")`. `admin:` ends in `min:`. Every property that had
picked up an admin block therefore claimed to already have a minimum, and
silently dropped the one the database declared — on `varchar` bounds and on
`CHECK (length(slug) >= 3)` alike. A key in generated code is preceded by a
newline, a brace or a comma, never by another identifier character, and the
predicate has to say so.

The second is that nothing typechecks the output. The same generator emitted
`icon` and `propertiesOrder` at the top level of a `PostgresCollectionConfig`,
which declares neither — they belong in the `admin` block, and have since the
BaaS/admin split. Every generated file was a type error, and the panel, which
reads the block, never saw either value. No assertion caught it because every
assertion was about substrings, and the substrings were all present. Two lines
below, a self-referencing foreign key made a file import its own default export
under the name it declares three lines later.

**Sweep:** grep the generators for `.includes("` on emitted text —
`introspect-db-logic.ts` is one; `generate-drizzle-schema`, the DDL emitters and
the ts-morph schema editor are the others — and check whether the needle can
occur as a suffix of a longer identifier. Then, for anything that writes a file
a user will compile, build a `ts.createProgram` over the output and assert zero
diagnostics; `introspect-real-generation.test.ts` does this over four real
schemas and is what surfaced both bugs above.

---

## 14. A field the platform writes and never reads back

A column that nothing downstream consults cannot be wrong in a way anything
notices. It is not dead — it is displayed, and it is billed on — but no code path
compares it to reality, so it drifts silently and forever.

A cloud project's `provider`/`region` are the case. They are a *request*: the
deploy target comes from the project's cluster record or the resolver's ambient
rung, never from these columns. `rebase cloud projects create` defaulted them to
`hetzner`/`nbg1`, and the only writer of the truth — `stampActualTarget` — was
called from the two build paths but not from the managed-bundle path. So projects
that only ever deployed bundles sat in the console reading "Hetzner · Nbg1" while
running on GKE, and billed against a `compute_hetzner_*` Stripe price. Nothing
failed, because nothing asked.

The tell is a field with **no reader that can disagree**. Compare a wrong
`gitBranch`, which fails the next clone: a field the code acts on is corrected by
reality within one deploy. This class survives precisely because it is inert.

**Sweep:** for each column a client can set, grep for a read *other than*
display, serialization or billing. If the only readers render it, ask what writes
the truth and whether every path that learns the truth writes it — the bug here
was one of three paths having the call. Then check the field is not an input to
something that silently accepts anything: `compute_${provider}_${vmSize}` builds
a Stripe lookup key by concatenation, so a wrong half produces a plausible key
for a price that may not exist.

**Watch for:** a "correct it when we find out" stamp that declines to write when
the truth is unknown. `stampActualTarget` skips `region` when the resolved target
has none, which left `gcp · nbg1` — a Hetzner region on a Google target, wrong in
a way that reads as data. Log it, and make the unknown knowable (`MANAGED_REGION`
on the control plane).

---

## 15. A hook that decrypts for whoever asks

Field-level encryption is usually written as a symmetric pair — encrypt in
`beforeSave`, decrypt in `afterRead` — and the second half quietly answers a
question nobody asked out loud: *decrypt for whom?*

`registerEncryptionHooks` decrypted for every reader. A `GET /api/data/clusters`
therefore returned a live kubeconfig — root on the cluster every tenant runs on —
and the S3 secret guarding every tenant's database backups. RLS admitted only the
`admin` role, so the exposure was scoped to platform admins rather than
customers, which is why it survived review: the *row* access was correct, and the
question of what is inside the row was never separately asked.

`env-var-hooks.ts` had already answered it for weaker secrets, and its comment is
the rule: **a page load is not consent** to put a secret in a response body, a
browser cache and a proxy log. Where a person genuinely needs one back there is a
deliberate reveal endpoint that says so at the point of use (`db-info.ts`,
`env-vars.ts POST /reveal`).

**Sweep:** grep for `afterRead` alongside any decrypt/unmask/reveal call, and for
each one ask which identities reach it. `isTrustedServerContext` is the test —
`service` is the platform, everything else is a caller, and an *absent* context is
a caller too (fail closed). Then confirm the withheld value is not load-bearing
for a client: check the console and the CLI for a reader of that field, not just
of the collection. Both proved to want only presence (`secretSet`) and non-secret
columns.

**Watch for:** returning a mask instead of the stored bytes. A mask is what an
edit form reads and writes straight back, storing `••••••` as the secret.

**Gate:** the unit test cannot settle this one, because it *builds* the context it
asserts on — the same trap `saas/backend/src/utils/auth-context.ts` documents.
`encryption-read-scope.test.ts` reads a real row through the real driver and
*observes* the identity the hook was handed. It was verified against three
mutants: the guard removed, the guard inverted, and — the failure mode that
motivated it — `withTransaction` dropping the user from its per-transaction
delegate, which would have refused the platform its own kubeconfig. All three go
red.

---

## 16. A retry that runs inside the failure

A `try` around a fast path with a slower fallback in the `catch` is ordinary, and
it is wrong the moment both run on the same Postgres transaction. The first
statement to raise aborts the transaction; every statement after it returns
`25P02` — *current transaction is aborted, commands ignored until end of
transaction block* — regardless of what it asked. The fallback cannot succeed,
and it overwrites the diagnosis with one about a transaction the user never
mentioned.

Reads here run in a transaction because that is where `SET LOCAL ROLE` binds RLS,
so every read path inherits this. `FetchService` had five of these: catch a
failed `db.query.findFirst/findMany`, log a warning, retry with `db.select`.
Visiting `/c/products/new` in the admin sent `new` to a `uuid` column, which
raised `22P02` — "invalid input syntax for type uuid" — and what reached the
browser was `Database error in "products" [25P02]`. The real cause was in a
`logger.warn` nobody was reading.

The tell is a **`catch` that issues a query**. Ask what the caught error means:
if it came *back from* Postgres, the connection's transaction is already lost and
the retry is guaranteed to fail. If the query was never built — a missing
reciprocal relation, a method that isn't there — nothing was sent, the
transaction is intact, and the fallback is exactly right. `reachedDatabase()` is
that question: `extractPgError(e) !== null`.

**Sweep:** grep the drivers for `catch` blocks containing `db.`, `this.db`, or
`tx.`. Then grep for the second half of the pair — a `logger.warn` describing a
fallback — and check the rethrow guard is there.

**Watch for:** the class hiding a second bug. Here the fallback masked one that
should never have reached Postgres at all: an id no key column can hold names no
row, which is a 404. `parseIdValues` validated numeric keys and let anything
through for `uuid`, so the panel's own URLs could raise `22P02`. Judge that from
the **column**, not the config — `isId: "uuid"` is a claim about a key, and a
`text` column holding ids of some other shape is a working app you must not start
rejecting.

---

## 17. A parameter object re-listed by hand at every hop

A request's parameters cross several boundaries — SDK to transport, transport to
socket, socket to server, server to driver — and at each one somebody wrote out
the fields to forward. Every list is a place a field can be missing, and the
type system does not object: the *source* type still declares the field, the
*destination* type still accepts it, and nothing checks that the value made the
journey.

The failure is silent by construction, and worse than an error. A dropped
`limit` does not fail, it unbounds the read. A dropped `logical` does not fail,
it **widens** the query — `where(or(…)).find()` came back with every row the
caller's policies allowed. A dropped `offset` does not fail, it serves page one
to a caller asking for page three, indefinitely.

`FindParams` has eight fields. The in-process accessor forwarded four. The
realtime chain forwarded six of them at hop one, five at hop two, and stored
seven of nine at the server — losing `offset` and `logical` at every hop, so
they were accepted by four consecutive type-checked boundaries and discarded.

**Sweep:** for every type that describes a request, find each place it is
destructured or rebuilt and diff the field list against the declaration. The
tell is a literal list of names where a spread would do.

**Fix the shape, not the instance.** Forward the object: `const { onUpdate,
onError, ...query } = props`. Where a subset genuinely is required, derive it —
the subscription de-duplication key was a hand-listed subset, so two queries
differing only in `offset` collided and the second listener was handed the first
one's rows. Name the shape once when several places need it
(`StoredCollectionRequest` replaced five inline copies).

**Gate it** by asserting the whole object arrived, not field by field: a test
that checks the seven fields someone remembered will keep passing when the
eighth is added and forgotten.

**The same class runs along a second axis: call sites rather than fields.** A
feature applied by hand wherever it is needed is applied at *most* of them.
`logical` reached two of the three `count()` calls in the REST generator;
`projectResponseFields` was wired into two of the four routes that return rows;
the count inside `find()` was missed while the `count()` beside it was fixed.
Each looks complete from the site you are reading. The sweep is to enumerate
the call sites of the *feature* — every `count()`, every route that returns
rows — and check each one, rather than reading the implementation and assuming
its callers agree with it.

### The same route family, one parameter later — 2026-08-13

`vectorSearch` was the fourth parameter to go missing on the subcollection
routes, after `logical`, `fields` and the `offset`/`orderBy`/`include` group.
The route parses it — it shares `parseQuery` with the root list, so the value
is sitting in `queryOptions` — and then builds `listOptions` without it. Nothing
downstream is at fault: `fetchCollectionForRest` resolves the nested path and
applies the distance ordering, the `_distance` select and the threshold, exactly
as it does for a root read, and had done so the whole time.

What makes this one worth recording is **what the caller is told**. A dropped
`limit` unbounds a read and a dropped `logical` widens one, and both of those
still answer the question that was asked. A dropped `vectorSearch` answers a
*different* question in the same shape: `GET /authors/1/posts?vector_search=…`
came back 200, with rows, ordered by `id DESC`, no `_distance` field, and the
threshold ignored. The caller reads the first row as the nearest neighbour. There
is no signal anywhere — not a status, not a header, not a missing field they
were looking for — that the ranking they are about to act on is arbitrary.

**A downgrade needs both halves wired in the same commit.** Only the
`threshold` narrows a count; ordering does not change how many rows there are.
Fixing the listing alone would have left `meta.total` counting the rows the
threshold excluded, and `hasMore` promising a page that no longer exists — so
the count paths were threaded too, `PostgresBackendDriver.count` →
`dataService.count` → `FetchService.count`, and the root `countRawEntities`
with them, which had the same gap. Before the fix the two disagreed *silently
but consistently* (both ignored it), which is the trap: a half-fix converts a
wrong answer into two answers that contradict each other.

**The alternative was a 400**, and it is the right fix whenever the downstream
support is genuinely absent — refusing `?vector_search=` on a route that cannot
serve it tells the caller something true. It was not needed here only because
the nested read already supported it. Serving the request as though the
parameter were not there is the one option that is never correct.

---

## 18. A predicate that discriminates nothing

`isRebaseApiError(error)` — `return error instanceof Error`. Used to guard "is
this operational enough to call a 400?", with a comment above it explaining the
distinction it was drawing. It drew none, so an unreachable database was
reported to callers as a bad request, and a 4xx tells both the SDK and whatever
watches the logs that nobody should retry and the user is at fault.

These survive because the name is read instead of the body. A guard called
`isX(v)` is assumed to answer a question; when its body is `v instanceof Error`,
`v != null`, or `true`, every call site is dead weight that reads as a check.

**Sweep:** read the body of every `is*`/`has*`/`can*` function and ask what it
rejects. Then look at the call sites — a guard that never rejects means the
branch behind it always runs, which is often the bug rather than the guard.

**Watch for the information it needed being thrown away lower down.** This
predicate was crude because `toUserFriendlyError` had already flattened the
Postgres error — SQLSTATE and all — into `new Error(message)` one layer below.
The decision belonged where the evidence was. When a classifier looks
impossible, check whether something upstream deleted what it needed.

---

## 19. Check-then-act, in the thing written to prevent a race

The idempotency store recalled a key, and on a miss did the write and then
remembered it. Two requests carrying one key both missed the recall, both wrote,
and the duplicate the mechanism exists to prevent was inserted anyway. The
`ON CONFLICT DO NOTHING` on the key table protected only its own second row —
and the comment above that clause names the very case that defeats the design:
"two tabs replaying the same key at once".

The tell is a mechanism whose stated purpose is *mutual exclusion* implemented
as a read followed by an unrelated write. Handling the secondary symptom of the
race — here, avoiding a `23505` in the bookkeeping — reads as having handled
the race.

**Fix:** claim before acting, in one statement. `INSERT … ON CONFLICT DO UPDATE
… WHERE <expired> RETURNING` claims a free or expired key and refuses a live
one, so `RETURNING` yields a row exactly when this request owns it.

**Watch for what claiming first introduces.** A claim taken and then not
released strands the key: a write that throws would have every retry refused
until the row aged out, turning one reset connection into a day of failures. A
claim needs a release path on every exit.

---

## 20. A value computed and then discarded

Two bugs found the same afternoon, in unrelated files, both invisible to
reading:

* `useBoardDataController` read `searchStringRef.current` into
  `currentSearchString` at the top of two functions and used it in neither. The
  board took a search term, listed it as an effect dependency — so typing tore
  down and rebuilt every column's subscription — and passed it to none of its
  three queries. Searching a kanban board did nothing but make it flicker.
* `CollectionViewBinding` called `useSlot("collection.error")`, selected the
  first view when a load failed, assigned it to `pluginErrorView`, and rendered
  a hardcoded banner instead. `collection.error` is a declared slot with its own
  props interface and a `@group Plugins` docblock; it did nothing at all.

Neither looks wrong on the page. The code that *does* the work is present and
correct; what is missing is an absence, and absences are what reading is worst
at. A reviewer sees `const currentSearchString = …` and their eye supplies the
use.

**This is exactly what `no-unused-vars` reports**, and it was reporting it the
whole time. The rule is configured, correct, and structurally invisible: it
reports at `warn`, and every `test:lint` script — and CI's own lint step — runs
eslint with `--quiet`, which prints errors only. 3,642 warnings are suppressed
workspace-wide.

**Separate the two things the rule reports.** *"'x' is defined but never used"*
is a stale import or an unused parameter: noise, nothing was computed, nothing
is lost. *"'x' is assigned a value but never used"* is work that was done and
thrown away, and that is the one worth a gate — 785 of the former, 155 of the
latter.

**Sweep:** `eslint <path>` **without** `--quiet`, filtered to
`is assigned a value but never used`. Then read each one and ask what the value
was *for*. Most are superseded leftovers — a `useCallback` replaced by a `Set`,
a constant whose consumer moved — and the honest fix is deletion. The dangerous
minority are a parameter that should have been forwarded, which is class 17
wearing different clothes.

**Do not fix these by renaming to `_`.** That silences the only detector of the
next one. Delete it, or use it.

**Gate it as a ratchet, not a cleanup.** `check:unused` pins the 155 and fails
on the 156th, the same shape as `check:hooks` one rule over. The count was never
the problem; 155 ambient findings make the 156th invisible, which is precisely
how both bugs above survived.

---

## 21. A declared extension point that nothing reads

The most expensive kind of absent code, because it is *advertised*. A slot, an
option, a query parameter — declared in a public type, given a props interface
and a docblock, listed in the reference table beside the ones that work — and
read by nothing. The user writes correct code against a correct-looking API and
gets silence, with no way to tell whether the fault is theirs.

Found in one sweep:

* `?fields=` was applied on two of the four routes that return rows. The two
  subcollection routes parsed it and returned every column.
* `collection.error` — a declared plugin slot with its own props interface —
  was computed into a variable and rendered nowhere.
* `admin: { disabled: true }` reached the table's inline editor and was applied
  to nothing, so the cell stayed typeable.
* `CollectionView`'s `canCreate`, documented as "shows the + button", was
  destructured and never read.
* Seven of the twenty-nine plugin slots are rendered nowhere at all, while
  appearing in the public reference in six languages.

**Sweep by enumerating the declaration, not the implementation.** The
declaration is a list — the keys of `SlotRegistry`, the fields of
`AdminPropertyOptions`, the parameters in the OpenAPI — so walk it and ask of
each entry "who reads this?". Reading the implementation cannot find these:
what you are looking for is the absence of a call site, and absence is what
reading is worst at.

Nested access defeats naive greps. `property.admin?.disabled.disabledMessage`
does not match `admin.disabledMessage`, and a cast — `(collection as
AdminCollection & { formView?: … }).formView` — does not match
`collection.formView`. A zero result is a lead, not a verdict.

**The fix is not always to implement it.** Where a feature belongs is a product
decision; the *silence* is the bug, and it is fixable on its own. Name the dead
entries in a constant, warn when something registers for one — saying plainly
that the gap is in the framework, not in the caller — and mark them in the
reference.

**Gate it in both directions.** `slot-render-sites.test.ts` derives the dead set
by scanning for render sites and fails when it disagrees with the constant: a
newly declared-but-unrendered entry fails until it is admitted, and an
implemented one fails until it is removed. Without the second direction the list
keeps warning about something that has started working, which teaches people to
ignore it. And assert the scan found a plausible number of entries, or a broken
parse passes by comparing two empty lists.

---

## 22. A dynamic write from a data-derived key

`setIn(values, path, value)` writes a form field at a dotted path. Nothing
stopped the path from naming the prototype chain:

```
setIn({}, "__proto__.polluted", "x")   // every object in the process gains it
setIn({}, "constructor.prototype.y", "x")
setIn({}, "__proto__.0", "x")          // and every array gains [0]
```

`res["__proto__"] = …` is a setter for the object's prototype, not an own
property, so the write leaves the object entirely.

The keys are the point. A path here is a property key, and for a map property —
or a column mapped out of an imported CSV — property keys are *data*. The rule
is that any `obj[key] = value` where `key` came from outside the program is this
class, whether or not the surrounding code looks like parsing.

**What made it exploitable is worth studying, because it looks like the
opposite.** Two copies of this function exist. The one in `@rebasepro/utils`
survives the write by accident: its `clone` always spreads into a fresh object,
so `clone(Object.prototype)` is a copy and the write lands there. The form
engine's `clone` carries an extra branch — *preserve class instances, don't
spread them* — which returns `Object.prototype` **itself**, since its prototype
is `null` rather than `Object.prototype`. A defensive special case, added to
protect `EntityReference` and `GeoPoint`, is what converted a contained write
into global pollution.

**Sweep:** every `obj[expr] = …` and every `delete obj[expr]` where `expr` is
not a literal. Then ask where the key comes from — a property name in a config
is still data if the config is generated by introspection or edited in a UI.
Grep for `setIn`, `deepSet`, `assignPath`, `merge`, and anything taking a
`path: string`.

**Refuse, do not sanitise.** Stripping the segment writes the value somewhere
the caller did not ask for. Returning the input unchanged is the same no-op the
function already performs when the value has not changed.

**Close the read too.** `getIn(x, "constructor.prototype")` returning
`Object.prototype` is how a polluted value is read back out and rendered, and it
is the half that survived in the copy whose write was safe.

**The sibling the first sweep missed** is the one the paragraph above names out
loud: *a column mapped out of an imported CSV*. `unflattenObject`
(`packages/admin/src/data_import/utils/transforms.ts`) turns the header row of an
uploaded workbook into nested objects one dot-segment at a time, with no guard —
so a column headed `__proto__.polluted` wrote onto `Object.prototype` for the
life of the admin tab, and `constructor.prototype.x` threw `Cannot assign to
read only property 'prototype'`, which the user saw as an unreadable file. It
was the only copy whose keys are attacker-supplied **by design**, and it was
missed because the sweep grepped for the function names (`setIn`, `getIn`,
`mergeDeep`) rather than for the shape. Its three neighbours in the same
pipeline — `mapJsonParse`, `flattenEntry`, and the header loops in
`file_to_json.ts` / `csv.ts` — all write `obj[header] = …` and all needed the
same refusal.
---

## 23. A platform limit that clamps instead of rejecting

`setTimeout` stores its delay in a 32-bit signed integer. Hand it more than
2,147,483,647 ms — about 24.8 days — and Node does not throw and does not wait:
it clamps the delay to **1 ms** and fires immediately. The only signal is a
`TimeoutOverflowWarning` on stderr, which in GKE is scraped as `ERROR` severity,
so the first thing anyone hears is an alert about "application errors" from a pod
whose own logs say `INFO`.

The cron scheduler had a floor on its delay — `Math.max(rawDelay,
MIN_SCHEDULE_INTERVAL_MS)`, added to stop tight loops — and no ceiling. A monthly
job (`0 4 3 * *`) computes its next slot ~30 days out for most of the month, so
it overflowed, fired at once, lost the claim race against the row it had itself
just inserted, logged *claimed by another instance*, rescheduled, and overflowed
again: **112 iterations a second, indefinitely**, 1.9 GB of logs a day and a
`cron_claims` INSERT per iteration. It survived pod restarts, because the claim
that made it skip is a persistent row. A monthly cron is not an edge case; the
overflow window covers most of every month.

The tell is **arithmetic reaching an API with an undocumented range**. A floor
without a ceiling is the specific smell: someone already knew the input was
untrusted and bounded one side of it.

**Sweep:** grep for `setTimeout`/`setInterval` whose delay is an expression
rather than a literal — `grep -rn "set\(Timeout\|Interval\)(" --include=*.ts |
grep -v "[0-9]_\?[0-9]*)"`. For each, ask what the largest value the expression
can produce is, not what it usually produces. Same question for `setSeconds`,
array pre-allocation, and anything typed `int` on the far side of a driver.

**Watch for:** the clamp being only half the damage. Firing early is recoverable;
what made this permanent is that the early fire **claimed the slot**, and claims
are forever, so the real run would have been skipped when it finally came due —
a silent data-staleness bug outliving the noisy one. Any guard that records
"this was handled" must be reached only on the path that genuinely handled it,
and a wall-clock check is cheap next to a timer you cannot trust.

---

## 24. Work that grows faster than the input

A caller sends a few hundred bytes and the process spends a minute on it. Three
in one sweep, all reachable from a query string:

* **`?title=like.%25%25%25…`** — `%` becomes an unbounded quantifier, so a run
  of them is adjacent quantifiers, and on a subject that does not match the
  engine tries every way of splitting the subject between them. Fourteen `%`
  against a forty-eight character value: **87 seconds**. In the browser that
  freezes the tab; in the Mongo driver the expression goes to the database as
  `$regex`, so it is a database thread.
* **`?or=(or(or(…)))`** — a recursive descent parser with no depth limit,
  reaching `RangeError: Maximum call stack size exceeded`, and quadratic below
  that because each level rescans the string it was handed.
* **a token lifetime past 24.8 days** — not superlinear but the same family: a
  value from outside decides how much work happens, and nothing bounds it.
  (That one is class 23.)

**The question is not "how long does this take?" but "what is the worst input
of this size?"** Every one of these is instant on the inputs anyone tries by
hand. The tell is a *transformation from user input into a program* — a regex, a
parse tree, a query — where the input controls the program's shape rather than
just its values.

**Sweep:** `new RegExp(` with a non-literal argument, then ask whether the
argument can contain two adjacent quantifiers. Every recursive function whose
input is a request field. Then any loop whose bound is a length rather than a
constant.

**Do not accept "the HTTP layer stops it" as the bound.** Node's 16 KB header
cap is what keeps the nesting parser below a stack overflow today. That is a
default on a different component, changed by one flag, and it is not a fact
this parser knows.

**Prefer normalising the input to rejecting it, where the semantics allow.** A
run of `%` means exactly what one `%` means, so collapsing it is free and
nothing is refused. Nesting depth has no such collapse, so it is a 400 — and
the message says which parameter, because a `RangeError` about the call stack
tells the caller nothing about their filter.

---

## 25. A floating layer painted under the thing that opened it

A dropdown, popover or tooltip is portalled out of the DOM subtree it belongs to
and re-attached at the document root, where it is a *sibling* of every dialog and
sheet rather than a child of one. Its stacking is then decided by `z-index`
against those siblings, and any value below theirs puts it behind the overlay.
The element is in the DOM, `visibility: visible`, correctly positioned, and
completely invisible and unclickable.

The overflow menu in the entity identity bar carried `z-30`; `Dialog`'s container
is `z-50` and `Sheet` is `z-45`+. So the three-dot menu did nothing in dialog mode
and in the side panel, while working in full screen — where there is no overlay to
lose to. Radix compounds it: `PopperContent` reads the computed `z-index` off the
content and copies it onto the wrapper it portals, so the one class governs both.

**Sweep:** for every portalled floating component, compare its `z-index` with the
overlays it can be opened from. `grep -ln "Portal" packages/ui/src/components/*.tsx`
then read the z-index out of each. The survey found `Menu` at 30, `Popover` at 40
and `MenubarContent` with **none at all** (so, `auto`), against `Select`,
`Tooltip`, `MultiSelect`, `Dialog` and `Sheet` already on 50. The three low ones
were the three that were broken.

**Watch for:** the absent case being the worst one. A missing `z-index` reads as
"no opinion" and is easy to skip while auditing numbers, but it resolves to `auto`
and loses to *everything* positioned. And prefer one shared tier over a ladder:
peers on the same `z-index` stack by mount order, which is already the right
answer — a menu opened from a dialog mounts after it, and a dialog that menu opens
mounts after them both. A ladder has to be re-derived every time a layer is added,
and the stacked-sheet case (`45 + index * 10`) climbs past any fixed value chosen
for the menus.

---

## 26. A flag written and read in one event, through a closure older than the write

`setState` during an event handler does not change anything the handlers already
captured. If the same event then invokes a callback that was built in an earlier
render, that callback reads the **previous** value — and if the flag is written
only from the same button that triggers the read, it is never observed on the
click that set it. It is observed on the *next* one, which is what makes this look
like an intermittent bug rather than a deterministic one.

"Save and close" set `pendingClose = true` and called `formContext.submit()` in
one handler. The form's `onSaved` — captured before that render — read
`pendingClose` as `false`, so the record saved and the panel stayed open. The flag
stayed raised, so the *following* save closed the panel. Both halves are the same
defect, and the second half is worse: the panel closed on a save nobody asked to
close it on.

**Sweep:** find state whose only reads are inside callbacks rather than in JSX.
For each `useState` in a controller or context, ask whether any consumer reads it
outside a render — an `onSaved`, an `onSubmit`, a promise `.then`. Those are refs
misspelled as state. Rendering from the value is what makes it state; nothing
rendered `pendingClose`.

**Watch for:** the flag left raised when the action it was set for never completes.
Once the read is fixed the leak becomes reachable, because a stale `true` now
actually fires. Lower it where the operation settles, not only where it succeeds —
`Promise.resolve(submit()).finally(...)` — or a rejected validation leaves a
"close after save" armed for whatever saves next, including a keyboard ⌘S.

---

## 27. One list, two meanings — a toolchain that reads "everything declared" as "everything I own"

A directory holds every collection a project declares, whatever engine serves
it: that is what `dataSource` routing is *for*. Every stage of the SQL toolchain
read that directory as "the tables". So a Firestore collection declared next to
the Postgres ones got a `pgTable` in the generated schema, a `CREATE TABLE` and
RLS policies at boot, and an entry in the `db push` include list — while the app
went on reading its documents from Firestore, and `rebase doctor` reported the
untouched store as drift.

The symptom that surfaced it was the mildest one: `rebase dev` printing "your
schema may be out of sync, run `rebase schema generate` / `rebase db push`" every
time a `collections/firestore/exercises.ts` was saved. Advice that is wrong on
every edit is worse than none — the same box is the only warning for the Postgres
collection next to it, where it is real.

**Sweep:** for each generator, ask what subset of its input it is entitled to.
`grep -n "for (const collection of collections)"` across the engine-specific
package, and check each entry point takes the filter rather than trusting its
caller. The filter belongs at the exported boundary, not in the caller: these
functions have four callers each (generate, push, boot, doctor) and a rule
applied in three of them is a rule that does not exist.

**Watch for:** the include list. Most of the outputs here were inert — an empty
table nobody writes to. The exclude list `db push` builds is the inverse of the
include list, so a name wrongly *included* is a name Atlas is allowed to **drop**:
a Firestore collection called `exercises` removed a real, unrelated
`public.exercises` table's protection from the next auto-approved push. When a
filter is wrong in one direction the blast radius is waste, and in the other it
is data loss — find out which one you have before deciding it is cosmetic.

**Watch for, too:** the fallback direction, and it is not the same at build time
and at run time. Boot can resolve a collection's engine exactly, because it holds
the initialized data sources; the CLI cannot evaluate the project's backend and
has to read the declaration. Unknown there means "assume SQL": generating a table
nobody writes to is recoverable, silently not generating one the app serves from
is not.

---

## 28. Two navigations for one action, and nothing decides which one lands

One event, two pieces of code that each believe they own where the app goes
next. A component navigates as part of finishing its own job — a post-save
`replace` from `…/edit` onto the record's URL — and in the same handler a
caller-supplied callback navigates somewhere else entirely, because the user
asked to close. Both calls run. Only one destination survives, and which one is
not written down anywhere: it is decided by the order two statements happen to
appear in, across two files that were not written as a pair.

Adding a close button to the split view's edit form landed exactly there. The
form's `onSaved` ran the layout's post-save navigation *and* the close
navigation. The record saved and the panel stayed open. Deferring the close by
one tick fixed it, which is the tell — a fix that only changes *when* a call
happens is a fix to an ordering nobody had chosen.

**Do not assume the router drops one.** The reflex explanation — "the second
navigation arrives while the first is still settling and is silently ignored" —
is wrong for react-router 8, and it is worth knowing which way round it is
before writing a fix that depends on it. Pinned in
`packages/admin/test/components/router_two_navigations_one_handler.test.tsx`:
against a data router (`createBrowserRouter`, which is what the app boots), the
**last call wins** in every shape — push after replace, push after push, `-1`
after replace, replace to the URL you are already on, both from an async
continuation, with an unsaved-changes blocker mounted. So the failure is not a
dropped call; it is the *wrong* call being last. Deferring works because it
moves the close to the end, not because it gives the router room.

**Sweep:** not "two `navigate()`s in one function" — grepping `navigate(` misses
the case twice over. The second navigation is usually a *callback* whose body is
in another file, and the first is often a controller method that never says the
word. Ask instead: for each handler, how many of the things it calls are allowed
to change the URL? Count `navigate`, every controller method that wraps it
(`sidePanelController.replace`, `sideDialogsController.close`,
`urlController.navigate`), and **every caller-supplied callback**, which is
allowed to do anything. Two or more is the smell; the ordering between them then
has to be deliberate and commented, or collapsed to one.

The sweep of `packages/admin/src` found one live sibling and one seam.
`SidePanelBinding.onUpdate` reached three — `props.onUpdate?.()`, then a
`replace` or `closeEditView()`, then `closeAfterSave()`. Its "save and close"
path worked only because the close happened to be last; the reference picker's
path is the same three in the *other* order, so the close lost. It now raises
exactly one panel navigation — closing wins by construction, because moving a
panel to an address it is about to leave has no other effect than fighting the
close — and calls the opener's `onUpdate` last, so the opener's own navigation
is the final word. `packages/app/src` is clean by construction: it contains no
`navigate` call at all.

**Watch for:** a caller-supplied callback counting as a navigation. `onUpdate`,
`onSaved`, `onClose`, `onEntityClick` — a component cannot see what these do,
so a handler that invokes one and then navigates has *already* raced, whether or
not today's callers navigate. `EditViewBinding.onSaved` fans out to two of them
(`onSaved` and `formProps.onSaved`) with no in-repo caller for the second; that
one is unreachable today and reachable by anyone embedding the panel.

**Watch for, too:** the pair that no longer refers to the same thing. Two
navigations for one action tends to come with two *stack* operations, and the
second was written assuming the first had not run. In the reference picker,
`close()` pops the top panel and the `replace()` after it then wrote into the
slot below — so the panel the user asked to close stayed open and the one they
came from was destroyed. Reordering alone would have left that half standing,
which is why the fix removes the pairing instead: the handler either closes or
replaces, never both. Two *closes* in one tick are fine and are now relied on —
they pop two panels, because each reads a ref the previous one already wrote.

---

## 29. The fallback branch that stubs out the contract the primary one honours

One operation, two implementations chosen at runtime: a live one and a one-shot
one. The live implementation returns a real teardown, and everything downstream
is written against that — a `useEffect` cleanup, a `cleanupSubscription()`, a
ref holding "the current unsubscribe". The one-shot implementation returns
`() => {}`, and every one of those mechanisms goes on calling it, getting
nothing, and reporting success.

The contract is satisfied by the type and not by the behaviour, which is why it
survives review: the signatures match, both branches return a function, and the
call sites are identical. What differs is that one of them can actually stop
something.

`useCollection`, `useFetch` and `useRelationSelector` each had this pair. The
live branch (`accessor.listen` / `listenById`) unsubscribes on cleanup; the
fallback fired a promise and returned an empty function. The effects' own
dependencies — the search string, the filters, the sort, the page, the entity
id — all change while a request is in flight, so the surviving result was
whichever response the server happened to finish last, and responses do not
come back in the order they were asked for. Typing into a collection search
could settle on the results for a prefix of what you typed, with the spinner
already cleared and nothing to indicate it.

**Sweep:** grep the stub, not the concept — `return () => {}` and
`= () => {}` in any position where a caller will hold the result as a
cancellation. Four in the workspace, three of them this bug. Then read *both*
sides of every branch that returns a teardown and ask what the empty one was
supposed to stop.

**Watch for:** which branch the deployment actually takes. Both live methods
here are assigned under `if (ws)` — the client defines them only when it has a
websocket — so the guarded path is the one that runs in development and the
stubbed path is the one that runs anywhere realtime is off. The safer-looking
half of the code is the half that gets exercised; the fallback is reached by
the configurations least likely to be tested, which is the same reason it was
written more carelessly.

**Watch for, too:** a promise is not a subscription and cannot be made into
one. The fix is not to find a cancel method — it is for the cleanup to *disown*
the result (`let cancelled = false` … `if (cancelled) return`). The request
still completes and its answer is still paid for; what changes is that it is no
longer allowed to write into a slot that has moved on.

---

## 30. A claim on a shared input that the mechanism cannot actually make

A component knows it is sharing something global — a key, a scroll container, a
drag — and writes the line that claims it. The line is real, the API exists, and
in the position it was written from it does nothing at all. Nothing throws,
because the call is valid; it simply governs a different axis than the one the
author needed.

Escape in the panel: `EntityInspector` claimed the key with `stopPropagation()`
from a `window` listener, while the split view held its own `window` listener
that closes the record. `stopPropagation` governs an event's travel *between*
elements and says nothing about the other listeners on the element it is called
from, so both ran — and pressing Escape to dismiss the inspector navigated the
whole record panel away with it.

The sibling half is worse: `stopImmediatePropagation` *would* have stopped it,
and would still have been wrong, because same-element listeners run in
registration order and the layer that opens later registers later. A component
that only exists while it is open can never claim a key from a component that
has been mounted since the route loaded. Precedence that depends on mount order
is not precedence.

**Sweep:** for every global listener, write down the *element* and the *phase*,
not just the event. `grep -n 'addEventListener("keydown"' -r` gave nine in the
panel across `window` and `document`, capture and bubble. Owners on the same
element in the same phase cannot arbitrate between themselves at all; a capture
listener on `document` runs before every bubble listener on `window`, and there
`stopPropagation` is sufficient and mount-order-independent. That is the idiom
the relation and user selectors already used, so the fix was to stop inventing
a second one. Pinned in `escape_key_ownership.test.tsx`.

**Watch for:** the ad-hoc precedence rule that is already there. The split view
skips its Escape handling when `document.querySelector('[role="dialog"][data-state="open"]')`
matches — a real rule, hard-coded, and silent about every overlay that is not a
Radix dialog. The inspector is `role="complementary"`, so it was invisible to
the one guard written to protect it. A precedence rule expressed as a selector
against someone else's markup only covers the cases its author could enumerate.

**Watch for, too:** proving the mechanism before fixing the instance. The first
harness written for this dispatched the event on `window`, where the event's
path is one element long and never reaches `document` — every capture listener
in the app looks dead under it, and the "fix" it endorses is the wrong one. A
keystroke targets the focused element. Test the propagation path you actually
have.

---

## 31. A quantity read from outside, parsed but never checked

`parseInt`, `parseFloat`, `Number` and `JSON.parse` all answer *something* for
input they cannot read: `NaN`, or a value of the wrong shape. None of them
throws, so the check has to be written, and it is the kind of line that reads
like noise next to the parse that "obviously" worked.

Three properties make this class worth sweeping as one rather than fixing one at
a time. The input is almost always **aged** — a port file, a `localStorage`
entry, a spreadsheet column, a query parameter — so it was written by something
that is no longer running and no longer agrees with the reader. The failure is
**silent**, because `NaN` and `undefined` flow onward and fail somewhere else.
And the sites come in **pairs**, one checked and one not, because the check gets
written the first time somebody is bitten and not propagated to its twin:

| checked | its unchecked twin |
|---|---|
| the dev-server port *file* — range-checked, with a test naming "0", "-1", "65536", "not-a-port" | `process.env.PORT`, one line above, straight to `parseInt` |
| `SplitListView.getSavedPanelSize` — `!isNaN(val) && val > 0 && val < 100` | two other stored pane sizes, bare `parseFloat` |
| `?where=` — malformed is a 400, and the docblock says why | `?orderBy=`, six lines below, whatever `JSON.parse` returned |
| the `vector` import branch — empty string to `null`, NaN to a default | the `number` import branch, twelve lines below, bare `Number` |
| `rebase_sql_tabs_*` read inside a `try` | the *same key*, read again in a `useState` initializer |

**Sweep:** `grep -rnE "parseInt\(|parseFloat\(|Number\(|JSON\.parse"` and, for
each hit, ask what the function returns for input it cannot read and whether the
next line can tell. Then look for the sibling: the same value read somewhere
else, the same parameter parsed by the neighbouring branch.

**Watch for:** `Number("")`, which is `0` and perfectly finite. It is the one
value in this class that survives an `isFinite` check, and it turns "nobody
filled this in" into a real quantity — a zero price, a zero quantity, a pane
sized to nothing. `GeopointFieldBinding` carries a comment about exactly this;
the importer did not.

**Watch for, too:** a parse in a `useState` initializer. It runs during render,
so what it throws takes the view down — and the value that threw is still in
storage on reload, so the view stays down. That is the difference between a bad
value and a bricked screen, and it is why the fix is a helper that cannot throw
rather than a `try` at each site.

---

## 32. A portalled layer that escapes a modal's scroll lock

The sibling of class 25, through the same seam and with a different symptom. A
modal — `Dialog`, `Sheet` — wraps itself in `react-remove-scroll`, which adds a
`wheel` listener on `document` and calls `preventDefault()` on every event whose
target is not inside the lock or one of its declared shards. So a popup portalled
to `document.body` while a modal is open is *outside* the lock: it opens, it is
positioned, it is clickable, arrow keys move through it — and the wheel does
nothing. Dragging its scrollbar still works, which is what makes the report
"scrolling is broken sometimes" rather than "the dropdown is broken".

The repo already had the answer: `PortalContainerContext`, which a modal supplies
and every popup reads to portal *inside* the lock. `Sheet` supplied it; `Dialog`
did not, and `RelationSelector` and `UserSelector` ignored it either way —
`const portalContainer = document.body`, under a comment saying "use Sheet portal
container if available". So the relation picker was unscrollable in every dialog
and every side panel, and everything else was unscrollable in dialogs only.

**Sweep:** `grep -rn "document.body" packages/*/src --include=*.tsx` for portal
targets, and check each modal actually *provides* a container as well as
consuming one — `usePortalContainer` without a matching `PortalContainerProvider`
around its own content is a modal that only forwards someone else's host.

**Watch for:** a host that is inside the lock but *behind* the paper. Fixing the
scroll by portalling inward walks straight into class 25 — the paper carries
`z-60`, the popup `z-50`. `Dialog`'s host is `relative z-70 w-0 h-0`: positioned
and stacked so it wins, sized to nothing so it changes no layout.

**Watch for, too:** the global stylesheet that decides *which* element scrolls.
`useInjectStyles` writes to `document.head`, so a rule keyed on a bare
`[cmdk-group]` from one component governs every cmdk list on the page. `MultiSelect`'s
`max-height: 45vh` was landing inside the relation and user pickers, which set
their own height on the list — two nested scroll containers of near-identical
height, so the outer one never overflowed and the infinite-scroll listener bound
to it never fired once.

---

## The discipline

When you find a bug:

1. **Name the class** before fixing it. "Empty user table admits the first
   registration" is a one-line fix. "Zero-state of a counted resource" is a
   half-day sweep that closes the next five.
2. **Sweep for siblings** using the recipes above, and write down what you
   checked *and found clean* — that is what stops the next person re-running the
   same search.
3. **Fix the class, not the instance.** One predicate, one implementation.
4. **Gate the class, not the bug.** Pin agreement or invariants, not the specific
   input that failed.
5. **Prove the gate fails.** Break the fix on purpose and confirm the new test
   goes red. Every gate added in this repo's recent history was verified that way,
   and one of them — an RLS probe — was found to be vacuous precisely because
   nobody had.

### Last sweep — 2026-07-28

Triggered by `732d0b6` (empty user table admits the first registration).

| checked | result |
|---|---|
| `getCapabilities()` vs `/auth/register` | **BUG** — missing the kill switch, and it is the live handler. Fixed. |
| `disableSelfRegistration` plumbing | **BUG** — never reached the adapter, so unreachable in production. Fixed. |
| `passwordReset` capability vs `/auth/forgot-password` | clean — both read `isEmailConfigured()` |
| `magicLink` capability vs magic-link routes | clean — route guards on the same predicate |
| API-key permission guard on an empty list | clean — fails closed by construction |
| `assertKnownWriteFields` on a collection with no properties | clean — documented, and deliberately not read as "deny all" |
| aged-database upgrade path | **UNCOVERED** — no test existed. Added. |
| empty-database first-run path | **UNCOVERED** — no test existed. Added. |
| `harness preflight` migration-order, merge-safety half | **BUG** (class 4) — had never run once. Fixed. |
| every saas gate | **UNCOVERED** — 1606 backend and 685 frontend tests ran in no pipeline. Added. |

The migration-order finding is worth repeating, because it is class 4 in its
purest form. The check reads `saas/backend/drizzle/meta/_journal.json` and
compares it against main, and `saas/` is gitignored in the monorepo and is its
own repository — so `git show <base>:saas/backend/...` at the monorepo root fails
with "exists on disk, but not in HEAD". `sh` swallows that to `""`, the
comparison returned null, the loop was skipped, and the summary line still read
*"strictly ordered, including against main"*. The half that had never run is the
half the check exists for: a lone journal is trivially monotonic, and two
branches racing is the entire failure mode. A green line for work that never
happened, in a gate written specifically to stop a class of silent skipping.

### Last sweep — 2026-07-31

Triggered by a release-readiness pass over the four paths a 0.13 has to keep
working: `init → dev → admin`, self-host, local → cloud, and the client SDK.

| checked | result |
|---|---|
| admin-panel Playwright suite on an **empty** database | **BUG** (class 1) — `globalSetup` waited for a "Sign in with email" button that first-run never renders, failing all ten tests at once. It passed locally only because a developer's database already has the demo user. Fixed, and it now drives the bootstrap form, so first-run is covered. |
| `client.close()` releasing every handle it claims to | **BUG** — released the socket, channels and offline manager, never the scheduled token refresh. Any signed-in Node script hung forever after closing. Fixed; pinned by `client-close.test.ts`. |
| `db push` advice when the atlas binary is missing | **BUG** (class 5) — the suggested command reproduces the state it is meant to fix. Fixed. |
| OSS → cloud breakage detection | **PARTIAL** — saas CI is the only gate on the seam and ran solely on saas's own pushes, so a change merged here is invisible until somebody happens to push there. Added a nightly to saas CI. Deliberately *not* a push-triggered dispatch from this repo: that needs a token with write access to the private repo stored in the public one, and it buys hours of latency against a backstop that already exists — the deploy path builds saas, so the seam cannot break a release silently. |
| end-user auth → RLS → storage → realtime via the SDK | **UNCOVERED** — every tier was tested and their composition was not (client tests mock the transport, `rls-enforcement` has no HTTP, the BaaS e2e uses a service key and so never exercises RLS). Added `client-sdk-e2e.ts`. |
| bundle format / runtime contract / auth schema versioning | clean — all three are stamped, checked, and fail loudly. Written up in `docs/compatibility.md`. |
| `cli-init-e2e` installing from real tarballs | clean — it packs and installs real tarballs, not workspace links |
| undeclared runtime dependencies | clean — `pnpm check:deps` green |
| `AUDIT-2026-07-28` finding A ("21 Playwright tests") | **STALE** — it is 10; the count came from grepping `test(` textually. Corrected. |
| every other user-facing message naming a command (class 5 sweep) | `google-auth-library`, `nodemailer`, `@google-cloud/storage`, `ts-morph` — all advise `pnpm add`, and none of the four declares an install script, so the advice does resolve the state. Clean. The `rebase …` suggestions in `doctor.ts`, `policy-drift.ts`, `bundle.ts` and the cloud commands all name a command that changes the state that produced them. Clean. |
| `init.ts` ts-morph advice | **BUG** (class 5, milder) — said `npm install` inside what is always a pnpm workspace, where npm rewrites `node_modules` into a layout pnpm then disagrees with. Advice that damages the project. Fixed. |

Two of these are the same shape as the migration-order finding above: a gate
that exists, is correct, and never runs. `saas` CI could not see this repo's
commits, and the Playwright suite could not survive CI's database. In both cases
the work had been done and the wiring had not, which is cheaper to find by
asking "when does this actually execute?" than by reading the assertions.

### Last sweep — 2026-08-01

Triggered by a mutation-testing campaign over every package, and a read of all
402 test files. Mutation scores at the start (comment-masked, sampled):
`common` 72%, `client` 59%, `server-postgres` 48%, `inference` 40%,
`server-mongo` 37%, `cli` 31%, `server` 33%, `admin` 12%.

| checked | result |
|---|---|
| `requireAuth` on the Postgres and Mongo sockets | **BUG** (class 10) — an explicit `requireAuth: true` resolved to `false` without a local `jwtSecret`, marking every connecting client authenticated. Both fixed, fail closed, warn at boot. |
| `DatabaseAdapter.initializeWebsockets` arity vs `BackendBootstrapper` | **BUG** (class 11) — four parameters against five, so the AuthAdapter was dropped and secure-by-default was lost through `createPostgresAdapter`. Fixed and pinned. |
| Mongo `clientSessions` map | **BUG** — module-level, shared by every socket in the process; two servers read each other's sessions. Scoped to the factory, as Postgres already was. |
| `parseSubPath` and a literal `undefined` segment | **BUG** — `/authors/123/undefined/posts` was answered with `/authors/123/posts`. Now 404. |
| `S3StorageController.deleteObject` on a missing key | **BUG** — 200 on AWS, 500 on MinIO/Ceph. Idempotent now, matching the local controller. |
| `Bearer` scheme case-sensitivity | **BUG** — against RFC 7235 §2.1; `bearer` was a 401 indistinguishable from a bad token. Fixed. |
| client `where: { f: ["==", undefined] }` | **BUG** — serialized to `f=eq.undefined`, a search for the literal string. Now refused, because silently dropping the condition returns the query *unfiltered*. |
| `count()` forwarding `include` | **BUG** — a non-matching join drops rows, so the total disagreed with the `find()` it describes. |
| enum labels in generated DDL | **BUG** — interpolated unescaped, and emitted twice for two collections on one table. Both fixed. |
| `singularize("knives")` | **BUG** — `"knif"`, and `archives → archif` with it. Closed f/fe map. |
| `getInferenceType(null)` | **BUG** — `"map"`, disagreeing with `inferTypeFromValue` on the same value (class 2). |
| `buildPropertiesOrder` | **BUG** — overwrote the caller's order and sorted it in place. No internal callers. |
| `fromSerializableCollectionConfig` relations | **BUG** — rebuilt property thunks but not the collection-level array; imported tables threw "target is not a function". |
| `<Alert severity="error">` | **BUG** (class 12) — a prop that does not exist, silently dropped by React. |
| `VirtualTable`'s generic | **BUG** (class 12) — discarded by `React.memo`; the exported component was not generic. |
| `packages/app/test/components/useBoardDataController.test.ts` | **BUG** (class 3) — never imported the hook, and could not: it lives in `admin`, which depends on `app`. Rewritten in `admin`. |
| `VirtualTable.performance.test.tsx` | **BUG** (class 3) — ~300 lines that never ran; it triggered a `ResizeObserver` the mocked `react-use-measure` never constructs. |
| `reset-password-admin`, `admin-users-ids-lookup` | **BUG** (class 8) — no 401 or 403 at all, so dropping `requireAdmin` passed. |
| `websocket.test.ts` admin gate | **BUG** (class 8) — stubbed the token verifier to return an admin unconditionally, so only the happy path could ever run. |
| `mfa-service.test.ts` | **BUG** — counted calls without reading the statements; dropping `AND uid = …` from a factor delete passed. |
| every method on `DatabaseAdapter` vs `BackendBootstrapper` (class 11 sweep) | clean apart from the fix above — `initializeRealtime` takes a `config` on one side and not the other, but every implementation names it `_config` and ignores it, so nothing is lost. The other seven agree parameter for parameter. |
| every security flag consumed negated (class 10 sweep) | clean — the only `authenticated: !flag` sites are the two sockets fixed here. `resolveRequireAuth`, `openapi-generator`'s `requireAuth ?? true` and the API-key guard all default closed. |
| the HTTP and socket answers to "is auth required?" | **BUG** (class 2 + 10) — two implementations of one predicate, disagreeing in the open direction: with no auth configured, `/api/data` answered 401 while the socket served the same rows. Extracted to `resolveRequireAuth`; both call it, and the tests pin agreement rather than restating answers. |
| test directories invisible to tsc | **BUG** (class 7/12, systemic) — six more packages added to `tsconfig.tests.json`; 47 errors fixed, no `as any`, no `@ts-ignore`. |

The two socket findings are worth keeping together, because they are the same
bug reached two different ways: once by a boolean expression that inverted its
own meaning, once by a type signature that silently ate the argument which would
have made the expression irrelevant. Neither had a test, and the test that
existed for the gate stubbed the verifier so that it could not have failed.

---

### Last sweep — 2026-08-03

Introspection: reading a schema's structure instead of mirroring its tables. The
work was a feature, but it was done against four databases loaded into a real
PostgreSQL server rather than against built fixtures, and every finding below is
something only a real schema produced.

| checked | result |
|---|---|
| every generated collection, put through `ts.createProgram` | **BUG** (class 13) — `icon` and `propertiesOrder` were emitted at the top level of a `PostgresCollectionConfig`, which declares neither. Every file introspection has ever written was a type error, and the admin panel never read either value. Now nested in `admin`, and pinned by compiling the output of four real schemas. |
| a self-referencing foreign key (`northwind.employees.reports_to`) | **BUG** (class 13) — the file imported its own default export: `TS2440`. Both sample schemas that have a manager column hit it. |
| `!extra.includes("min:")` as a "already set?" guard | **BUG** (class 13) — `admin:` ends in `min:`, so every property with an admin block dropped its declared minimum. |
| `information_schema.tables` against a partitioned table | **BUG** — pagila's `payment` is partitioned by month, and every partition was reported as a base table. 70 tables in, 70 collections out, 26 of them `payment_p2022_*` with their own navigation entries. Reads `pg_class` and excludes `relispartition` now. |
| foreign keys on a partitioned table | **BUG** — pagila declares `payment`'s three keys on each partition and none on the parent, so reading `pg_constraint` at face value left the `payment` collection with no relations at all. Attributed to the partition root, deduplicated. |
| `information_schema.constraint_column_usage` for composite keys | **BUG** — reports the cross product of the constraint's columns, so a two-column key comes back as four rows, two of them pairing the wrong columns. Replaced with `unnest(conkey/confkey) WITH ORDINALITY` joined on the ordinal. |
| `array_agg(a.attname)` through node-pg | **BUG** — no parser exists for an array of `name`, so the driver returns the literal string `{a,b}`. Every consumer indexes it as an array and would have failed silently. `::text` added. |
| `film.fulltext` (`tsvector`, NOT NULL, trigger-maintained) | **BUG** — emitted as a required free-text field, so every create through the panel was impossible. Read-only and hidden from the list now, along with generated columns. |
| the name-based `created_at`/`updated_at` check | replaced for classification purposes by "temporal column with a transaction-clock default", which catches pagila's `last_update` and a schema written in any language. The name-based branch stays for `autoValue`, which is a separate question. |
| `identifyJoinTables`, which decided by column name | superseded for the CLI by structural classification: two single-column keys, unique together, no payload, nothing referencing it. `northwind.order_details` has the key shape and three payload columns — the old rule folded it into a many-to-many and dropped price, quantity and discount from the UI. |

### Sweep continued — 2026-08-03, ten more real databases

The first pass ran against three sample databases. Three is not a sample: they
are all small, all normalized the same way, and all written to teach SQL. The
sweep was repeated against every real Postgres schema that could be fetched and
loaded — GitLab (1049 tables), MusicBrainz (374), Discourse (350), MediaWiki
(64), OpenStreetMap (56), Temporal (37), AdventureWorks (68 across five
schemas), plus the original three. Two more bugs, both of which stop a generated
file compiling.

| checked | result |
|---|---|
| foreign key columns not named `*_id` | **BUG** (class 13) — MusicBrainz names every foreign key after the table it points at (`area_tag (area, tag)`), and both columns are in the primary key, so both stayed as properties *and* claimed the relation's key. `area:` was declared twice: TS1117, in 67 of its 339 collections. The existing guard fired only when the stripped name matched the column, which is not the same condition. Now the relation takes the first free key of three candidates, with a numbered tail so it is total. |
| `multiline` / `markdown` on a `body` column | **BUG** (class 13) — emitted at the top of the property, where `StringProperty` declares neither. Six OpenStreetMap tables have a `body` column; the same defect was in the sampled-data inference path, which additionally emitted two `admin: {` blocks in one property when two of its branches fired. Both fixed, and the inference path is now compiled by a test of its own. |
| schemas that declare no foreign keys at all | working as intended, and worth stating: MediaWiki and Temporal declare none, so nothing classifies and every table stays an entity. Structural inference has nothing to read, and inventing relationships from column names is the thing it exists not to do. |
| 1049 tables end to end | clean — 528ms to read the catalog, 99ms to generate, 631 of 1049 tables left in the navigation. |
| five schemas in one database (AdventureWorks) | clean — introspection is per-schema, and each of the five classified independently. |
| duplicate property keys, self-imports, junctions pointing at absent tables, self-owning tables | swept across all ten; after the two fixes above, none. |

### Last sweep — 2026-08-03, the record history panel

Started from "I saved a product and it does not show up in the history view".
The revision was recorded correctly; the panel had no reason to refetch. What
the reproduction walked through found two more.

| checked | result |
|---|---|
| `useHistory`, after a save | **BUG** — refetched on entity id, slug, offset and revert, and nothing else. Save happens from the identity bar *above* the panel, so the panel stays open across it and kept showing the list it fetched when it opened. The save count now joins the entity identity key. |
| the inspector's scrim | **BUG** — `absolute inset-0 bg-black/25` over the whole record, so the first click into the form went to the scrim and closed the panel. A revision list could never be open while you edited the record it belongs to, which is the only time watching it is worth anything. Docked as a flex sibling; both bindings. |
| `/c/products/new` | **BUG** (class 16) — `Database error in "products" [25P02]` rendered as the page. Two defects: an unaddressable id reaching Postgres, and a fallback query re-running inside the aborted transaction. |
| the other four `catch` → `db.select` fallbacks in `FetchService` | same class, same guard. All five rethrow a PG-coded error now. |
| `catch` blocks issuing queries elsewhere in the driver | clean — `PersistService`, `RelationService` and `PostgresBackendDriver` have none. |
| `fetchWithDrizzleQuery` | had the shape, but was **dead** — private, no callers. **Now deleted.** Its one test reached in with `(service as any)`, which is what kept it alive; testing a path nothing runs is worse than not testing it, because the guarantee reads as covered while the path that serves it is not. The assertion it carried — a null relation must stay null, not become `{}` — moved to `row-pipeline-null-relation.test.ts` against `toRestRow`, and was checked by removing the `!== null` guard and watching it fail. |
| `parseIdValues` for numeric keys | already threw, which made `GET /users/abc` a 500 rather than a 404. Both read paths answer "no such row" now, and the two tests that pinned the throw were rewritten to the new contract. |
| whether the uuid check could reject a working app | it could, if taken from `isId: "uuid"` — `getPrimaryKeys` lets the config win over the schema. Read from the Drizzle column type instead (`idCanAddressTable`), and a key the schema does not carry stays addressable rather than 404-ing rows that exist. |
| the gates | broken on purpose, all three times: reverting the identity key reddens 2 of 3 history tests; the id guard and the rethrow have their own. Writing the history test also found that `useHistory`'s fetch callback keys off `apiConfig` identity — a mock rebuilding it per render span 376 fetches before the assertion timed out. Stable in the app, fragile by construction. |

### Last sweep — 2026-08-04, the data path end to end

Started from "no matter where I look I find bugs, or absurd APIs". Followed one
finding — a reactive read that could show stale rows — through every layer it
touched, which turned out to be all of them.

| checked | result |
|---|---|
| `observe()` ordering, without the offline layer | **BUG** — a one-shot `find()` and a socket subscription feed one callback with no ordering guard, so the fetch's older snapshot overwrote a live update that had already arrived. Not narrow: `listenCollection` replays cached rows synchronously to a second subscriber, so a second component watching the same query took that path every time. |
| `observe()`'s documented de-duplication | **BUG** (class 2) — the offline layer de-duplicates, the plain path did not, so every socket tick re-rendered the list. Both key on rows + total now. |
| `listen()`'s pagination metadata | **BUG** — `meta.limit` was `params.limit \|\| 20` against a REST layer that pages by 50; a failed `count()` set `total` to `rows.length`, reporting a 500k-row collection as holding two; and at an offset it claimed a total below the rows already paged past. |
| every `FindParams` field vs. what the in-process accessor forwards | **BUG** (class 17) — `logical`, `page`, and `searchString`-on-count were dropped. `data.posts.where(or(…)).find()` returned every row policy allowed. |
| `limit` reaching the Postgres driver as `undefined` | **BUG** — read as "no LIMIT clause", so an unbounded `find()` selected the whole table into memory while reporting `meta.limit: 20`. The bound the REST layer applies so no read is unbounded did not exist on this path. |
| the four hops between `observe()` and the database | **BUG** (class 17) — `offset` and `logical` dropped at every one, including the server's own stored request, where `offset` was declared in the type and never read. A live list on page three served page one for as long as it stayed subscribed. |
| `createCollectionSubscriptionKey` | **BUG** (class 17) — the de-duplication key was a hand-listed subset, so two subscriptions differing only in `offset` or `logical` collided and the second listener received the first's rows. Derived from the props now. |
| `FetchService.fetchCollection` and `logical` | **BUG** — `fetchRowsWithConditions` below it had always applied the group; it was absent only from the signature, so the only callers who could pass one were those that bypassed the method. |
| what a page is | **BUG** (class 2) — five answers: `DEFAULT_LIST_LIMIT` 50 (REST), `DEFAULT_PAGE_SIZE` 200 (the `iterate()` walk), a second `DEFAULT_PAGE_SIZE` 20 exported by `client`, `?? 20` in the offline manager, and "default: 20" in the published `FindParams` docs. With `offline` on, one `observe()` answered with 20 rows from cache and 50 from the network. One `resolveFindWindow` now. |
| `deriveWebSocketUrl` | **BUG** (class 2) — kept the path of an absolute `baseUrl` and dropped it from a relative one, so one deployment dialled two different sockets depending on how its config was spelled. Off-browser it returned `""`, which the caller read as `realtime: false` — so `channel()` blamed an option the caller never passed (class 5). |
| `baseUrl` already containing `apiPath` | **BUG** (class 5, inverted) — documented as "silently builds `/api/api/…` and every request 404s", and left to runtime. This package's own tests configured it that way twelve times. Warned now, `storageUrlOrigin` with it. |
| `projectResponseFields` keeping the row key | **BUG** — kept the literal column `id`, not the key. `?fields=title` on a collection keyed on `slug` or on `user_id + role_id` returned the unusable row the function's own docblock exists to prevent. All nine of its tests used an `id`-keyed fixture. |
| the rest of the REST layer for the same `id` assumption | clean — the only other literal `"id"`s are the `:id` route parameter, a URL segment name resolved to the real key downstream. |
| `Idempotency-Key` under concurrency | **BUG** (class 19) — recall-then-write is not atomic; two tabs replaying one key both wrote. Claimed in one statement now, with 409 for the loser and a release path so a failed write does not strand the key for a day. |
| `isRebaseApiError` | **BUG** (class 18) — `return error instanceof Error`. It guarded "classify as BAD_REQUEST", so an unreachable database was a 400. Deleted; the driver classifies from the SQLSTATE it already holds. |
| `pnpm typecheck`, `pnpm -r test`, eslint | green throughout — 6,700 tests across 22 packages. |
| `MongoDriver.fetchCollection` / `count` vs. `FetchCollectionProps` | **BUG** (class 17) — eight of eleven fields destructured, and `MongoDataService` had no parameter for `logical` or `offset` at all. `where(or(…))` returned the whole collection, `?offset=` served page one, and `count()` ignored both plus `searchString`. Implemented, forwarded whole, pinned against `mongodb-memory-server`. |
| every `count()` call site against the query it is reported beside | **BUG** ×3 — the count inside `buildRebaseData.find()` passed only `filter`, so a narrowed page carried an unnarrowed total and `hasMore` offered a page that was not there; `usePostgresClientDriver.count` re-listed seven names and dropped `logical`; the REST generator's *nested* `/count` dropped it while its two siblings kept it. |
| every route that returns rows, against `?fields=` | **BUG** — applied on two of four. Both subcollection reads parsed the parameter and returned every column, on endpoints whose OpenAPI lists it first. Invisible because the only coverage called `projectResponseFields` directly, which proves the function narrows a row and nothing about whether a request reaches it (class 3). |
| `buildRoutedRebaseData` | clean — it delegates whole accessors and never re-lists a parameter. |
| `rebase auth reset-password` | **BUG** — looked the user up with `?search=`, an `ILIKE '%…%'` over email **or display name**, took row `[0]`, reset it, and printed the email it had been *given*. `bob@example.com` also matches `robert.bob@example.com`; a display name is user-controlled and unconstrained. `ORDER BY array_length(roles) DESC` puts the most privileged match first, and `limit=1` made the exact match unreachable rather than merely outranked. The command's own direct-DB fallback matched exactly (class 2). |
| the same command's exit code | **BUG** — the fallback ran `process.exit(0)` unconditionally, so resetting a nonexistent address reported success to any script reading `$?`. |
| every `.env` reader in the CLI | **BUG** (class 2) — four: `dotenv` in `start`, a hand-rolled `indexOf("=")` loop in `api-keys`, a one-key regex in `auth`, its own splitting in `cloud env`. `dotenv` is a declared dependency. `export KEY=…` read as unset; `KEY=… # comment` carried the comment into an `Authorization` header and came back 401. |
| CLI telemetry event names | **BUG** — `rebase db <anything>` was recorded as `cli.db_push` and `rebase schema <anything>` as `cli.schema_generate`, so anything counting pushes counted `db restore`. |
| the admin's row count while searching | **BUG** — `EntitiesCount` was given `filter` and `sortBy` but not `searchString`, though the term sits in the same scope and is passed to the toolbar beside it. Its module-level in-flight cache was keyed the same way, so it would also have answered one search with another's total. |
| `useBoardDataController` | **BUG** (class 20) — accepted a search term, re-subscribed every column when it changed, and passed it to none of its three queries. |
| `collection.error` | **BUG** (class 20) — a declared, documented plugin slot, computed and rendered nowhere. |
| every `is assigned a value but never used` in the workspace | **SYSTEMIC** — 155, reported by a correctly configured rule that no pipeline can show, because every lint invocation passes `--quiet`. Ratcheted by `check:unused`. |
| the admin's other 86 discarded values | swept by hand: superseded leftovers, apart from the two above. |

### Sweep continued — the 153 discarded values

`check:unused` produced a list, and the list was worth reading end to end. 88
were in `admin`, 65 elsewhere. The real ones, and — as importantly — what they
were mixed in with:

| checked | result |
|---|---|
| `VirtualTableInput` / `VirtualTableDateField` `disabled` | **BUG** (class 20) — `admin: { disabled: true }` is a public documented option with its own config interface, computed by the table cell, handed down, destructured, and applied to nothing. A `readOnly` property takes a different branch and renders a preview, so only the *disabled* case was live: the cell stayed typeable and the debounced write fired on blur. |
| `CollectionView`'s `canCreate` | **BUG** (class 20) — documented as "shows the + button", destructured with a default of `true`, read nowhere. Not a live permission bypass — the admin gates creation on a different path — but a documented prop of an exported component that did nothing. |
| `SCRYPT_PARAMS` | **BUG**, latent — declared as "recommended values for 2024+" and passed to neither `scrypt` call. Harmless only because they are also Node's defaults, so raising any of them would have read as strengthening password hashing and changed nothing. Passing them needs a cast, which is *why* they were unused. The new risk is the opposite one, so a hash written by the old defaults is now pinned. |
| `useAuthSubscription`'s `authError` | **BUG** (class 20) — every `getUser()` failure caught with "Ignore, user just isn't logged in". True of a 401; not of a 500, a CORS rejection or `Failed to fetch`. `Rebase` renders a full-screen "Error loading auth" view for that field, which was therefore unreachable, and a backend that was down looked exactly like being signed out. |
| `logoutSchema` / `updateProfileSchema` in `auth/routes.ts` | **BUG**, mild — dead duplicates of schemas that live *and are applied* in `session-routes.ts`. Two copies of a validation rule, one unreachable, is a rule that gets tightened in the wrong file. |
| the studio's `SQLEditor` (6 findings) | clean — `setResults`/`setLoading`/`setError` are wrappers the file stopped using in favour of `updateActiveTab` directly, and `STORAGE_KEY_TABS`/`STORAGE_KEY_ACTIVE_TAB` are pre-prefix leftovers; persistence works through `rebase_sql_tabs_${projectPrefix}`. |
| the studio's `StorageView` media detection | clean — shadowed fifty lines later by a version that also matches on file extension, which is strictly better. |
| `useRebaseAuthController`'s `setAuthError` | clean, and worth stating why: `isInitialized()` is constructed with only a `resolve` and can never reject, so the `.catch` beside it is dead. Its `getAuthConfig()` failure *was* swallowed and now warns — not promoted to `authError`, which blanks the whole app and is the wrong response for a signed-in user. |
| `dev-port`'s `attempt`, the admin's `isEntitySelected`, `kanbanEnabled`, `OVERSCAN_COUNT` | clean — superseded leftovers, each replaced by something better a few lines away. |
| destructure-to-omit sites | **false positives** — `const { values, previousValues, ...rest } = props` drops a key on purpose. Marked with a reason rather than cleared by `ignoreRestSiblings: true`, which would have removed 3 findings out of 147 and blinded the rule to a rest-sibling that *should* have been forwarded. |

The ratio is the point: two thirds of the list is dead code, and reading all of
it is how the third that is not gets found. A gate whose output is mostly noise
still earns its keep if the noise is *cheap to classify* — every entry here was
resolved by reading five lines.

| every key of `SlotRegistry`, for a render site | **BUG** (class 21) — 7 of 29 rendered nowhere, while documented in six locales beside the 22 that work. Named, warned on registration, marked in the docs, and gated in both directions. |
| every field of `AdminPropertyOptions`, for a reader | clean, after the `admin.disabled` fix. `clearOnDisabled` is read by `useClearRestoreValue` and `disabled.hidden` by `useColumnsIds`; both looked dead to a naive grep because the access is nested. |
| every field of the admin collection block, for a reader | clean. `formView` looked dead only because it is read through a cast. |
| every query parameter the OpenAPI advertises, against the routes | **BUG** (class 21 + 17) — `limit` declared `default: 20, maximum: 100` against a server that defaults to 50 and clamps at 1000, so a generated client refuses a request the server accepts. The subcollection listing documented four parameters and honours nine. `?or=`/`?and=` are applied on both routes and documented on neither. The two parameter lists were hand-written in two places; there is one now. |
| every flag the CLI's help text names, against what it parses | clean — `--create-db` and `--target-db` live in `backup-cli.ts`, and the rest of the apparent misses are flags inside suggested shell commands (`npm run build --workspace`, `tsx watch --include`, `tar --exclude-from`) or a comment about a flag that was removed. |
| `plugin-insights`, the one shipped plugin | clean — it registers for `home.children.start`, `collection.insights` and `home.card.insight`, all of which render. Notably it does *not* use `dashboard.widget`, which would be its natural home and is one of the seven dead ones. |
| `setIn`/`getIn` in `@rebasepro/forms` | **BUG** (class 22) — prototype pollution through `__proto__`, `constructor.prototype` and array indices, all three confirmed against the shipped code. Refused now, both directions. |
| `setIn`/`getIn` in `@rebasepro/utils` — the second copy | **BUG**, read side. The write is contained only because this copy's `clone` differs; `getIn` still handed back `Object.prototype`. Closed both ways so the two agree. |
| `assertRelationsResolve`'s boot error | **BUG** (class 5) — announced "cannot resolve against the database schema" while reading `schema.generated.ts`, and its remedy named a column the 0.12→0.13 rename had removed. Following it turns a recoverable upgrade into a broken config. Names the file now and leads with `rebase schema generate`. |
| `generateTypedefs` and an unresolvable relation | **BUG** — caught with `/* ignore */`, emitting a `Database` type with no relation fields and none of their foreign-key columns, so the user's own code stops typechecking against columns that exist. Warns now. |
| the cron view's three reads | **BUG** — all three discarded their errors, so a failed read looked like a project with no cron jobs. The view's *initial* load already used the snackbar; only the refreshes did not. |
| `emit` in the SDK's auth | **BUG** — an error thrown by the caller's own `onAuthStateChange` handler was swallowed, so a broken handler looked like an event that never fired. The socket in the same package already reported these. |
| every empty `catch` in the workspace | swept — the other forty-odd are `localStorage`, `unlink` on a temp file, and client teardown, each already carrying a reason. |
| every package, for a `test` script | **BUG** — `packages/firebase` is the only one without, and it *has* five tests. `pnpm -r test` walks the packages that define the script, so they were never reported as skipped; they were never reported. Gated by `check:test-scripts`; not wired, because that needs a lockfile change no worktree can verify. |
| the 181 baselined `exhaustive-deps` findings | **not churned**, deliberately. Sampled the 32 whose missing dependency is query-shaped; the two most promising — `useDataTableController`'s `defaultFilter` and `EntitiesCount`'s `filter` — are both correct as written. `defaultFilter` is an inline object at its call sites, so adding it would reset the user's filter on every render, and `filter` is deliberately keyed through a serialised `filterKey`. The repo's own note on this baseline is right: adding the dependency is as often the bug as the fix. |
| every dynamic write in the workspace (class 22, run properly) | **BUG** — 323 of them; 320 accumulate into a local object under keys from a schema or a config. The three that take keys from a *request body* are in the Postgres transformer, and two were exploitable: `JSON.parse` makes `__proto__` an own property, so it passes `hasOwnProperty` and then replaces the row's prototype. `Object.prototype` is safe; the row is not, and `row.isAdmin` answers `true` while `Object.keys` shows nothing. Reachable only where `assertKnownWriteFields` stands down — a collection with no declared properties, or `strictWrites: false` — which are the configurations that trust the body most. |

### Clicking through the running app

Everything above was found by reading. This is what an hour of actually using
the panel added, which is the argument for doing both.

| checked | result |
|---|---|
| starting the app at all | **BUG** — the frontend's Vite alias list named fourteen workspace packages and omitted `admin-types`, so it resolved to the *primary checkout's* built `dist`. An edit there does nothing in dev and the stale build runs instead, which is worse than nothing happening. The list carried a comment about the last time it was caught missing one (`utils`). Derived from the directory now. |
| the demo's login screen | **BUG** (class 5) — "No account needed … Just click **Sign in with email**", above a button rendered `disabled={!privacyAccepted}` with the checkbox unchecked. The first instruction a visitor is given does nothing and nothing says why. |
| a product card with a missing image | **BUG** — rendered the English literal `"File not found"` while `file_not_found` is translated into seven locales. Which opened the question below. |
| every translated key, against literals in the admin | **BUG**, systemic — 209 strings that have a key are also written out in English, on lines that never call `t(`. Ratcheted by `check:untranslated`, which accepts `t("k") ?? "English"` because a default is not a defect. |
| the list view's search and its count | **verified** — searching `chair` in 200 products showed 4 cards and "All 4 entries loaded". The count fix, working against real data. |
| the kanban board's search | **verified** — 60 cards and a column reading "Open 11" became 4 cards and "Open 2". Both halves of that fix — the subscription and the per-column count — confirmed end to end. |
| the numeric fields on a record | clean, and worth recording as a near-miss: the screenshot appeared to show `28,9` with a comma, which would have been a decimal round-trip bug. `input.value` is `28.9`. I misread a glyph at 1440px, and checking took a minute. |
| `/c/products/new` | clean — "new" is a URL *hash* (`#new`), so that path really is a request for an entity with the id `new`, and the 404 is the intended outcome of an earlier fix. |
| the create form and its validation | clean — required fields flag, and the summary reads "Please fix the highlighted errors before saving." |

The two verified rows are the point of the exercise as much as the bugs: both
fixes were written blind against unit tests, and neither had been seen working.


### Sweep — starting again from main

Everything above had landed; this began from a clean tree and asked what a
*fresh* pass would find. It went straight to the family nothing had looked at:
what a caller can make the process do with a few hundred bytes.

| checked | result |
|---|---|
| class 23's own sweep instruction, run over every timer with a computed delay | **BUG** — `scheduleRefresh` derives its delay from the token's `expiresAt`, with a floor for the past and no ceiling. `auth.accessExpiresIn` is configurable, defaults to `"1h"`, and `"30d"` asks `setTimeout` for 2,591,880,000 ms — past the 32-bit ceiling, so it clamps to 1 ms, refreshes, gets another far-future token and loops. One hot loop per open tab. |
| the webhook retry backoff | **BUG**, latent — `retryDelays[attempt - 1]` where `maxRetries` and `retryDelays.length` must agree and nothing makes them. Out of range is `undefined`, and `setTimeout(r, undefined)` is an immediate retry against an endpoint that just failed. |
| every `new RegExp(` built from a non-literal | **BUG** ×2 (class 24) — the `LIKE` translators in the offline evaluator and the Mongo driver. 87 seconds from a query string. The rest take escaped or developer-controlled input: `hydrateRegExp` reads `validation.matches` out of a collection config, and Mongo's `searchString` is escaped before it becomes a pattern. |
| `deserializeLogicalCondition`, a recursive parser on a query field | **BUG** (class 24) — no depth limit, `RangeError` at twenty thousand levels, quadratic below that. Capped at 32 with a 400. |
| `?include=` repeated ten thousand times | clean — it is a membership test against the collection's own relations, so duplicates cost a longer `includes()` scan and nothing else. |
| the cron scheduler's `timeoutSeconds` | clean in practice — it would need a job timeout over 24.8 days to overflow. |

One of these is worth keeping for how the *fix* failed. The depth counter was
named `depth`, and the function body already used `depth` for paren tracking
inside a block that shadows a parameter of the same name — so the new counter
silently became the paren counter and never grew. A hundred levels still
parsed. Reading the diff would not have caught it; the test did, by refusing to
go green.


Two process notes worth as much as the findings.

The first four commits of this sweep contained **only their new test files**.
`core.fsmonitor` had gone stale in the worktree, so `git add -A` staged the
untracked tests and silently skipped every modified source file; each commit
reported a plausible `--stat`, `git status` said "working tree clean", and the
tests kept passing because the code was in the working tree all along. Nothing
looked wrong until `git show --stat` was read deliberately. See
`git-status-lies-in-worktrees-fsmonitor`: set `core.fsmonitor false` in a
worktree before the first commit, and read back what a commit contains.

Several of these were pinned by tests that asserted the defect. Three
`limit: 20`s in the client's own suite, and a `resolvePagination()` expecting
`{ limit: 20 }`, were restating numbers the code had invented rather than
checking them against the constant the server uses. A test that repeats the
implementation's answer cannot fail with it.


### Last sweep — 2026-08-05, two navigations for one action

Triggered by the split view's close button (class 28). The recipe used was the
one in that entry: count, per handler, everything it calls that is *allowed* to
change the URL — `navigate`, the controller methods that wrap it, and every
caller-supplied callback.

| checked | result |
|---|---|
| the premise itself, before sweeping for it | **the stated mechanism was wrong**, and the sweep would have been aimed at the wrong thing. "The router silently drops the second navigation" does not happen: in a data router the *last* call wins, in all six shapes tried. Pinned in `router_two_navigations_one_handler.test.tsx`, because a react-router upgrade that flips it changes which panels close. |
| `SidePanelBinding.onUpdate` | **BUG, fixed** — three navigation-capable calls in one body. On "save and close" of an existing record the close was last and won, so it worked. In the reference picker's "add new", the caller's `onUpdate` closes the panel *first* (`SelectionTableBinding.onEntityClick` → `sideDialogContext.close(false)`) and the `status !== "existing"` branch replaced it after — so the close lost, the new-entity panel stayed open, and the `replace` landed in the picker's slot and destroyed it. Now: one navigation, closing wins over replacing, and `props.onUpdate` runs last. Primitives pinned in `side_dialogs_close_then_replace.test.tsx`. |
| `EditViewBinding`'s `onSaved` fan-out | seam, not reachable in-repo — it calls `onSaved?.()` and `formProps?.onSaved?.()`, both caller-supplied and both free to navigate. No caller in the workspace passes `formProps.onSaved`. Reachable by an embedder; the ordering is now stated in a comment rather than left to whoever edits the block next. |
| `SplitListView`, `RebaseRoute`, `DetailViewBinding`, `CollectionViewStartActions`, the two `RouterCollection*StudioView`s, `ConfigControllerProvider`, `DefaultAppBar`, `DefaultDrawer`, `FavouritesView`, `NavigationCardBinding` | clean — one navigation per handler, and the delete action's two are a genuine `if`/`else` on `openEntityMode`. |
| `AdminModeSyncer`, the one component whose job is to react to a URL | clean — it only calls `setMode`; the drawer's mode buttons navigate and it does not, so a mode switch stays one navigation. |
| `packages/app/src` | clean by construction — the package contains no `navigate` call at all; every navigation in the panel is raised from `packages/admin`. |
| `closeOnSave` on `SidePanelController` | **BUG, fixed** (class 21) — declared, documented, passed as `true` by `SelectionTableBinding`, and read by nothing. The behaviour it names is exactly what the picker flow above was trying and failing to get by hand, so honouring it *is* the fix: `onUpdate` closes when the opener asked it to, and stops replacing a panel on its way out. |
| the controller-mediated navigations, on a second pass | **the first pass had missed them** — grepping `navigate(` over `packages/admin/src` finds seventeen files and none of the calls that matter here, because `sidePanelController.replace` and `sideDialogsController.close` navigate without saying so. Re-run against the wrappers: `EntityFormBinding.navigateBack` and `useSelectionDialog` are clean (`if`/`else`, one each), and `SidePanelBinding` held all the rest. |

The picker finding is the one to keep. Correcting the *order* of those three
calls would still have left `replace()` writing into a slot that `close()` had
already shifted — the two operations disagree about which panel they are
talking about, which is class 11 wearing a different hat. An ordering bug and a
stale-index bug arrived together because both come from the same cause: two
statements written as if the other one were not there. So the fix removes the
pairing rather than sequencing it.

A note on the sweep itself, which is the reusable part: the first pass grepped
for `navigate(` and came back with a clean-looking picture, because the one
broken handler in the package does not contain the string. A sweep is only as
good as its recipe naming every *spelling* of the thing it hunts.



### Last sweep — 2026-08-06, more of class 28's family

Class 28 is one shape of a wider family: **a single-slot resource with more
than one owner, and nothing expressing which write should survive**. One URL,
one visible list of rows, one focused element, one keystroke. This pass went
looking for the other slots rather than for more navigations.

| checked | result |
|---|---|
| every global keydown listener in the panel (nine, across `window`/`document` × capture/bubble) | **BUG** (class 30) — `EntityInspector` claimed Escape with `stopPropagation` from a `window` bubble listener, against the split view's `window` bubble listener that closes the record. Same element, same phase: both ran, and Escape aimed at the inspector navigated the record panel away. Moved to `document` capture, the idiom the relation and user selectors already used. |
| the mechanism, before fixing the instance | **the first harness was wrong and endorsed the wrong fix** — it dispatched keydown on `window`, giving the event a one-element path that never reaches `document`, so the working idiom looked dead. Four mechanics now pinned in `escape_key_ownership.test.tsx`, including that `stopImmediatePropagation` would also have failed here, because same-element listeners run in registration order and the layer that opens later registers later. |
| `return () => {}` as a cancellation, workspace-wide | **BUG** ×3 (class 29) — `useCollection`, `useFetch`, `useRelationSelector`. Live branch unsubscribes, one-shot branch returns an empty function, and the effect dependencies that change mid-flight are the search string, the filters, the sort, the page and the entity id. Guarded; the gate was verified by breaking it. |
| which branch actually runs | the stubbed one, wherever realtime is off — both live methods are assigned under `if (ws)` in the SDK. This is what moved the three from latent to reachable. |
| `useResolvedUsers`, `useAsyncResolver`, the two collection-config controllers, `Rebase.tsx`'s storage sources | clean — all five already carry a `cancelled`/`active` guard. The idiom existed; the data hooks were the ones that had missed it. |
| the client SDK's own single-row read | clean, and worth reading as the reference: it tracks `closed`, `liveDelivered` and a payload `signature`, so a `findById` that resolves after live data has arrived is dropped rather than replayed. The transport got this right and the hooks above it did not. |
| two `snackbarController.open` / `dialogsController.open` in one handler | clean — 31 snackbar call sites, none paired within a handler. |

The reusable half of this sweep is the grep. Class 28's recipe had to be
corrected because `navigate(` did not name the controller wrappers; this one
worked first time because `return () => {}` is the *stub itself* rather than a
description of it. Prefer hunting the artifact a defect leaves behind over
hunting the situation that produces it — one is a string, the other is a
judgement call.

---

### Last sweep — 2026-08-07

An open-ended pass over the whole monorepo, after merging the outstanding
branches into main. Two classes came out of it — one new (31), one an
application of 2 — and a red main that nobody had noticed.

| checked | result |
|---|---|
| every relative-time formatter (7) | **BUG** (class 2) — five assumed their input was in the past. A date next month read "Just now"; one two hours out read "-1d ago". Unified on `formatRelativeTime` in `@rebasepro/utils`. |
| every `JSON.parse` of persisted UI state | **BUG** (class 31) — the SQL editor parsed its tabs and column widths in `useState` initializers, so one unreadable entry bricked the view on every reload. `readStoredJson`/`writeStoredJson` now cover all four failure modes. |
| `?orderBy=` shape vs `?where=` shape | **BUG** (classes 2, 31) — the sort *field* has been schema-checked for a while; the parameter's *shape* was not, so `?orderBy={"field":"name"}` answered 200 with unsorted rows. Now a 400, matching the published OpenAPI parameter. |
| `resolveStartPort`, both sources | **BUG** (class 31) — the port file was range-checked and tested; `PORT` was not. `PORT=oops` started the dev server on `NaN`. |
| the number branch of the data importer | **BUG** (class 31) — `Number("")` is 0, so blank cells imported as real zeros and typos as NaN. |
| `check:derived-names` on main | **RED** — `d9da841e` renamed the emitted schema `auth` → `rebase` and left the contract naming the old one. Verified `dropLegacyAuthSchema` handles aged databases before regenerating. |
| `check:unused` ratchet on main | **RED** — the list-view merge removed three findings and left the baseline unbanked. |
| `ADMIN_COLLECTION_KEYS` count gate | **RED** — the same merge added `hideFromEntityViews` to the list, correctly sorted, and left the tripwire at 40. |
| `ListView` pagination gate (`isLoadingMore`) | clean — suspected a wedge when a page loads without flipping `dataLoading`; `useCollection` calls `setDataLoading(true)` synchronously on every `itemCount` change, so the reset always runs. |
| API-key permission guard on an empty list | clean — still fails closed by construction |
| `applyCollectionDefaults` on a collection with no rules | clean |
| inbound WebSocket frame parsing | clean — inside the handler's `try`, and a non-object destructure is caught with it |
| comparator-less `.sort()` (20 sites) | clean — every one is on strings |
| empty `catch` blocks in server/client | clean — all are teardown (`unlink`, `client.end`, socket close) |

Worth repeating: three of the eight findings were *red gates on main that no
run had reported*, because `check:unused` fails early in the job and everything
after it is skipped. A gate that never gets reached is a gate that is not
running, and the ordering made two real failures invisible behind a ratchet
that only wanted a number banked.

The other thing this sweep confirms is the pairing in class 31. Not one of the
five parse bugs was in code nobody had thought about — every single one had a
sibling a few lines away that was already doing it correctly, with a comment or
a test explaining why. The check was written once and never carried across.


---

## 33. A privileged reader on a route that never asks who is calling

Some data cannot live under row policies. An audit table shadows every table it
audits, so it cannot carry their `securityRules`; a search index spans
collections; a metrics rollup is nobody's row. The honest answer is to read
those through the privileged handle and **revoke the restricted role's access**
so no client can reach them by SQL.

That revoke closes one door and quietly nominates the route in front of it as
the entire access-control model — the same position `storageAuthorize` is in.
And a route that inherited its mounting from a router where *every other
handler* is authorized tends not to notice it has been handed that job.

The tell is a route handler that reads through a service captured in a closure
while its neighbours read through `c.get("driver")`.

**Recipe.** For every router that serves data, list the handlers and ask of each
one where its data comes from. Any handler whose read does not pass through the
request-scoped driver is either (a) authorized by hand — check that it is — or
(b) unauthorized. Grep is enough to enumerate but not to judge:

```
grep -rn 'c.get("driver")' packages/server/src   # the ones that do
```

then read the routers those files *don't* appear in. The gap is the finding.
Note that "it revokes the table from `rebase_user`" is evidence the author knew
the data was sensitive — it is not evidence the HTTP path is closed.

**Found:** `GET /api/data/:slug/:id/history` returned `values` and
`previous_values` — the complete contents of a row at every past revision — for
any id in any history-enabled collection, to any authenticated caller, and to
any API key regardless of its permission list. The REST generator mounted one
line below it in `init.ts` has `getScopedDriver`, which refuses to fall back to
the unscoped driver, in a comment naming this exact hazard.

### Last sweep — 2026-08-07, the second pass

An open-ended pass over surfaces the log had never named: auth token lifecycle,
injection, SSRF, transaction boundaries, cache isolation. Three findings, one
new class (33), and a tool.

| checked | result |
|---|---|
| every route that reads data, against the driver it reads through | **BUG** (class 33, P0) — `GET /:slug/:id/history` read the audit table on the *privileged* handle and applied no authorization of its own: neither RLS nor the API key's permission list. Every past value of every row in a history-enabled collection, to anyone signed in. Fixed by asking the request-scoped driver for the row first — a 404 when it is not visible, never a 403. |
| the same route's revert half | **already guarded, and tested** — the cross-entity check was load-bearing and had a suite reasoning about it. The list route beside it had `fetchHistory` mocked to `{ data: [], total: 0 }` and was never exercised. The guard people thought about is the guard they tested. |
| `c.get("driver") \|\| driver` on the revert write | **BUG, latent** — an RLS-free write reached by the *absence* of a value. Unreachable once authorization runs first; removed rather than left armed. |
| every optional field on an exported `*Config`/`*Options`, against whether anything reads it (`scripts`-style pass, 607 fields) | **BUG** ×1 (class 21) — `EmailConfig.templates.userInvitation`. Read by nothing; `finalizeAdminUserCreation` reached past it to `passwordReset`, so an admin creating an account sent that person **"Reset your <App> password"** for an account they had never seen. `getUserInvitationTemplate` was written, typed, exported and unit-tested — every part of it except the call. |
| `X-Real-IP` against the reasoning already done for `X-Forwarded-For` | **BUG** (class 2) — read unconditionally, including under `trustedProxyHops: 0`, the mode that means "no proxy is in front of me". With no proxy nothing writes it but the caller, so the rate-limit key was theirs to choose: the limiters on login, registration and password reset counted to one. Now believed only where a hop is declared; otherwise the connection's own address, via `@hono/node-server/conninfo`. |
| the test that should have caught it | **asserted the defect** (class 7) — "With no trusted proxy, only X-Real-IP is believed", three lines below the XFF test that gets it right. It kept passing after the fix, for a different reason. |
| history pagination `meta` | **BUG** — echoed the *requested* limit while serving the clamped one, so a client paginating on `meta` skips what it never received. |
| `SET LOCAL ROLE` + `set_config(is_local: true)` on the data plane | clean, and the reference for this repo — fails closed by construction, and `LOCAL` means a pooled connection cannot carry one request's identity into the next. |
| `executeSql`'s fail-open when the role switch is refused | clean in reach — `EXECUTE_SQL` is in `ADMIN_ONLY_TYPES`, and an admin already has the connection. Worth knowing the asymmetry exists: the same operation fails closed on one path and open on the other. |
| every `sql.raw` built from a template (131 sites) | clean — DDL over developer-controlled identifiers, and `BranchService` validates against `^[a-zA-Z0-9_-]+$` before quoting. |
| email normalization across both drivers | clean — one `normalizeEmail`, called inside each repository rather than by its callers, so a caller that forgets cannot break it. |
| every outbound `fetch` with a non-literal URL | clean — OAuth endpoints are literals or config; `WebhookDispatcher` is instantiated by the developer, not from data. **This verdict was overturned on 2026-08-08; the row is left as written, and the correction is at the end of this file.** |
| module-level caches in server / server-postgres / saas | clean — three, all keyed on cluster id or Stripe lookup key, none per-tenant. |
| `applyAdminGate` on every admin surface | clean — fresh router, gate, *then* route, consistently. The comment on the schema editor explains what happens when that order is reversed. |
| `check:derived-names`, `names`, `generated`, `control-chars`, `api-surface`, `hooks`, `test-scripts`, `unused`, `untranslated`, `deps` on main | all green — unlike the previous sweep. |

Two things worth keeping.

The first is the tool. "Which of our options are lies?" was a hunch until it was
a script: parse every exported `*Config`/`*Options` interface, take the optional
fields, and ask whether the name occurs anywhere that is not its own
declaration or a doc comment. 607 fields, 6 candidates, 1 real — a good ratio
for something that runs in two seconds, and it re-runs on every future config
addition. Four of the five `EmailConfig.templates` slots were wired; the fifth
was not, and no amount of reading `EmailConfig` would have told you which.

The second is that two of the three findings were *inconsistencies with a
correct sibling in the same file or the next one over* — `X-Real-IP` beside
`X-Forwarded-For`, `userInvitation` beside `passwordReset`. That is class 31's
pairing again, now seen often enough to state plainly: **the highest-yield
question in this codebase is not "is this right?" but "does this agree with the
thing next to it?"** Both fixes were three lines. Finding them was the work.


---

## 34. Documentation the verifier cannot see, because it is not documentation

`verify-docs.mjs` is thorough about what it covers: every locale grepped for
unknown identifiers, every English fence compiled against workspace source, 930
snippets, 2405 fences. That number is reassuring, and it is the problem — it
describes coverage of `website/src/content/docs/**` and `tooling/rebase-agent-skills/**`
and says nothing at all about the pages a reader actually lands on first.

Marketing snippets are not fenced code. They are syntax-highlighted HTML, kept
as template literals full of `<span class="text-amber-400">`, so a tool looking
for ` ```ts ` finds nothing and reports clean. Nothing was broken; the check
simply never looked. The gap is invisible from the passing output, which is why
it survived across the whole life of the verifier.

What accumulates in that blind spot is not random error. It is *the previous
API*, carried forward by copy-paste from one redesign to the next, long after
the real one was renamed. The landing page is where a snippet is least likely to
be re-derived and most likely to be duplicated.

**The tell** is a snippet in a file the compiler has no reason to visit.
Anything under `website/src/components`, `website/src/pages`, a README, a
screenshot caption, a slide, an OG image template. If a code sample is stored as
markup, no type-checker in the repo has an opinion about it.

**Recipe.** Strip the markup and re-apply the checks the docs already get:

```
node tooling/scripts/verify-docs.mjs --names   # stage 3 covers website/src/{components,pages}
```

Two tests, not one. Named imports must be exported by the package — that catches
renames. And a short denylist of *known-wrong spellings* catches the rest,
because marketing snippets are elided on purpose and compiling them would be all
false positives. Derive the CLI command tree from `cli.ts` and the driver rather
than hardcoding it: a hardcoded list is this same bug one level up.

**Found:** eight wrong APIs across the landing, SDK, backend and CLI pages, none
of which had ever existed in a shipped version — `createClient()` (the factory
is `createRebaseClient`), `rebase.init({ projectId })` (Firebase-shaped, never
ours), `client.orders.retrieve(...)` / `.list(...)` (the methods are `findById`
and `find`, under `client.data`), `.where("status", "eq", ...)` (the operator is
`"=="`), `channel.on("message", ...)` — *the exact call the identifier check was
written to catch*, sitting on the page most likely to be copied from —
`FindResponse` where the SDK returns `FindResult`, `@rebasepro/sdk_generator`
(no such package), and `client.admin.getSession()` / `.getConfig()` offered as
clickable buttons in a live playground demo. Plus three dead commands: `rebase
ext add`, `rebase auth bootstrap`, and `rebase db push --database-url` (the
driver reads `DATABASE_URL`; the flag exists only on `init`).

The same pass over the skills found the sibling shape — agent-facing docs, also
outside the compiler's reach for anything that is not a fenced snippet. Three
skills taught `auth.uid()` / `auth.roles()` / `auth.jwt()`, the pre-1.0 RLS
helpers the compiler silently rewrites and the boot warns about. `rls-enforcement.ts`
names the hazard exactly: *"A silent rewrite that works forever is not a
migration, it is a second supported spelling nobody wrote down, and the next
person to read those rules will copy the old one."* An agent skill is the
strongest possible version of "the next person" — it copies the old one forever,
into every project. Four skill files also taught `rebase login` / `rebase deploy`,
which exit 1: every cloud command lives under `rebase cloud`.

### Last sweep — 2026-08-08, docs, skills and the marketing site

| checked | result |
|---|---|
| `pnpm verify:docs` baseline | clean before and after — 930 snippets, 2405 fences, all four stages. The findings below are all from surfaces it did not scan. |
| every `@rebasepro/*` import on the marketing site, against the real export surface | **BUG** ×8 (class 34) — see above. Now stage 3 of the verifier, mutation-tested against all six shapes. |
| every `rebase <cmd>` shown on the marketing site and in the skills, against the CLI's dispatch table | **BUG** ×3 + ×4 — `ext add`, `auth bootstrap`, `db push --database-url`; and `login`/`deploy` in four skill files. The check derives the tree from `cli.ts` + the driver, so a renamed subcommand fails on the commit that renames it. |
| the MCP tool list on `/ai`, against the exported names in `@rebasepro/mcp` | clean — 40/40, exactly in sync. The page carries a comment asking to keep them together, and someone did. |
| generated SQL shown on `/backend`, against what the policy compiler emits | **BUG** — `auth.uid()` / `auth.roles()` presented as the output of `schema generate → db push`, which emits `rebase.*`. |
| the RLS helpers taught by all 21 skills | **BUG** ×3 (class 34) — `rebase-auth`, `rebase-security`, `rebase-collections`. |
| removed types (`RebaseUser`, `RebaseTokens`, `AuthApiError`, …) across docs and skills | **BUG** ×1 — `RebaseUser` in `rebase-auth`, *declared locally* rather than imported, which is why the identifier check could not see it. Blind spot worth naming on its own: a doc that redeclares a type instead of importing it is unverifiable by construction. |
| every internal `/docs/` link in docs, skills and marketing | **BUG** ×32 — 27 on the UI showcase (`/docs/components/*`, missing the `ui/` segment and snake_cased), plus `/docs/auth`, `/docs/storage` ×2, `/docs/backend/webhooks`, `/docs/icons`. |
| every EN docs page against the sidebar | **BUG** ×4 — `self-hosting`, `runtime-and-bundles`, `apps-and-repositories`, `multiple-sources` built fine and were reachable by nothing. They were also absent from `llms.txt`, so the four newest architecture and deployment pages were invisible to agents too. 60 → 64 pages. |
| docs frontmatter (title + description) | one gap, in the *generator* — `copy_changelog.js` emitted no description. Fixed there, not in its output. |
| the six locales against English | **9 pages untranslated in all five non-EN locales**, including `backend/search`. Not fixed — `translate_docs.mjs` over 45 files is a batch job with a cost, and that is a call to make awake. |

The lesson is narrower than "check the marketing site". It is that **a verifier's
passing output describes its glob, not your repo.** 2405 fences sounds like
coverage until you ask which files contain none. Every surface that shows code
to a human — marketing pages, agent skills, READMEs, slides — is documentation
whether or not it lives in the docs directory, and the ones stored as markup are
exactly the ones no tool will volunteer to check.

---

## 35. A generator that writes a name instead of quoting it

Class 13 says nothing typechecks a generator's output. This is the other half:
nothing *escapes* it either. A generator assembling source text does two things
with every value it is handed — writes it as a **name**, or writes it inside a
**literal** — and both are wrong by default.

Written as a name, any value that is not a JavaScript identifier stops the file
parsing. The SDK generator emitted every column as a bare key, `generateCollectionFile`
emitted every column and every table name that way, and `generateSchema` did it
for columns and foreign keys. `order`, `full name`, `2fa_enabled` and `créé_à`
are all ordinary quoted Postgres identifiers, and in a `baas` project the
property keys **are** the column names, so this is not a hypothetical schema.

Written inside a literal, any value containing the quote character closes it
early and continues as code. Enum values went into the Drizzle schema between
*single* quotes, so `O'Brien` broke the file — not an attack, a surname. And in
the SDK generator the values are not even local: `rebase generate-sdk --from <url>`
takes every slug, column and enum value from a remote contract, so a slug of
`posts", OWNED: (globalThis as any).process?.env, x: "` produced a file that
compiled **cleanly** and carried an attacker-authored module-level initializer
into the developer's bundle. `rebase init` has the same shape against a database
somebody else made.

The tell in all three was the same, and it is a good one to look for: a `quote()`
helper already existed in the file and was applied to two sites out of thirty.
Someone hit the bug once, fixed it locally, and did not generalise. A generator
either routes *every* value through an escape or it has none.

Comments count. A table comment, a column comment and a classification reason
are free text from the database, and all three were written after `//`, where a
newline ends the comment and the rest is code.

**Sweep:** in every file that emits source text, grep for `${` inside a template
literal and classify each hit: name position, literal position, comment. A name
needs an identifier test with a quoted fallback (and a member access needs
bracket notation — `t["full name"]`, which Drizzle treats identically). A literal
needs `JSON.stringify`. A comment needs its newlines collapsed. Then assert the
invariant structurally rather than by substring: parse the output and compare its
list of top-level declarations against the expected one — an escaped payload and
an injected payload contain the same words and only the AST can tell them apart.
`generated-output-compiles.test.ts` and `introspect-hostile-identifiers.test.ts`
do this; `openapi-generator.ts` is the sibling that needed nothing, because it
builds an object and lets `JSON.stringify` do the escaping. That is the shape to
prefer when the output format allows it.

### Last sweep — 2026-08-08, the three code generators

| checked | result |
|---|---|
| every interpolation in `packages/codegen` | **BUG** — slug, enum value and property name all raw. Injection PoC compiles clean. Plus the naming defect below. |
| the generated `Row` against the wire | **BUG** — every column camel-cased, so `author_id` was typed `authorId` and neither `row.author_id` nor a `where` on it compiled. `FindParams` is keyed off this type, so the correct name was a type error and the wrong one a 400. Three tests pinned the wrong names as the spec. |
| `Row` / `Insert` / `Update` against what reads and writes actually accept | **BUG** ×6 — primary key optional on reads, nullable columns typed as merely absent, `excludeFromApi` columns typed as readable (the scaffolded `users` collection says its own password hash comes back), `Update` accepting the primary key, neither write type accepting the documented `{ author: 5 }` form, nested map fields ignoring their own validation. |
| `generateCollectionFile` (`introspect-db-logic.ts`) | **BUG** — 25 raw interpolations: column and table names as bare keys and as a `const` name, table name inside an import specifier, comments unescaped, PG enum values raw in one branch and quoted in the next. |
| `generateSchema` (`generate-drizzle-schema-logic.ts`) | **BUG** — 29 column-name literals, 3 property keys, 6 member accesses, and enum values in single quotes. |
| `openapi-generator.ts` | clean — builds an object, serialises as JSON. No text assembly, no injection surface. |
| the regenerated SaaS console SDK against the console's own code | **BUG** — `o.billingAccountId`, a key no organization row has ever had, so the billing account never loaded after a page reload. Found by regenerating, not by reading. |

The lesson is that **a generated file is the one place where a naming decision is
also a parsing decision.** The SDK generator's camel-casing looked like a style
choice and was actually the difference between a type that describes the payload
and one that describes nothing; the same function applied to a bare key is the
difference between a file and a syntax error. And the only in-repo consumer of
the generated SDK — the SaaS console — had quietly stopped using the typed
accessors and gone back to `data.collection(slug)`, which is how three of these
survived a year. When the only user of a generated artifact routes around it,
that is the finding.

### Last sweep — 2026-08-12, the generator that emits SQL

The 2026-08-08 sweep classified interpolations in the files that emit
*TypeScript*. Two surfaces were not on that list, and both were broken.

| checked | result |
|---|---|
| `policyToPostgres` — identifiers into SQL | **BUG** — `quoteLiteral` for the value side, nothing for the identifier side. |
| `wrapSql` — SQL into a TypeScript file | **BUG** — no escaping at all at the boundary between the two languages. |
| `search-column.ts` | clean — every column reference is `"${...}"`, every literal goes through `quote()`. |
| `ensure-collection-policies.ts` | clean — schema and table quoted, the two values it interpolates single-quote-escaped. |

The SQL one is worth stating precisely, because "it will fail loudly" is the
assumption that let it stand. Three outcomes, and only the first two announce
themselves:

- `"createdAt"` folds to `createdat`, `CREATE POLICY` errors, and the collection
  keeps RLS on with no policy — deny-all. `columnName` is used verbatim and
  `rebase schema introspect` writes it from the live database, so this is simply
  what a camelCase table adopted from an existing project does.
- `order`, `default`, `end` are syntax errors mid-clause.
- `user`, `current_user`, `session_user`, `current_date` are **valid bare
  expressions**. The policy compiles, applies, and is logged as applied, while
  comparing against the connected role or the wall clock. Under RLS every request
  runs as the same `rebase_user`, so the clause is a constant: it denies
  everyone, and its negation admits everyone.

That third row is the reason a name position in SQL is not a milder version of a
name position in TypeScript. A broken identifier in generated TypeScript does not
compile. A broken identifier in generated SQL can be a *different valid
expression* — the language has bare keywords that evaluate.

The TypeScript one is the same class read the other way: correct SQL becomes
wrong SQL by being written into a `.ts` file. Drizzle's `sql` tag reads the
cooked template strings, not `.raw`, so JavaScript eats the escapes first, and
`email ~ '^admin\\.user@corp\\.com$'` reaches the database as
`^admin.user@corp.com$` — every `\\.` now matching any character. The `.sql`
file emitted from the same rule keeps its backslashes. Two generators, one rule,
two different security boundaries, and the divergence is always permissive.

**Add to the sweep:** the tell generalises past `${` in a template. Ask, for every
value crossing a language boundary, *which* language's rules it is about to be
read under. Both bugs are one value read by two languages with different opinions
about one character.

A note on the fix, which is not obvious: quote only what needs quoting. Always
quoting is simpler and would have rewritten every policy body in every generated
artifact and every shipped database, to reach the handful that were broken. That
trade is worse than the bug. Policy *names* hash the rule rather than the SQL, so
the narrow fix renames nothing and manufactures no orphans — worth checking
before choosing, because if names had hashed the text the choice would reverse.

---

## 36. A mechanism nothing enforces

The code is written, typed, named after what it does, and in two of the three
cases below it has tests. What is missing is the line that consults it. That
makes it invisible from every direction a review normally comes from: it cannot
fail a test, because the mechanism itself works; it cannot appear in a log,
because nothing runs; and it cannot be found by reading the mechanism, because
the defect is at a call site that does not exist. Absence is what reading is
worst at — class 21 says the same thing about extension points.

This is the security-shaped member of that family, and it is worse than either
neighbour. Class 14 is a field that drifts because no reader can disagree with
it, and class 21 is a slot the user is invited to fill; both are inert. Here the
mechanism's purpose is to **deny**, and other code has already been relaxed on
the strength of it. The system is not merely missing a control — it has been
opened somewhere else to make room for one that never arrived.

**MFA.** `aal`, the claim that says whether a session cleared a second factor,
had five writes and one read. The writes, all in `packages/server/src/auth`: two
in `createSessionAndTokens` (`routes.ts`), which is login, register and every
OAuth callback; two more on the refresh path in the same file, hardcoded
`"aal1"`; and one in the step-up (`mfa-routes.ts`). The read: a single
`if (userCtx.aal !== "aal2")` in `mfa-routes.ts`, guarding
`DELETE /auth/mfa/unenroll` and nothing else. `POST /auth/login` never called `hasVerifiedMfaFactors()`, so the token an
MFA-enrolled account received after a password was byte-for-byte the token an
account with no factors received, and RLS binds on `uid`, never on `aal`.
Enrolling a second factor reduced an attacker's cost by zero. Session issuance is
conditional now — `mfa-gate.ts`, `MFA_REQUIRED`, a purpose-scoped pre-auth token —
and refresh carries the presented level forward from `refresh_tokens.aal` rather
than restating `aal1`.

**Channel authorization.** It did not exist: not a hook, not a config key, not a
stub. Meanwhile `channel-presence.ts` and `channel-history.ts` each took their
tables out of the RLS model and cited it by name — *"presence authorization is a
channel rule, not a row policy"*, and *"who may replay a channel is decided by
the channel rules the server evaluates before it reads"* — and
`sdk/realtime.md` told users *"the server still authorizes every frame."*
Three assertions, one gate that was never written. The revokes are real
(`REVOKE ALL ON "rebase"."channel_presence" FROM rebase_user`, issued from
ensure-tables rather than a migration), which is the whole point: the hardening
left those tables **less** defended than the ones it exempted them from. Any
socket could read the presence roster of any channel it could name, and broadcast
into a channel it had never joined. `handleChannelMessage` is the one door now and
`authorizeChannelAction` the one gate, with membership as a floor a
`ChannelAuthorizer` can only narrow.

**`assertKnownWriteFields`.** A guard whose doc comment stated its own premise:
*"Unknown keys used to travel all the way into the INSERT, where Postgres
rejected them."* They never did. Drizzle builds the INSERT from the table's own
column list, so an unknown key is dropped — `insert into "posts" ("id",
"title_col", "views")`, no `titel`, no error, a 201 that stored nothing. The
guard was not a second line behind Postgres; it was the only line, and it was
skipped on four paths, including `strictWrites: false`, whose documented meaning
could not work either because the value was discarded a layer below regardless.
`assertWritableColumns` is the driver-level backstop the comment had assumed, and
`write-column-guard.test.ts` pins what Drizzle actually emits via `toSQL()`.

**Sweep: grep for the reads of a security value, not the writes.** Writes are
easy to find and easy to feel good about — they are the part that looks like the
feature. For every claim, flag, level or scope the system mints, enumerate the
sites that *branch on it* and ask which of them is on the path an attacker takes.
`aal` is the model: eight occurrences in `packages/server/src`, one `if`. Then
invert it — for every route that mints a credential, list what it consulted
before doing so.

**Watch for the comment that cites another layer as the reason this one may
relax.** *"X is decided by Y"*, *"the server checks this first"*, *"validated
upstream"*. Each is a factual claim about code somewhere else, it is the
cheapest kind of claim to check, and it is almost never checked — the author of
the relaxation is the person least likely to go looking. Every such sentence is a
lead, and a `REVOKE`, a `disableDefaultPolicies` or a deleted validation
alongside one is evidence the author knew the data was sensitive, not evidence
the other layer is closed. Class 33 made the same point about an HTTP route in
front of a revoked table; this is the same trade with no route at all.

---

## 37. A generator that publishes what the pipeline strips

Class 35 is about how a generator *writes* the values it is handed. This is about
which values it is handed at all. A generator describes a surface it does not
implement, so every rule the surface enforces has to be restated in the
description — and a rule the description omits is not a documentation gap, it is
a promise the runtime does not make, or an invitation the runtime never issued.

`excludeFromApi` is a server-side guarantee: `stripExcluded`
(`packages/server-postgres/src/services/row-pipeline.ts:104`) deletes the
property key *and* its `columnName` from every row the API serves, for every
caller. Both generators that render a collection into an artefact ignored it. The
OpenAPI generator's three loops — read schema, input schema, filter parameters —
skipped `relation` and nothing else, so every project scaffolded by `rebase init`
published its `users` collection's `passwordHash` and `emailVerificationToken` by
name, as readable, as writable, and as **filterable**: a real `in: "query"`
parameter carrying *"Filter by `passwordHash`. Supports PostgREST operators."*
`/api/docs` is registered on the app rather than on the data router, so it
carries none of the auth middleware `{basePath}/data` does — that document is
served to anyone. The SDK generator had it half right, which is more interesting:
`Row` skipped excluded properties and `Insert`/`Update` did not, with a comment
giving the reasoning — *"they are stripped from responses, not from writes."* A
defensible reading of the flag, and the result was the one remaining place in the
shipped surface that named a password hash and offered it to a client as a field
to send.

The tell is a rule enforced in exactly one place and *described* in several. A
pipeline step is a rule; an OpenAPI document, a generated SDK, an admin form and
a fixture seeder are four more renderings of the same config, each written by
someone holding a different one of these flags in mind.

**Sweep:** take the per-property flags the runtime acts on — `excludeFromApi`,
`readOnly`, `admin.disabled`, `validation.required` — and for each, enumerate
every artefact generated from a collection and ask whether that artefact honours
it. Do this by walking the flags, not the generators: a generator you read will
tell you what it handles and cannot tell you what it never heard of.

Then fix it as one predicate the loops share, not as a `continue` per loop —
three independent `continue`s is how this survived, and it is class 2 wearing a
generator's clothes. And **assert the rule, not the instance.** `passwordHash`
and `emailVerificationToken` were fixed by name in generator after generator and
the rule stayed broken each time; the test that replaced them runs a fixture with
eight excluded properties of different shapes, and the excluded set is keyed on
property name *and* column name so a foreign key addressing the column by its
other spelling cannot put it back.

---

## 38. A correct check over a lossily transformed copy of its subject

A check reads a value it did not receive. Between the subject and the predicate
sits a transform — flatten, normalise, serialise, project — written for a
different purpose by someone who was not thinking about the check. The predicate
is then right about the wrong thing, and reviewing it finds nothing, because the
defect is not in the predicate: it is in the distance between the predicate and
its subject.

Autofill's rule is "only fill blanks", and it is enforced the strong way, by
construction: a field that already has a value is omitted from the JSON schema
the model answers into, so there is no path by which a generated value reaches a
filled field. The service decides a field is filled by looking up `values[key]`
for each `key` of `properties`. Both maps arrive from the client, built by
different functions. `getSimplifiedProperties`
(`packages/plugin-ai/src/utils/properties.ts`) names an array by its own path and
stops there; `flatMapEntityValues` (`utils/values.ts`) recursed into anything
`typeof value === "object"`. So `tags: ["a", "b"]` was sent as `tags.0` and
`tags.1`, and a `Date` was sent as nothing at all — `Object.entries(date)` is
`[]`. Both looked up as `undefined`. Every array and every date on the form read
as empty, went into the fillable schema, and came back into the review dialog
pre-ticked for replacement. The array's values were still in the prompt as
context, so the model was asked to invent tags while being shown `tags.0: news`.

The invariant was written down, twice, and both statements are correct. Above the
request field that carries the values:

> Flattened to dotted paths so the keys line up with the property map: the
> service is told about `seo.title`, so it has to be told the value of
> `seo.title` too, not of `seo`.

and in `properties.test.ts`, as the reason the suite exists: *"if the two
disagree, the model is told a field exists and shown no value for it, and
cheerfully overwrites what the operator already wrote."* Both are about maps, and
the suite tested maps. **An invariant stated in prose and tested on one shape of
input is an invariant that holds for that shape.**

**Sweep:** for any check whose subject arrived through a transform, do not read
the check — construct the subject. One value of every type the system supports,
through the real transform, compared against the real key set. Where two
artefacts must agree, the honest form is to derive one from the other; where they
cannot be, assert the agreement over generated input rather than over the example
that prompted the comment.

`typeof x === "object"` is the specific tell and is worth grepping on its own. In
JavaScript it is true of arrays, `Date`, `Map`, `RegExp` and `null`, so every
container test or recursion written that way treats five things as records — and
the failure is silent in both directions: a `Date` yields no keys, an array
yields the wrong ones. A prototype-checking `isPlainObject` is the fix, and its
absence from a codebase that walks user data is the class.

### Last sweep — 2026-08-08, twenty-seven units

An audit register (`docs/audit-map.md`) naming the units worth auditing on their
own, and 27 written reports in `docs/audits/`, each recording what was checked
and found clean alongside the findings. The rows below are the ones that named a
new class or overturned an old verdict; the reports carry the rest.

| checked | result |
|---|---|
| `aal`, by its readers rather than its writers | **BUG** (class 36) — five writes, one read, and the read guarded `DELETE /auth/mfa/unenroll`. Login, register, every OAuth callback, refresh, anonymous and magic-link all minted `aal1` unconditionally, so an enrolled second factor was never consulted on any path an attacker takes. |
| the two `REVOKE` comments on the channel tables, against the gate they cite | **BUG** (class 36) — no channel authorization existed anywhere in `packages/*/src`. Hardening applied on the premise of a check nobody wrote, which left the exempted tables less defended than the ones they were exempted from. |
| `assertKnownWriteFields`, against what Postgres is actually given | **BUG** (class 36) — Drizzle drops unknown keys from the INSERT, so the "Postgres has the last word" backstop the comment named never existed. An all-unknown UPDATE compiled to `update "posts" set` — SQLSTATE 42601, returned to the caller as a 500 for their own typo. |
| `excludeFromApi` across every artefact rendered from a collection | **BUG** ×2 (class 37) — an unauthenticated `/api/docs` published `passwordHash` as readable, writable and filterable; the SDK's `Insert` and `Update` offered it as a field to send. |
| the autofill "only fill blanks" rule, over values as the service receives them | **BUG** (class 38) — arrays flattened to `tags.0`, dates flattened to nothing, both read as empty, both arrived pre-ticked for replacement. |
| `WebhookDispatcher`'s destination | **BUG** — `fetch(webhook.url)` with no scheme check, no host check and no redirect policy, returning the first 1000 bytes in `responseBody`. See the correction below: this surface had been swept and cleared. |
| the OAuth providers' base URLs, immediately after | clean **by a constraint now written down** — `createGitLabProvider` takes `baseUrl` from config and says why it must stay there: *"a caller-supplied instance URL would make this provider an SSRF primitive and an arbitrary-identity oracle in one step."* That is a requirement stated as a requirement, which is a different artefact from the same sentence used as a reason to skip a check. |

### A correction: a clean verdict that rested on a wrong premise

The 2026-08-07 table records this row:

> every outbound `fetch` with a non-literal URL — clean. OAuth endpoints are
> literals or config; `WebhookDispatcher` is instantiated by the developer, not
> from data.

The webhook audit disproved it. `WebhookDispatcher.deliver` called
`fetch(webhook.url, …)` — no scheme allowlist, no host check, no redirect policy,
no DNS pinning — and handed the first 1000 bytes of the answer back in
`WebhookDeliveryResult.responseBody`, which makes it a read primitive and not
merely a blind one. On GKE that reaches the node metadata endpoint, the
in-cluster API server and `postgres-rw`, and the class's own custom-headers
feature supplies the `Metadata-Flavor: Google` an unauthenticated GET needs.

The row is left above exactly as it was written. The thing worth correcting is
not the file that was missed — the right file was read — but the **inference**,
because the inference is the part that gets reused. Two things were wrong with
it.

The first: *"from config, not from data"* describes the shape of the code, not
who controls the value. A config is a string somebody types, and the skill that
teaches this exact class tells them where: *"Load webhook configs from
environment or database"* (`rebase-webhooks/SKILL.md:513`). The SaaS already
ships a `webhooks.url` column any member of the owning organization may write. A
missing guard in a shipped library is not excused by the absence, today, in this
repo, of a caller that abuses it — the library is what makes it reachable in
someone else's.

The second, and the more general one: the question a destination check answers is
not *who chose this URL* but **whose network position issues the request**. A
server-side `fetch` runs from inside the cluster, and the developer who typed the
URL is not the party the guard protects; it protects the pod's neighbours from
that developer's typo, from their compromised admin UI, and from their receiver's
`307` — which replays the POST body, the signature and every custom header at an
address no allowlist ever saw. Redirects alone make "who typed it" moot.

**What re-running this sweep now has to cover.** Enumerating `fetch(` with a
non-literal argument is still the right start; the verdict on each hit needs
three answers rather than one.

1. *Where does the process run?* A `fetch` in `packages/cli`, `packages/admin`,
   `packages/client` or `packages/app` runs on the developer's machine or in the
   user's browser, from that user's own network position, and is not this class.
   `packages/server`, `packages/server-postgres`, `packages/server-mongo`, and
   anything a function or collection callback can reach, are.
2. *Is there an enforced guard, independent of who supplies the URL?*
   `assertAllowedOutboundUrl` (`packages/server/src/services/outbound-url-guard.ts`)
   exists now and has exactly one caller, `webhook-service.ts`. The other
   server-side non-literal destinations are the OAuth providers, and
   `createGitLabProvider`'s `baseUrl` is the one that takes an instance URL. It
   is held safe by a doc comment, which is a constraint and not an enforcement —
   re-check it against every deployment shape that lets a tenant supply provider
   config.
3. *Is the response observable to the caller?* `responseBody` is what turned this
   from blind SSRF into a read primitive. A `fetch` whose answer is discarded is a
   smaller finding than one whose answer is returned, and the two should not share
   a verdict.

The lesson for the log itself: **a "clean" row is an assertion with a lifetime,
and the premise is the part that expires.** "Instantiated by the developer, not
from data" was true when it was written and is still true; only the inference
drawn from it was wrong. That the correction is even possible is because the row
recorded *why* it was clean rather than just that it was — so when a sweep clears
something on a premise rather than on a check, write the premise into the row,
and treat the premise, not the file, as the thing to re-test.

---

## 39. A refusal the database expresses as a number

Row-level security does not raise on a write it forbids. `USING` is a filter, so
a `DELETE` the policy rejects and a `DELETE` that had nothing to do are the same
statement with the same result: zero rows, no error. Every other authorization
failure in the stack throws — a missing permission, a bad token, a failed
`WITH CHECK` — and this one arrives as `rowCount: 0`, which is indistinguishable
from success unless somebody reads it.

The shape of the bug is therefore an *absence*: `await tx.delete(t).where(...)`
with the result discarded. It reads as finished code. The route above it then
answers `204`, the SDK resolves, the agent records that the order was refunded
and deleted, and the row is still there. Two gates that each work — an API key
scoped to `orders:delete`, a collection whose `securityRules` grant `service`
only `select` — combine into a caller that deletes nothing, forever, and is
congratulated every time.

Distinguishing the two cases needs one more read, on the **same RLS-scoped
handle**: if the target is still visible, a policy refused the write (403); if it
is not, there is nothing there for this caller (404, the same answer a `GET`
gives). Doing it on a privileged handle instead would answer for a different
caller and disclose the row's existence to someone who cannot read it — the
re-read has to be bound by the same policies as the write.
`explainZeroRowWrite` (`packages/server-postgres/src/services/write-denial.ts`)
is the one copy of that rule.

**Sweep:** `grep -rnE '(await|return) [a-z]+\.(delete|update)\(' packages/*/src`
and look at what happens to the result. A write whose row count is never compared
against what the caller asked for cannot report a refusal. The comparison is not
always against zero — a membership write names *n* links to remove, so anything
below *n* is the same defect.

**Watch for:** the levels below the row. A `DELETE authors/1/tags/5` removes a
junction row, not a tag, so the junction's own policies decide it; a save that
rewrites a to-many relation deletes a *set* of links. Both were still silent
after the row-level guard landed, and both are reachable from the same REST
surface as the row-level case.

**Watch for, too:** the mock that models the fix away. Three unit suites had
`delete: jest.fn(async () => undefined)` — a fake database that reports nothing
removed. Under the new guard they failed, correctly: what they described was a
database refusing every delete. A mock that omits `rowCount` is not a neutral
stand-in once `rowCount` carries meaning.

### Last sweep — 2026-08-09

| checked | result |
|---|---|
| `PersistService.delete` / `.save` (row-level UPDATE and DELETE) | already guarded, and now pinned by the readable-but-unwritable case rather than only the invisible-row one — the two answer differently (403 vs 404) and only one of them had a test |
| `RelationService.unlinkRelatedEntity` — `DELETE parent/id/rel/id` on a m2m | **BUG** — junction delete unchecked; the route answered 204 with the link intact |
| `RelationService.syncJunctionLinks` — the membership diff | **BUG** — a partial or fully-refused removal returned success, so the stored membership was not the one the save reported writing |
| `RelationService`'s FK stamping — the nine `update(targetTable)` sites | **same class, not changed here.** Two of them (`set fk where inArray(ids)`, and the one-to-one `set fk where id = ?`) have a knowable expected count and are silent today; the rest are "clear whatever is linked", where zero is legitimate. Guarding the first two also changes what a *nonexistent* target id does — today it is dropped without a word — and that is a behavioural decision about relation writes, not an RLS fix. Worth doing deliberately, with its own tests |
| `PersistService.deleteAll` | left as is: "remove everything I can see" makes no claim about a particular row, and zero is a legitimate answer |
| `deleteMany` / `saveMany` | clean — both loop the single-row path inside one transaction, so the guard and the rollback come with them |

### The read-side sibling — 2026-08-10

Widening the sweep from "a write that changed nothing" to "an operation the
caller asked for that did nothing" found the same defect pointing the other
way. `RelationService` answered `[]` for a relation it could not resolve, which
is what an empty relation looks like; and `buildSingleFilterCondition` returned
`null` for an operator it did not recognise, which drops the condition — so
`{ status: ["contains", "x"] }` filtered on nothing and answered 200 with every
row. A write that silently does nothing loses data; a read that silently does
nothing *shows* it.

The tell was in the same file. `buildRelationFilterPredicate`, five hundred
lines up, refuses an unknown operator and says why in its docblock: *"returning
`null` for an operator this cannot express would drop the condition"*. One of
the pair had been fixed and its twin had not — class 2, and class 31's
observation that these sites come in pairs.

| checked | result |
|---|---|
| `buildSingleFilterCondition`'s `default:` | **BUG** — unknown operator warned and dropped the condition. Now a 400 `UNKNOWN_FILTER_OPERATOR` naming the valid ones, matching what the wire layer already raises before the driver sees it |
| `resolveFilterTarget` (unknown filter *field*) | clean — already defaults to `error`, with `warn` as a deployment-wide opt-out |
| `realtimeService.ts`, sixteen swallowing catches | clean — each is a delivery or housekeeping concern, and the two that a caller waits on (`persistAndFanOut`, `handleChannelHistoryRequest`) already answer the client with an error frame |
| `orderBy` | already fixed — a typo'd sort is a 400 rather than an unsorted 200 |

### Widening it to every surface — 2026-08-10

The class generalises past queries and writes: **an operation a caller asked
for, that did not happen, reported as though it had.** Swept that way across
the server packages, with the caller's evidence as the test each time — what
does the client actually receive?

| checked | result |
|---|---|
| `finalize` in `tus-handler.ts` | **BUG, the worst of the sweep.** A resumable upload that could not be stored answered `204` with `Upload-Offset: <size>`, which in TUS *is* "I have your file". No controller returned quietly; a failing `putObject` was caught and logged. It also set `completed = true` before writing, and a completed upload is refused a retry and skipped by the stale sweeper — so the client was locked out of the one thing it could do and the bytes leaked. Now 503/502, and complete means stored |
| `cron-loader.ts` | **BUG.** Three kinds of unloadable file skipped with one `warn` each, nothing aggregated, and `GET /api/cron` listing only what loaded — so a job that failed to load looks exactly like a job nobody wrote. Its twin `loadFunctionsWithDiagnostics` had already been given `problems`, a summary and a count on the listing endpoint; the cron loader's docblock claims to follow that pattern and did not |
| `MongoDataService.delete` vs `PersistService.delete` | **divergent — since settled, see below.** Deleting a missing row threw 404 on Postgres and resolved quietly on Mongo, and each driver had a test asserting its own answer |
| `MongoConditionBuilder` | clean, and instructive — it already throws for an unknown operator, and its comment describes the exact Postgres defect fixed above. The pair was Mongo-fixed, Postgres-not |
| `collections/loader.ts` | clean — collects failures and throws, naming every file |
| `boot/bundle.ts` + `ensureCollectionSchema` | clean — a declared-but-missing entry is deliberately non-fatal for optional dirs (there is a test saying why), and the collections case is reported loudly one layer up with the rebuild command |
| `cron-store.tryClaimRun` | clean by this standard — it fails open on purpose and says so: a duplicate run beats a broken claims table stopping all cron |
| MFA pre-auth tokens (`verifyMfaPendingToken` / `verifyAccessToken`) | clean, both directions — a purpose-scoped token is refused as a session and vice versa, and `mfa-enforcement.test.ts` spends every string in the 401 body against a protected route |
| catch blocks with an empty body, all six server packages | none. 111 have a comment saying why, which is the standard this file asks for |

**Sweep, for the next pass:** `grep -rnE "logger\.(warn|error)" packages/*/src` and read the *next* line. `continue`, `return` and a fall-through to a success response are the three shapes. Then ask the question that separates this class from ordinary logging: **what does the caller receive?** If the answer is a 2xx, a resolved promise, or an empty list, the log line is the only place the failure exists — and nobody reads logs for an operation that reported success.

### When the two answers are both defended by a test — 2026-08-10

The `delete` divergence above is worth its own note, because it is the shape
that survives longest. Neither driver was *unreviewed*: Mongo's suite asserted
`"should not throw for non-existent entity"` and Postgres's asserted a 404 for
the same call, and both had passed for as long as they had existed. A test that
describes its own implementation's habit reads exactly like a test that
describes the contract, and it is the only kind of test that can make a
divergence stable — each side is defended, so each side stays.

What made it invisible from outside was a layer above being right. The REST
route reads the row before deleting it, so `DELETE /api/data/<c>/<id>` answered
404 on both engines; only in-process `rebase.data` callers and anyone writing
against the driver API could see the disagreement. A correct outer layer hides
an incoherent inner one until something bypasses it — which is what
`rebase.data` in a callback, a cron job, or a custom function does.

Settled toward rejecting, on three grounds and not on taste:

  * The REST layer already answers 404, so a quiet resolve made the driver API
    disagree with the HTTP API about one operation.
  * A caller cannot tell "deleted" from "there was nothing there" without it,
    and those are different facts about whether the caller's model was stale.
  * On Postgres, "matched nothing" is *also* how a policy refusal arrives —
    `USING` filters the `DELETE` rather than raising — so a driver that resolves
    on zero rows reports a refused delete as a completed one. That is class 39
    itself, which means the Postgres side could not have been made quiet without
    reintroducing the defect the class is named for.

**Watch for:** the fix that leaves the rule in two places. Conforming Mongo and
stopping there would have left two suites each asserting the same thing about
its own driver — the arrangement that produced the divergence. The rule is on
`DataDriver.delete` now, and the assertions are a kit in
`packages/server/test/contract/delete-contract.ts` that both suites run: Postgres
in its container e2e, Mongo on `mongodb-memory-server`. They cannot share a
runner — `@rebasepro/server` depends on neither driver — so what is shared is
the rule, not the harness.

**Watch for, too:** the third implementation. `packages/firebase`'s Firestore
driver is typed `DataDriver` and does *not* honour this: `deleteDoc` resolves
for a missing document, and reporting otherwise costs a read on every delete. It
runs in the browser against Firestore's own semantics rather than behind
`rebase.data`. That exception is written into the interface docblock, because an
undocumented exception is how the next person concludes the contract is
advisory.

### The same class on the caller's side — 2026-08-10

Sweeping the client and the admin turned the question around. On the server the
shape is a skip; in a UI or an SDK it is an **empty success** — a resolved
promise, a `{}`, a state update that says the thing happened. Same defect, and
harder to see, because an empty result is a perfectly ordinary thing for a
read to return.

| checked | result |
|---|---|
| `transport.request` in `@rebasepro/client` | **BUG.** A body that failed `JSON.parse` left `body = {}` and, on a success status, returned it. `find()` answered `{}` instead of an array with nothing thrown. Point the base URL at the frontend's own host and the SPA fallback answers 200 with `index.html` — so the misconfiguration the 404 branch explains at length arrives, in its commonest form, as an empty success. Now `INVALID_JSON_RESPONSE`, quoting the first 120 characters. The post-refresh retry was a second copy of the same block and had it too |
| `useJsonCollectionsConfigController` | **BUG ×3.** `updateCollection`, `saveProperty` and `deleteProperty` persisted from inside `setCollections(prev => …)`, fire-and-forget behind a `console.error`, while the same hook's `saveCollection`, `deleteCollection` and `updatePropertiesOrder` awaited. The editor reported schema changes the store had refused — and a `setState` updater with a side effect in it runs twice under `StrictMode`, so each save also wrote twice in development |
| `CollectionViewBinding`'s count fetch | clean — a failed count reports `undefined`, which is "unknown", not a wrong number |
| success toasts across admin/studio | clean — every one sampled sits after the `await` it reports on |
| `allSettled` with uninspected rejections (3 sites) | clean — all three are shutdown or cleanup paths, and two say in a comment why a rejection must not break shutdown |
| boolean-returning functions used as statements | clean — the ones that look dropped (`registerMultiple`, `setDataSources`) answer "did this change anything", not "did this work" |

**Sweep:** for a UI, find the state update and ask what happens to it when the
write fails; for an SDK, find every `catch` around a parse or a fetch and ask
what the caller gets. The tell in both is a **default value produced inside a
failure path** — `{}`, `[]`, `undefined`, or a state update issued before the
promise resolves. A default is an answer, and a failure is not.

### Sweeping on the tell rather than the symptom — 2026-08-10

The previous passes hunted shapes: a `warn` before a `continue`, a `catch` that
logs. Those run out. The tell recorded above — **a default value produced inside
a failure path** — is mechanical enough to grep for and does not:

    catch { return [] }   catch { return null }   catch { return undefined }

Sixty-eight sites across the six server and client packages, forty-eight of them
without so much as a log line. Almost all are right, and reading them is the
fastest tour of what "right" looks like here: `tryCanonicalStorageKey` returns
`null` so a download token "simply matches nothing"; `canonicalRedirectUri`
returns `null` and its caller reads it as *not allowed*; `searchColumnNames`
returns `[]` and says the malformed block "is reported at boot, loudly".

Every one of those defaults is safe because it is the **conservative** answer —
deny, exclude, no-match. The one that was not:

| checked | result |
|---|---|
| `toPattern` in `write-validation.ts` | **BUG.** `undefined` for a `validation.matches` that will not compile, and the caller reads `if (pattern && !pattern.test(value))` — so a typo'd regex does not reject writes, it *removes the rule*. Every value passes, for the lifetime of the deployment. `undefined` here means "no pattern", and "no pattern" is the permissive answer |
| `targetOf` / `relationColumn` in `drizzle-conditions.ts` | clean — an unresolvable target degrades to "column not found", which throws |
| the storage controllers' `null` returns | clean — "not found", which is what the callers ask about |

So the question to ask of a default is not whether it is documented but **which
way it fails**. A default that denies, excludes or reports nothing-found is a
decision; a default that permits is the rule going missing.

And the fix for that one was not at the site. Refusing every write over a config
author's typo blames the caller for someone else's mistake — the runtime comment
was right about that. What was missing was anyone telling the author, so the
check went where this repo already puts config defects with no runtime signal:
`validate-config.ts`, at boot, fatal. The lenient branch stays, pointing at it.

---

## 40. Check-then-act where the backstop exists but its failure is untranslated

The textbook version of this class is a missing guarantee: two callers read
"no such row", both write, and the uniqueness the check promised is gone. Swept
for that here — registration, MFA enrolment, magic links, identity linking, cron
claims, idempotency keys — and the guarantee held every time. Every check has a
unique index, an `ON CONFLICT`, an upsert or a claim row behind it, and where
one did not the repair is already in the history.

What was missing is one layer further out: **what the loser is told**. A check
that exists at all exists because the answer matters to the caller — and the
race path returned a different answer from the sequential path for the same
situation.

`POST /auth/register` reads `getUserByEmail` and answers `409 EMAIL_EXISTS`.
Two clicks on a signup button are two concurrent POSTs; both complete that read
before either insert, and the loser's insert raises 23505 on Postgres or E11000
on Mongo. Neither `createUser` mapped it, so it reached the central handler
unclassified and came back **500 "Internal Server Error"** — the person who
double-clicked is told the server is broken rather than that they already have
an account, and the operator goes looking for a fault that is not there.

Note what is *not* wrong: no deployment ever gets two accounts on one address.
The data is right and the report is wrong, which is why this survives review —
reading the check finds nothing, reading the index finds nothing, and the defect
only appears when you ask what the second caller receives.

**Sweep:** find each check that gates a write, then find the constraint behind
it, then ask **what the constraint's violation turns into**. Three answers and
only one is right:

| the write | the loser gets | verdict |
|---|---|---|
| unmapped insert | 500 from an unclassified driver error | the defect |
| `ON CONFLICT DO NOTHING` / upsert | success, idempotently | right where repeating is a no-op — `linkUserIdentity` on both engines |
| mapped violation | the same 4xx the sequential path gives | right where the caller must know — `createUser`, and `PersistService` for collection writes |

**Watch for:** the difference between those last two being a *decision*. Linking
an identity twice is the same request twice, so the second may quietly succeed.
Registering an email twice is not, so the second must be told. A driver that
picks one of the two by accident is picking a product answer in an insert
statement.

**Watch for, too:** the pair. Both engines had the same hole because each was
written from its own habit rather than from a stated rule — the third time that
shape has produced a finding in this document (`delete`, the filter operators,
this). The rule now sits on `UserRepository.createUser`, where both can read it.

---

## 41. A capability the router mounts and the engine cannot provide

A driver that does not implement something writes a stub. The stub is honest —
it throws, or answers `null` — and the routes above it are mounted for every
backend regardless, because mounting is decided by the auth config and not by
which engine is underneath. So the stub is not a placeholder waiting for an
implementation: it *is* the production behaviour on that engine, for every
caller, every time.

That makes what it throws a user-facing answer, and a bare `Error` is the wrong
one. The central handler classifies an unclassified error as a 500 — and
sanitizes a 500's message on the way out, which is right for a database error
carrying schema internals and exactly wrong here. `POST /auth/mfa/enroll` on a
Mongo backend answered `500 "Internal Server Error"` while the sentence that
explained it, "MFA is not implemented for MongoDB", stayed in the server log.
The person switching on two-factor authentication saw a broken server; the
operator got a ticket about a fault that does not exist.

`init.ts` already had the shape for this, for admin surfaces it mounts and
cannot serve: *"They answer 501 instead, and stay mounted to say why."* An
unimplemented capability is a 501 with the engine and the remedy named, not a
500 with the reason stripped.

**Sweep:** `grep -rn "not implemented\|not supported" packages/*/src` and, for
each, find whether anything routes to it. A stub reachable from a mounted route
is production behaviour. Then read what it throws: a bare `Error` is a 500 with
its message removed.

**Watch for:** the reads in the same group. Six MFA writes throwing had four
sibling reads answering `[]`, `null`, `false`, `0` — and those are *correct*,
because no factor can exist on that engine, which is also what keeps
`assertMfaSatisfied` from gating every login on a backend that has no factors
to gate on. Making a group consistent by turning them all into throws would
have taken the login path down. The rule is not "stubs must throw"; it is that
a stub must answer the question it is actually asked, and a read asked "are
there factors?" can answer truthfully while a write asked to store one cannot.

**Watch for, too:** this being the fourth finding this session from one rule
implemented twice, after `delete`, the filter operators and `createUser`. The
sweep that found it is worth keeping: take the interface, list the methods both
drivers implement, and diff the refusals each can raise. Two engines answering
one question differently is the contract being written twice.

---

## 42. A second door into the same operation

A capability that can be reached two ways gets its checks written on the way
that was built first. The other way keeps working — it authenticates, it scopes,
it writes — and is missing whichever rules live in the first door's *route*
rather than in the thing both of them call.

`assertKnownWriteFields` and `assertWriteValuesValid` were called from
`api-generator.ts` and nowhere else. The WebSocket `SAVE` handler took the
client's payload straight to `driver.save`, so
`PATCH /api/data/users/1 { age: 999 }` was a 400 naming the rule and the same
write over the socket was stored. Everything else about that path was enforced —
auth, an RLS-scoped delegate, the driver's own column check — which is what
makes it hard to see: the door is not open, it is missing one lock.

The socket's own `requireAuth` comment had already named the problem after the
previous divergence: *"this socket is the other enforcement point for one
product decision, and while it computed the answer itself it computed a
different one."* The same sentence applies to the next decision along.

**Sweep:** list what a request passes through on the primary path, in order,
and then walk every other entry point asking which of those it repeats. For
this codebase the doors are the REST router, the two WebSocket servers, the
in-process `rebase.data`, and the auth adapter's own writes. A check that lives
in the route is a check only that route has.

**Watch for:** where the shared rule should live. Moving these into the driver
would have covered every door at once and changed what a `beforeSave` callback
means — the driver validates after callbacks, the route validates before, and
in-process writes are trusted server code the REST layer deliberately does not
validate. So the rule went to the boundary each door owns, as one exported
function, rather than to the funnel underneath them.

**Watch for, too:** the payload that carries its own rules. `SaveProps` has a
`collection` field and it is client-supplied — validating against *that* would
let a caller send an empty properties map and choose to be unvalidated. The
collection has to come from the registry, by path. There is a test for it,
because the mistake is invisible: everything works, and nothing is enforced.

---

## 43. Acquired, then lost before anything could release it

A resource is created, connected, and only then stored in the field that the
rest of the class cleans up. Everything between those two moments can throw, and
if it does, nothing knows the resource exists: `stop()` closes the field, the
reconnect timer closes the field, and the field is still undefined.

Both LISTEN clients had it. `connect()` resolved — the socket was open — and the
`LISTEN` statement was what failed, which is the case that makes this reachable
rather than theoretical: a revoked privilege, a transaction-mode pooler
refusing session state, a channel the server will not take. The reconnect timer
then opened another connection three seconds later, and the failure repeated,
one stranded backend per attempt, until the database stopped accepting them —
surfacing somewhere else entirely as an exhausted pool.

**Sweep:** `grep -rnE "await .*\.connect\(\)|= await open\(|\.acquire\(\)"` and
for each, ask what closes it *on the path that threw*. A `finally` answers it; a
release at the end of the happy path does not; and a release keyed on a field
that is assigned after the risky work is the trap — it reads like cleanup and
covers nothing.

**Watch for:** the handover. The fix is a local that holds the resource until
the field adopts it, cleared on success so the failure path cannot close a
connection the class now owns. Both halves matter: without the clear, a
successful start closes its own listener.


---

## 44. Concurrent refreshes of one view, delivered in whatever order they finish

A subscription's update is a *re-fetch*: something happens, the server reads the
current state and hands the client the whole answer. As soon as more than one
thing can start a re-fetch, two are in flight at once — and the one that started
first can finish last. The callback replaces everything the client has, so the
client goes back to the state before the change and stays there, silently, until
something else touches that collection.

The MongoDB realtime service had three independent starters for one
subscription: the initial fetch at subscribe time, the change stream, and
`notifyUpdate` after a save. The initial fetch is the reliable way in, because it
is dispatched fire-and-forget and the change handler is registered *after* it —
so any write in that window produces two fetches with nothing ordering them.

Two neighbours fall out of the same missing check, and they are worth naming
separately because they read as different bugs:

- **Cancelled.** The subscription is gone by the time the fetch lands, and the
  callback belongs to a client that stopped listening. A `has(id)` check before
  the await does not answer this; only one after it does.
- **Replaced.** `subscribeToCollection` unsubscribes before re-registering, so
  one id can name a *different* subscription by the time an old fetch returns —
  and the previous filter's rows are delivered to the new subscriber.

**Sweep:** find every callback invoked after an await, and ask what guarantees
it is still the newest answer *and* still wanted. A sequence number taken before
the await and checked after it answers all three at once. Synchronous deliveries
have to claim a slot too: a `delete` notification carries no fetch, but it is the
newest fact about the row, so it must be able to close the door on a re-fetch
still in flight rather than be overwritten by one.

**Watch for:** a debounce read as a fix. It collapses a burst into one refetch
and does nothing about two refetches that overlap — the Postgres realtime service
debounces per subscription and still races, and it re-checks the subscription map
before the await rather than after. Debouncing changes how often the race is
reachable, not whether it is.


---

## 45. A key the renderer answers with its own name

Lookup by string is a contract nothing checks. `t("sort_then_by")` compiles
whether or not anything declares `sort_then_by`, and i18next answers a key it
does not know with *the key* — not an error, not empty, not the English. The
literal string `sort_then_by` is rendered into the interface as if it were a
translation, and it looks like a translation to every automated check that runs
over it: the types are satisfied, the component renders, the test asserting the
element exists passes.

The multi-column sort menu shipped six of them. `sort_then_by`, `sort_move_up`,
`sort_move_down`, `sort_remove_key`, `sort_ascending` and `sort_descending` were
referenced by `SortButton.tsx` and declared by none of the seven locale files,
so the popover's section heading read "sort_then_by" and every tooltip on it
read like a variable name. Nothing failed. Every one of those keys was on a
control added in the same change as the feature, which is the pattern: the
strings that go missing are the *new* ones, because the old ones were added when
somebody was thinking about the catalogue.

A second shape hides the same defect behind an apology for it:

```tsx
{t("save_entity_before_subcollections") ?? "You need to save your entity first"}
```

The `??` never fires — `t` returns the key, which is truthy — so the fallback is
dead code that reads as a safety net and is the tell that the author was not
sure the key existed. It did not.

**Sweep:** collect every literal key the source passes to the lookup and check
it against the catalogue. This is a text scan, not a type: the whole class
exists because the type is `string`. Ask the same of any other
lookup-by-string — icon registries, property-config ids, slot names, feature
flags — and specifically of the ones whose miss returns something *plausible*
rather than throwing.

**Watch for:** a fallback catalogue that hides the gap one level down. English
seeds every other locale here, so a key added to `en.ts` alone renders in
English rather than as an identifier — milder, invisible in an English-language
review, and 159 instances deep by the time anybody looked. A bare zero was not
reachable, so that half is a baseline that only shrinks
(`packages/app/test/translation-keys-baseline.json`), on the same reasoning
`check-untranslated.mjs` gives for its own: ambient findings make the next one
invisible.

### Last sweep — 2026-08-15, the admin's translation catalogue

294 literal keys across `packages/app/src` and `packages/admin/src`, against the
891 `en.ts` declares. Seven missing, all seven fixed: the six sort keys above and
`save_entity_before_subcollections`. Gated by
`packages/app/test/translation-keys.test.ts` at zero, so the next one fails on
the way in.

---

## 46. State the test suite can only reach by staging it

Every suite here starts a server, loads a page, and drives it. That is one
moment in the life of a deployment: the moment when the running code, the files
on disk and the tab in the browser are the same build. Some failures only exist
when they are *not*.

The stale tab is the plain example. A built SPA names its chunks by content hash
and a deploy replaces the whole `assets/` directory, so a tab opened before the
deploy still holds the previous entry chunk. It keeps working — until the user
opens the first view it had not already fetched, and the import asks for a hash
the server no longer has. The user gets a dead pane reading "Failed to fetch
dynamically imported module: .../RouterCollectionsStudioView-<hash>.js", which
names a filename and reads like a broken build, so it is reported as one.

Nothing in a normal suite can produce it. Playwright loads one build and never
replaces it underneath the page; the CI job builds and serves the same tree. The
state is not rare in production — it is what *every* user with an open tab is in,
for as long as they keep it open after a deploy — and it is unreachable by
construction in test. It is the "aged" row of §1 wearing a different hat: the
thing under test was made by one version and is being used by another.

The server made it worse in the way this class usually does. `serveSPA` answered
every unmatched path with `index.html`, missing `/assets/*.js` included, so the
browser got a 200 of HTML where it asked for a module. The one response that
would have named the problem — a 404 — was the one response the server could not
give.

**Sweep:** for anything the code assumes is *the same* across a request, name
what happens when it is not. Chunk hashes across a deploy. A client SDK older
than the API it calls. A schema written by a previous release (§1). A cached
`index.html` in front of an origin that has moved on. A WebSocket that outlives
the process it connected to. Ask, in each case, what the user sees — and whether
the answer is a sentence they can act on or a filename.

**Watch for:** the version-skew test that stages nothing and asserts anyway.
`e2e/tests/stale-tab-after-deploy.spec.ts` fulfils the chunk request with
`index.html` — the exact response the old server gave — and then asserts the
interception fired at all, because a route pattern that never matched leaves a
green test that proves nothing.

### Last sweep — 2026-08-16, chunk loading across a deploy

Every `lazy()` in `packages/admin`, `packages/studio` and `packages/app` — 19
call sites, the last of which resolves every user-supplied custom view — now
goes through `lazyChunk`, which retries once and then fails with
an error `ErrorBoundary` renders as "New version available" plus a reload, rather
than the browser's wording. `serveSPA` 404s a missing build artifact instead of
serving the index. Both covered: `packages/ui/test/lazy-chunk.test.tsx`,
`packages/server/src/serve-spa.test.ts` and the staged-deploy e2e above, which
fails on a mutation that removes either half.

---

## 47. A containing block on the element popups are portalled into

The sibling of class 25, one layer down: the layer is painted *above* everything
it should be, and still nobody can see it, because it is positioned against the
wrong box.

`position: fixed` resolves against the viewport — unless an ancestor is a
**containing block**, which `transform`, `will-change: transform`, `filter`,
`backdrop-filter`, `perspective` and `contain: paint` all create. Then the same
coordinates resolve against that ancestor instead, and everything fixed inside it
lands displaced by the ancestor's own offset.

`Sheet` hands its descendants a portal host — itself — so their popups open inside
the modal, where the focus and scroll locks let them be used at all. It also wore
`will-change-transform` for the slide-in. Radix's item-aligned `Select` content is
`position: fixed`, positioned from `getBoundingClientRect()` in viewport
coordinates, so every dropdown in a side panel was pushed right by the panel's left
offset: `left: 992px` computed, painted at `x = 1145`, off a 1280px screen. Open,
correct, unreachable — and indistinguishable from a Select that ignores clicks,
which is how it was reported.

Radix's *popper* positioning was unaffected in the same panel: Floating UI measures
the offset parent and subtracts it. Only the hand-rolled viewport math broke, which
is why one component looked broken and its neighbours did not.

**Sweep:** find the portal hosts, then read the classes on each and on everything
between it and the document root. `grep -rn "PortalContainerProvider" packages/*/src`
gives the hosts (`Sheet`, `Dialog`); for each, check for the six properties above.
`Dialog` passes: its host is a zero-sized `relative z-70` div and no ancestor is
transformed — the paper that *is* scaled (`scale-100`) is a sibling of the host, not
its parent. That is the shape to copy.

**Watch for:** the hint that costs nothing being the whole bug. `will-change:
transform` is advice to the compositor with no visual effect whatsoever, so it reads
as free and survives every review of the animation it was added for — while quietly
re-parenting the coordinate system of every fixed descendant. `transform-gpu` in the
same class list had already been dropped by `twMerge` (it conflicts with `transform`),
so the one surviving line was the one nobody would suspect. Covered by
`packages/ui/test/sheet-portal-container.test.tsx`, which asserts the host wears none
of them.
