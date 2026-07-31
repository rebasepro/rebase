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
