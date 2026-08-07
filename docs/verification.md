# Verification beyond tests

This document is about a question worth asking directly: could we have *proof*
that the code is correct, rather than a suite of examples that happen to pass?

The honest answer is that machine-checked proof of this codebase is not worth
buying, and the reason is empirical rather than ideological. Look at what
actually breaks here. From `bug-classes.md` and the sweep log: migrations
skipped by a high-water mark, a role name colliding with a schema name in
`search_path`, an unqualified `id` binding to the inner table in an RLS
subquery, undeclared runtime dependencies that npm hoisting hides and pnpm's
strict layout exposes, `git status` lying because of a stale fsmonitor, the last
`navigate()` winning. Almost none of those are statements about a function that
a theorem prover could have settled. They live in the gap between a model and
its environment, and that gap is exactly where a proof has nothing to say —
because the proof is *about* the model.

But "proof of everything" and "tests only" are not the two options. There is a
ladder, and most of its value is in the middle:

| rung | what it establishes | cost |
|---|---|---|
| types | shapes agree | already paid |
| example tests | *these* inputs behave | cheap, and blind to everything unlisted |
| **properties** | **a law holds for all inputs of a shape** | **hours** |
| **exhaustive small-scope** | **no counterexample of a bounded size exists** | **hours** |
| model checking (TLA+/Alloy) | a *design* has no reachable bad state | days |
| machine-checked proof | an implementation refines a spec | months |

The two bold rungs are what this repository now uses, and what the rest of this
document describes. The comparison that matters is not against proof — it is
against the example tests we were already writing. A property covers the inputs
nobody thought of, which is where bugs live by definition, because an input
somebody thought of already has a test.

## What a property buys, concretely

Six defects were found by writing the properties below, in code that already had
passing example suites. Four were on paths that write to a database.

**A raw `using:` clause could compile to an unconditional grant.** `sqlToPolicy`
tested for a `rebase.uid()` call with an unanchored regex, so an operand that
merely *contained* one was replaced wholesale by the call — discarding whatever
surrounded it, including a leading `NOT (`. `NOT (rebase.uid() = rebase.uid())`
parsed as `rebase.uid() = rebase.uid()`: a deny became an unconditional allow.
The realistic spelling is a defensive hand-written rule with a uid call on both
sides, `COALESCE(rebase.uid(), '') = COALESCE(owner_id, rebase.uid())`, which
collapsed to the same tautology. This is not confined to the admin UI —
`securityRuleToConditions` feeds a rule's raw `using:` through this parser and
the Postgres generators compile the result, so the tautology was written into
the database as the policy body.

**Quoted literals grew on every round trip.** `quoteLiteral` doubles quotes and
nothing undid it: `O'Brien` → `O''Brien` → `O''''Brien`. Past the first trip the
policy compares against a string no row holds.

**Unquoted literals came back as column references.** `a = false` re-read as a
comparison against a *field* named `false`. The recompiled SQL is byte-identical,
which is why a round-trip check on the SQL alone would not have caught it — but
the expression is now wrong, and the expression is what the admin UI evaluates.
Against a row with no `a`, Postgres denies while the JavaScript evaluator
compared two missing columns, found them equal, and allowed. That is precisely
the client/database drift the shared `PolicyExpression` model exists to prevent.

**A comma in a filter value split the condition in two.** Values were escaped
inside a list (`in.(a\,b)`) but not when they stood alone, even though a scalar
inside an `and(...)`/`or(...)` group sits between the same delimiters:
`or(name.eq.Doe, John,age.gte.18)` parsed as *three* conditions, the middle one a
fabricated `" John" == true`. On an `or` that widens the result set.

**A field name that snake-cases to empty emitted invalid SQL.**
`toSnakeCase("_")` is `""`, so `policy.field("_")` compiled to `= 'x'`.

**A storage key ending in `/.` lost its trailing-slash folder marker.**
`canonicalStorageKey("public/.")` returned `public`, while `public/./` returned
`public/` — `path.posix.normalize` drops the distinction in one spelling and not
the other. That contradicts the module's own rule (a trailing slash is preserved
because it is how the folder route marks a prefix) and is not cosmetic on `list`,
where a prefix of `public` also matches `publicity/` and hands back keys the
caller never asked for.

**String ordering in the offline cache cannot match the server — now declared
rather than silently wrong.** `compareValues` orders strings with an
`Intl.Collator`; PostgreSQL uses the database's collation, which the client has
never been told. `'apple' < 'Banana'` is false under the C collation, true under
`en_US.UTF-8`, and true for the collator, so a cache hit on `name < 'Banana'`
returns a different set from the server. The comparator is unchanged — neither
side is wrong — but the *promise* was: `isExactlyEvaluable` now refuses any
ordering comparison, and a new `isLocallySortable` decides whether the overlay
may re-sort a page or must keep the server's order.

Two things worth knowing about the shape of that fix. First, it refuses
*numeric* ranges too, not only string ones: `compareValues` deliberately reads
numeric strings as numbers, so it cannot tell an integer column from a text
column of digits, and on the latter Postgres orders `"10"` before `"9"` while
this orders 9 before 10. The operand's type does not settle it and `params`
carries nothing else. Passing the collection schema into `isExactlyEvaluable`
would let a number- or date-typed column be claimed again, and is the obvious
next move if the conservatism bites.

Second, the cost is bounded and is a *degradation*, not a loss: `exact` gates
whether locally-created rows are injected into page zero, whether a locally
edited row that no longer matches is removed, and whether queued writes adjust
a count. It does not gate whether the cache answers at all — the server's
snapshot is still the skeleton. So an affected query keeps working and stops
placing unsynced local writes optimistically, and the result now carries
`partial: true` to say so.

**ORDER BY has no deterministic tiebreaker.** Sorting on a column with duplicate
values leaves the order of tied rows undefined, so `LIMIT`/`OFFSET` paging over
it can skip a row and repeat another between two requests, with no error and no
way for the client to notice. The offline cache cannot reproduce the server's
arbitrary choice either. The standard fix is to append the primary key to every
generated ORDER BY; that changes generated SQL and index expectations.

**The configured list default is not bounded by the configured cap.** `maxLimit`
is applied only to a client-supplied `?limit`. A deployment with `defaultLimit`
above `maxLimit` answers a bare `GET /<collection>` with more rows than its own
cap allows — exactly for the request that carries no limit, which is the one the
cap exists for. Only reachable by misconfiguration, and nothing rejects the
inversion, so it is silent. Rejecting the inverted config at boot is probably
better than clamping.

**"Cannot evaluate" and "definitively not granted" are both spelled `unknown`.**
Since the NULL-comparison fix, `evaluatePolicy` returns `"unknown"` both when it
genuinely cannot decide (raw SQL, a membership subquery, no row in hand) and when
SQL would answer NULL — where the row is *definitely* not granted. Only the first
deserves the optimism that `onUnknown: "allow"` gives it, and optimistic gating
now shows an edit button on rows whose owner column is NULL. Enforcement paths
are unaffected (they resolve fail-closed). Distinguishing the two is a change to
`TriState`, which is API surface across packages.

**A generated policy name can overrun PostgreSQL's identifier limit.** Found and
pinned, not fixed — see the open items below.

The last of those is worth a note on method, because it did not fail cleanly. It
failed *intermittently* — about one run in three — since the counterexample
needed a specific segment the generator produced only sometimes. An intermittent
property failure reads like flakiness and is nearly always the opposite: a
property is deterministic given its input, so an intermittent failure means the
input space contains a counterexample that sampling reaches sometimes. The
correct response is to capture the counterexample, never to retry until green.
The first counterexample found this way turned out to be a mistake in the
property itself (`isPublicStoragePath` accepts full URLs while the canonicalizer
does not — different domains, both correct); the second, at the same assertion,
was the real defect above.

The pattern worth noticing: every one is a case a reasonable person would not
have put in a fixture. Nobody writes `O'Brien` into a policy test by accident,
and nobody writes `NOT (rebase.uid() = rebase.uid())` at all — but the generator
does, because it does not know which inputs are interesting.

## What is verified now

Each entry is a law, not a set of cases. Run counts are per property.

### Policy SQL — `packages/common/test/property/policy-roundtrip.property.test.ts`

The `sqlToPolicy` doc comment already stated the specification: its output
"round-trips back into DDL … decomposing a clause the parser only partly
understands is not a cosmetic mistake — it emits invalid SQL". These make that
sentence checkable.

- Compilation is total, and emits balanced parentheses outside string literals.
- **Compile → parse → compile reaches a fixed point after one trip.** This is
  what catches a parser that decomposes something it should have left alone: the
  halves re-emit with different parens, and parsing those gives a different tree
  again. Policy bodies are read and rewritten constantly — the UI reads them back,
  the Studio saves them, boot recompiles them — so a non-fixed-point is a rule
  that mutates a little on every save.
- **A subquery alias is never referenced outside the subquery that binds it.**
  This is "missing FROM-clause entry for table" stated as a scope invariant, and
  unlike paren balance it discriminates the bug: the broken output was balanced.
- **A round trip never turns a denial into a grant.** Losing precision is
  allowed — an unparsed clause becomes `raw`, which the evaluator reports as
  `"unknown"` and enforcement callers resolve fail-closed. Inverting is not.
- The converse, separately and more weakly: a grant may degrade to `"unknown"`
  but must not invert to a denial.
- Every anonymous-grant risk detectable before a round trip is still detectable
  after it — a check that stops recognising a dangerous clause is a check that
  silently turned off.
- The parser does not throw on arbitrary input, and settles on it.

### Filter wire codec — `packages/common/test/property/filter-dialect.property.test.ts`

The codec is deliberately lossy about types (the wire carries no type metadata),
so the law is idempotence through the wire rather than equality:
`serialize ∘ deserialize ∘ serialize = serialize`.

- The operator tables are mutual inverses, checked in both directions. Two
  hand-maintained objects, and an operator in one but not the other is a filter
  that silently comes back as something else.
- The operator itself is never lossy, for every operator in the union.
- Every condition survives when a field carries several — losing one turns
  `18 <= age < 65` into `age >= 18`, a wider result set and no error.
- The escaping layer gets the *strong* law, exact equality: a comma inside a
  value and a comma between two values are different things.
- The nesting guard is checked at its boundary, and for every depth beyond —
  it must raise a real error rather than overflow the stack.

### Client → server query contract — `packages/server/test/property/query-contract.property.test.ts`

Two modules in two packages with no shared type between them. The law is that
nothing is silently lost: every filtered field and operator, the sort, the
offset, the includes. No filter is invented. The limit moves only downward and
is never unset. Hono's `c.req.queries()` is reproduced rather than mocked,
because repeated parameters are part of what is being checked.

### Storage keys — `packages/server/test/property/storage-keys.property.test.ts`

- Canonicalization is idempotent, and total: every input either canonicalizes or
  is refused.
- Every canonical key resolves inside its bucket.
- **Prefix soundness:** a key that *reads* as being under a prefix *lands* under
  it on disk. This is the exact link the old sanitizer broke, and the only reason
  a prefix-based `storageAuthorize` hook means anything.
- A regression witness reproduces the old `sanitizeStorageKey` and shows it
  violating that property. Without it, a future "simplification" back to
  stripping would satisfy the other properties by construction — a stripper does
  produce keys with no `..` segment. The defect was never in the output alphabet.

### Policy names — `packages/utils/test/property/policy-names.property.test.ts`

- The digest changes when any semantic field changes, stated field by field.
  The likeliest future regression is someone adding a field to `SecurityRule` and
  not adding it to the hash, after which two rules compile to one name and one
  silently replaces the other in the database.
- It ignores key order and the order of role sets, and ignores `name` — pinned so
  that "add every field to the hash" is not later applied mechanically, which
  would rename every named rule's fallback in every deployed database.

### Kanban placement — `packages/ui/test/kanban-placement-exhaustive.test.ts`

Not sampled — **enumerated**. Every column up to five cards, every card as the
moved one, every drop target, both `changedColumn` values: 224 cases, complete.
That is a stronger statement than any number of random draws. Not "no
counterexample was found" but "there is none of this size". No card is lost,
duplicated or invented; untouched cards keep their relative order; a drop onto
itself is a no-op.

### Policy semantics vs. real PostgreSQL — `packages/server-postgres/test/e2e/policy-agreement-exhaustive.test.ts`

The differential this document previously listed as the biggest gap. Every
policy expression of depth two over fifteen leaves — 480 of them — compiled,
executed against a real database as three different callers on three rows
chosen to put a NULL in every column position, and compared with
`evaluatePolicy`. Requires Docker.

Two directions, deliberately separate: JavaScript is never more permissive than
Postgres (the panel must not offer what the database refuses) and never more
restrictive (the model's promise is agreement, not conservatism). Plus: every
compiled expression must actually execute.

This found the NULL-comparison defect described above, and then found a second
one after the first was fixed.

### Membership policies — `packages/server-postgres/test/e2e/exists-in-enforcement.test.ts`

`policy.existsIn` compiles to a correlated `EXISTS` and was previously only ever
checked as a string. A string test cannot see the failure that matters, because
it is not a syntax error: an unqualified `outerField` makes the correlation
collapse into `m.x = m.x`, and the policy quietly changes from "documents on a
team you belong to" to "documents, if you belong to any team". It compiles, it
runs, it returns rows.

So the policy is installed as a real `CREATE POLICY`, read back as each user
through `rebase_user`, and compared with a reference computed in JavaScript from
the same fixture. The suite also installs the collapsed version on purpose and
shows it behaving differently — otherwise the assertions would pass equally
against a compiler that had regressed some other way into denying rows, and the
suite would be measuring the fixture rather than the correlation. Covers sibling
subqueries and the negated form. No defect found.

### Refresh-token rotation — `packages/server/test/property/refresh-rotation.property.test.ts`

Driven as a state machine, because the handler's comments are claims about
*sequences*: a client that never received the answer, two tabs booting together,
a refresh in flight when a password reset lands. Random operation sequences
against a real in-memory store — not jest mocks, which return what the previous
line told them to and therefore cannot have a state machine's bugs — with every
token ever issued re-checked after every step. That last part is what an example
test cannot do: not "the operation I just performed was right" but "nothing else
moved". 8000 sequences, no violation.

### Offline evaluator vs. the server — `packages/server-postgres/test/e2e/offline-query-agreement.test.ts`

`isExactlyEvaluable` promises a cache hit is not an approximation. Most of that
promise holds and is asserted strictly: equality with the wire's type erasure,
all four NULL-testing operators, membership, and all four `LIKE` variants select
identical rows, as does sorting and paging on a reproducible column.

Where it could not hold, the promise was narrowed rather than the divergence
tolerated, and the suite now asserts the *contract* as well as the divergence:
every query that diverges is one `isExactlyEvaluable` declines, every query that
agrees is still claimed, and the text column the overlay must not re-sort is one
`isLocallySortable` refuses. Asserting both halves is what stops a narrowing from
becoming a blanket refusal dressed up as a fix.

The tie-ordering divergence remains open — see below.

### Shared list limits — `packages/server/test/property/list-limits.property.test.ts`

The clamp REST and the WebSocket ingress share. Bounded, never more than asked
for, monotone, and identical across the numeric and string spellings.

### Portable SHA-1 — `packages/utils/test/property/sha1.property.test.ts`

Against `node:crypto` on arbitrary unicode, binary strings, JSON-shaped input,
every length through three blocks, and lone surrogates — the case that usually
separates a hand-rolled UTF-8 encoder from Node's. No divergence.

## Running them

They run in the normal `pnpm test`, at a run count chosen to stay in CI. To
spend more:

```bash
FC_RUNS=200000 pnpm test
```

Worth doing after changing a parser, a codec, or the policy compiler. The point
of a property is that it keeps paying out when you spend more on it — which is
also the honest test of whether a property is any good.

## What is NOT verified, and why

Being explicit about this is the difference between a verification effort and a
badge.

**The Postgres checks are bounded, not general.** The differential executes 480
expressions of depth two over one table with four columns. That is a real check
against real SQL semantics — it is what found the NULL-comparison defect — but
it is not "the compiler is correct". Generated schemas, more column types
(arrays, jsonb, timestamps, uuid), and `existsIn` inside the generated grammar
are all still missing, and each is a place the two evaluators could part without
anything here noticing.

**Nothing here is a proof.** A property that passes 200,000 times has not been
proved; it has failed to be refuted 200,000 times. For the parser that is a
strong signal because the input space is structured and the generator covers it.
For anything with a wide state space it is much weaker than it looks. The
exhaustive checks (kanban placement, the policy differential) are the exception
and say something stronger, but only within their stated scope.

**The generator is part of the claim.** The identifier-limit property below
originally passed for a bad reason: `fc.stringMatching` biases towards short
strings and never generated a long enough table name. A generator that cannot
reach the interesting end of the input space turns a property into a decoration.
When reading these, read the arbitraries too.

**Concurrency is only half addressed.** Refresh-token rotation is now driven as
a state machine over random operation sequences, which covers the *ordering* of
operations. It does not cover true interleaving — two requests genuinely in
flight against one store — and the realtime/CDC path, the WebSocket auth race
and device sessions are untouched. "Can any interleaving reach a state where a
rotated token is accepted twice" remains a model-checking question.

**The authorization model as a whole is unverified.** "Can any principal reach
any row they should not" over a bounded universe of users, orgs and collections
is an Alloy question, and remains the most valuable single thing that could be
added. The work here verifies that a rule means the same thing everywhere it is
consumed; it says nothing about whether the *set* of rules a project ends up
with admits something it shouldn't.

**Two findings are load-bearing and unfixed.** The collation divergence in the
offline cache and the missing ORDER BY tiebreaker are both live, both silent,
and both pinned by tests that currently assert the *broken* behaviour so that
fixing it is a visible decision. Do not read a green suite as "no known
problems" — read the open items.

## Open items found along the way

Each of these is real, reproduced, and deliberately left unfixed because the fix
is a judgement call rather than a correction.

**Generated policy names can overrun PostgreSQL's 63-byte identifier limit.**
Past a 48-character table name (46 for a multi-operation rule) the name
`<table>_<op>_<7 hex>` is too long, and PostgreSQL truncates rather than
rejecting. The policy is then created under a name the generator does not know
it has, so `checkPolicyDrift` reports the live policy as orphaned and the
expected one as missing — permanently, with `rls:check` never able to go green
and nothing pointing at the cause. It is not destructive: truncation always eats
into the hash, so `isGeneratedPolicyName` stops matching and orphan cleanup keeps
the policy rather than dropping it. Unfixed because every fix renames identifiers
already in deployed databases — see the frozen-derived-names rule. Pinned in
`policy-names.property.test.ts`.

**A filter on a column whose name collides with a reserved query parameter is
silently not applied.** `?page=eq.home` is read as pagination, and the read
returns every row the caller may see rather than the ones on the `home` page.
Thirteen of the fourteen reserved names fail this way; only `where` reports
anything, and only by accident (`eq.x` is not valid JSON). `page`, `fields`,
`include`, `or`, `and` and `limit` are all plausible column names. Every fix is a
wire change — namespacing filters, or requiring `?where=` for colliding fields —
so it should be chosen deliberately. Pinned in `query-contract.property.test.ts`,
which also fails if the reserved set grows, since adding a name is today a
breaking change for anyone whose schema already uses it.

**Board order keys are structurally untestable in `packages/admin`.**
`fractional-indexing` is ESM-only and `packages/admin` runs CommonJS ts-jest, so
the module that owns `ORDER_KEY_DIGITS` and `isValidOrderKey` cannot be imported
by that runner at all — neither statically nor by dynamic `import()`, which
ts-jest transpiles to `require`. The collation-safety reasoning behind the
base36 alphabet is therefore asserted only by a comment. The `placeDroppedCard`
properties in `packages/ui` cover the part that is reachable.

**`app/backend/src/seed.ts` reimplements order-key generation** with a doc
comment claiming it produces "exactly what `generateNKeysBetween(null, null, n,
ORDER_KEY_DIGITS)` emits". That equivalence is not checked anywhere: the function
is not exported and `app/backend` has no test runner. Either export it and test
it, or depend on the library and delete the copy.

**A raw storage key can read as private and canonicalize as public.**
`isPublicStoragePath("./public/x")` is false while `canonicalStorageKey("./public/x")`
is `public/x`. Nothing is bypassed — the object really is under the public prefix
— but a caller reasoning about the raw key understates the exposure. The existing
rule applies: decide on the canonical key, never on the one that arrived.

## If you want to go further

The three biggest gaps this document named have since been closed: the Postgres
differential, the membership-policy execution check, and the refresh-rotation
state machine. What is left, in rough order of value per hour:

1. **Alloy (or a bounded exhaustive checker) over the authorization model.** A
   universe of users, orgs, collections and rules, with the assertion that no
   principal reaches a row no rule grants them. The policy work verifies that a
   rule means the same thing everywhere; it says nothing about whether the *set*
   of rules admits something it shouldn't. Still the most valuable single
   addition.
2. **Widen the Postgres differential.** It covers depth two over fifteen leaves
   on one table. Generated schemas, more column types (arrays, jsonb, timestamps,
   uuid), and `existsIn` inside the generated grammar would all extend it
   cheaply, since the harness now exists.
3. **The realtime/CDC path.** Subscriptions, the auth race, and refetch under
   RLS — a state machine like the refresh one, and the same reasons apply.
4. **Migration ordering.** The high-water-mark rule that silently skips an
   out-of-order migration is a property about sequences of releases, and
   `upgrade-e2e` already has the fixtures to state it over.

None of these is a proof either. All are cheaper than one, and aimed at the
places this codebase actually breaks.
