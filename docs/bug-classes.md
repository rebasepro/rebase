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
