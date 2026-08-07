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

**Nothing here proves anything about PostgreSQL.** The policy properties are
about the parser and the compiler agreeing with each other and with the
JavaScript evaluator. Whether the emitted SQL *means* what we think it means is
decided by Postgres, and the only honest way to check that is to execute it. The
right shape is differential: generate random schema + policy + row triples,
execute against a real database, and compare against the JavaScript evaluator.
That would catch a whole class the current properties cannot — and would need
the `server-postgres` e2e harness rather than a unit suite.

**Nothing here is a proof.** A property that passes 200,000 times has not been
proved; it has failed to be refuted 200,000 times. For the parser that is a
strong signal because the input space is structured and the generator covers it.
For anything with a wide state space it is much weaker than it looks.

**The generator is part of the claim.** The identifier-limit property below
originally passed for a bad reason: `fc.stringMatching` biases towards short
strings and never generated a long enough table name. A generator that cannot
reach the interesting end of the input space turns a property into a decoration.
When reading these, read the arbitraries too.

**The concurrency-shaped bugs are untouched.** Refresh-token rotation, the
WebSocket auth race, device sessions — these are where model checking (TLA+ or
Alloy) would earn its keep, because "can any interleaving reach a state where a
rotated token is accepted twice" is a question a test suite structurally cannot
answer. Nothing here attempts it.

**The authorization model as a whole is unverified.** "Can any principal reach
any row they should not" over a bounded universe of users, orgs and collections
is an Alloy question, and the most valuable single thing that could be added
next. The policy properties verify that a rule survives a round trip; they say
nothing about whether the *set* of rules admits something it shouldn't.

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

In rough order of value per hour:

1. **Differential policy testing against a real Postgres.** Random schema +
   policy + row, executed, compared against `evaluatePolicy`. This is the single
   biggest gap, because it is the only thing that checks the emitted SQL against
   the semantics that actually decide access.
2. **Alloy model of the authorization model.** Bounded universe of users, orgs,
   collections and rules; the assertion is that no principal reaches a row no
   rule grants them. Answers a question the test suite structurally cannot.
3. **TLA+ or a stateful property model of refresh-token rotation.** Reuse
   detection, the grace window, session revocation, the WebSocket auth race.
4. **Properties on the offline query evaluator** against the server's semantics
   — `isExactlyEvaluable` claims soundness that nothing checks.

None of these is a proof either. All of them are cheaper than one, and aimed at
the places where this codebase actually breaks.
