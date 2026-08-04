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

**Sweep:** for any fixture key, `grep` it in `packages/types/src`. Zero hits on
a field the production code branches on is this bug. Then check whether that
test directory is in `tsconfig.tests.json`; if not, it cannot warn you.

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
