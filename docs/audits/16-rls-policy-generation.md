# Unit 16 — RLS policy generation

**Scope:** `packages/server-postgres/src/security/rls-enforcement.ts`,
`schema/rls-bootstrap-sql.ts`, `schema/ensure-collection-policies.ts`,
`schema/generate-postgres-ddl-logic.ts` (the policy half),
`packages/common/src/util/policy/{policyToPostgres,securityRuleToConditions,sqlToPolicy}.ts`,
`packages/common/src/util/{auth-default-policies,junction-policies}.ts`,
`packages/utils/src/policy-names.ts`.
Read-only. Compile output was verified by running the shipped
`@rebasepro/common` build against hand-built rule fixtures (no database).

---

## Verdict

The *expression compiler* is in good shape: the two regressions named in the
brief — the `AND` hoisted out of an `EXISTS`, and a bare `id` in a subquery
binding to the inner table — are genuinely fixed and I reproduced the corrected
output; `sqlToPolicy` respects SQL precedence, is paren- and string-depth aware,
and prefers verbatim `raw` over a half-understood decomposition; the
operation→clause matrix (`USING` for select/update/delete/all, `WITH CHECK` for
insert/update/all) is right; and an unexpressible clause becomes `false`, not a
grant. What is not in good shape is everything *around* the name of a policy.
Policy names are generated but never truncated to Postgres's 63-byte limit even
though this repo has a `toPostgresIdentifier` helper written for exactly that
hazard; the two "mirrored" plan/DDL emitters key their table maps differently
(`schema.table` vs bare `table`), so one of them silently drops a collection;
the reconciler that removes superseded policies lives only in the CLI, so the
managed runtime — the one deployment target that *cannot* run `rebase db push`
— accumulates stale permissive grants forever and a tightening never lands. Two
further findings are class-36 shapes: the live-database tautology detector was
never re-pointed at `rebase.uid()` after the 1.0 rename and is therefore blind
to every policy the current generator writes, and `disableDefaultPolicies`
removes the *restrictive* privilege-escalation gate on auth collections with no
warning from anything. Three high, seven medium, seven low.

---

## Critical

None.

---

## High

### H1 — The managed runtime applies policies but never reconciles them, and the thing documented to do that job cannot reach a managed tenant

`packages/server-postgres/src/schema/ensure-collection-policies.ts:19-24`,
`:86-94`; `packages/server-postgres/src/cli.ts:482-507`;
`packages/server/src/boot/boot.ts:811-858`;
`packages/utils/src/policy-names.ts:49-56`

An unnamed rule compiles to `<table>_<op>_<sha1[0:7]>`, and the hash covers the
rule's semantics — so *editing* a rule renames its policy.
`ensure-collection-policies.ts` only ever emits `DROP POLICY IF EXISTS <newname>`
+ `CREATE POLICY <newname>`, and its module doc says so explicitly: "a policy a
previous push left behind under an old name is not removed here; that stays a
`db push` / `db migrate` concern" (`:22-24`). The reconciler does exist —
`reconcilePolicies` in `cli.ts:495`, calling `dropOrphanedPolicies` — but it is
wired only into the CLI's `db push`. And the entire stated reason
`ensure-collection-policies.ts` exists (`:11-15`) is that `db push` "drives Atlas
against a local `DATABASE_URL`, and a managed tenant's database is reachable
only from inside the cluster". So on the managed runtime the cleanup step is
unreachable by construction, and nothing at boot substitutes for it.

*Failure scenario.* A managed tenant ships `posts` with
`securityRules: [{ operation: "select", access: "public" }]`. Boot creates
`posts_select_a1b2c3d` with `USING (true)`. The author realises the mistake and
changes it to `{ operation: "select", ownerField: "author_id" }` and redeploys.
The new hash produces `posts_select_9f8e7d6`, which is created with
`USING ((author_id)::text = rebase.uid())`. `posts_select_a1b2c3d` is still
there. Postgres ORs permissive policies, so every row of `posts` is still
world-readable, the deploy logs `Applied N RLS policy statement(s)`, and nothing
anywhere reports it.

*Fix direction.* Run the orphan sweep from the boot path too: after
`ensureCollectionPolicies` succeeds for a table, drop live policies on that table
whose names match `isGeneratedPolicyName` and are not in
`getGeneratedPolicyNames(collection)`. That set is already derived once
(`auth-default-policies.ts:178-180`) and `dropOrphanedPolicies` already restricts
itself to managed tables, so this is a wiring change, not new logic. Failing
that, the boot must at minimum *warn* per orphan — silence is what makes this
dangerous.

### H2 — The live-policy tautology detector still matches only the pre-1.0 `auth.uid()`, so it is blind to every policy the current generator writes

`packages/server-postgres/src/security/policy-drift.ts:160-168`, `:210-222`;
`packages/common/src/util/policy/policyToPostgres.ts:99`;
`packages/types/src/types/policy.ts:75`

```js
if (!/auth\.uid\(\)\s*is not null/.test(flat)) return false;
return !/<>\s*'anonymous'/.test(flat) && !/!=\s*'anonymous'/.test(flat);
```

Since 1.0 the compiler emits `rebase.uid()`, and `sqlToPolicy` normalises raw
`auth.uid()` to `rebase.uid()` on the way in (`sqlToPolicy.ts:121`), so a policy
body written by *any* current code path spells `rebase.uid()`. The string
`auth.uid()` does not occur in `rebase.uid()`, so the first line returns false
and `drift.insecure` is always empty for current-generation policies. The
sibling check in `sqlToPolicy.ts:198` gets this right —
`/\b(?:rebase|auth)\.uid\(\)\s+IS\s+NOT\s+NULL/i` — and its comment says why:
"A security check that stops recognising a dangerous clause because the
framework renamed a function is a check that silently turns off." That is
exactly what happened here. The tests only ever feed the legacy spelling
(`policy-drift.test.ts:118`, `:134`, `:151`, `:168`), so nothing caught it —
class 7, a test and the code agreeing on a fiction.

The second line is wrong in the opposite direction. `policy.authenticated()` now
compiles to `rebase.uid() IS NOT NULL AND rebase.uid() NOT IN ('anonymous', 'anon')`
(verified against the built compiler). Postgres stores a two-element `NOT IN` as
`<> ALL (ARRAY['anonymous'::text, 'anon'::text])` (UNCONFIRMED — reasoned from
Postgres's deparse of `ScalarArrayOpExpr`, not executed here), which matches
neither `<> 'anonymous'` nor `!= 'anonymous'`. So merely adding `rebase` to the
first regex would flip the check into a false positive on every *correct*
`authenticated()` policy in the database.

*Failure scenario.* A project has `{ operation: "select", using: "rebase.uid() IS NOT NULL" }`
— a rule that grants every anonymous visitor read access, because a
user-context anonymous request carries `'anonymous'`, not NULL. `rebase doctor
--policies` prints `✓ RLS policies match your collections` and exits 0.

*Fix direction.* Match both schemas, and recognise the current clearance shape:
detect `(?:rebase|auth)\.uid\(\)\s*is not null` and clear it only when the same
clause also excludes *every* member of `ANONYMOUS_USER_IDS` — ideally by
building the expected fragment from `ANONYMOUS_USER_IDS` rather than
hard-coding `'anonymous'`, and by accepting both the `<> 'x'` and
`<> ALL (ARRAY[...])` renderings. Add a test whose fixture is the actual output
of `policyToPostgres(policy.authenticated())` rather than a hand-typed string.
(Overlaps unit 17, which audited this file but recorded the predicate's
*strictness* rather than its schema-name blindness — `17-rls-drift-and-scanning.md:655-668`.)

### H3 — `disableDefaultPolicies` silently removes the restrictive privilege-escalation gate on auth collections

`packages/common/src/util/auth-default-policies.ts:95-97`, `:126-135`;
`packages/admin/src/collection_editor/serializable_utils.ts:506-507`

`getEffectiveSecurityRules` returns the author's rules unchanged when
`disableDefaultPolicies` is set. For an auth collection that discards four
injected rules at once, and three of them are conveniences — but the fourth,
`<table>_require_admin_write`, is a **restrictive** gate whose stated job
(`:129-131`) is that "no permissive rule (e.g. an owner 'edit your own row'
rule) can let a non-admin change privileged columns like `roles`". Nothing
warns. Not the boot guards (`warnOnAnonymousGrants` /
`warnOnLegacyRlsFunctions` / `validatePolicyPgRoles` inspect rule *bodies*, not
this flag), not `rebase doctor --policies`, not `validate-config` (which merely
allowlists the key at `validate-config.ts:105`). Grepping the *reads* of
`disableDefaultPolicies` turns up four: two generators, the junction derivation,
and the admin editor's serializer. No consumer treats it as security-relevant —
class 36.

It is also reachable from the Studio: `serializable_utils.ts:506` round-trips
the flag, so the collection editor can set it on the users collection.

*Failure scenario.* Users collection with
`disableDefaultPolicies: true` and `securityRules: [{ operation: "all", ownerField: "id" }]`
— a shape the docs actively encourage for "take full responsibility". I ran
`getEffectiveSecurityRules` on exactly that config: it returns a single rule, the
author's. The generated `UPDATE` policy is
`USING ((id)::text = rebase.uid()) WITH CHECK ((id)::text = rebase.uid())`, with
no restrictive gate. A signed-in user issues
`PATCH /api/data/users/<self> { "roles": ["admin"] }` and is now an admin —
which then clears every `<table>_default_admin_*` policy on every other
collection in the project.

*Fix direction.* Warn loudly at boot when an auth collection sets
`disableDefaultPolicies` and no author rule is restrictive over
insert/update/delete; better, keep `require_admin_write` injected regardless and
give the opt-out a narrower spelling (`disableDefaultPolicies: "permissive"`),
so the flag can drop conveniences without dropping the gate.

---

## Medium

### M1 — `roles` + `mode: "restrictive"` does the opposite of what the field documents

`packages/common/src/util/policy/securityRuleToConditions.ts:56-67`;
`packages/types/src/types/security_rules.ts:145-148`

The `roles` doc says: "Can be combined with `ownerField`, `access`, `condition`,
or raw `using`/`withCheck`. When combined, the role check is **AND'd** with the
other condition." For a restrictive rule the code does not AND; it emits
`NOT(roles) OR base`. Verified against the built compiler:

| rule | emitted `USING` |
|---|---|
| `{mode:"restrictive", operation:"delete", access:"public", roles:["admin"]}` | `(NOT (string_to_array(rebase.roles(), ',') && ARRAY['admin'])) OR (true)` |
| `{mode:"restrictive", operation:"insert", roles:["admin"]}` | `NOT (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` |
| `{operation:"delete", roles:["admin"]}` (permissive) | `string_to_array(rebase.roles(), ',') && ARRAY['admin']` |

Row 1 is a permissive tautology dressed as a lockdown: a restrictive policy that
restricts nothing. Row 2 is an inversion: a rule that reads "only admins may
insert" denies exactly the admins and lets everyone else through the gate. Row 3
— the same object with the default mode — means what the doc says. No test in
`packages/common/test` or `packages/server-postgres/test` covers either
restrictive shape without a base condition.

*Failure scenario.* An author writes
`{ mode: "restrictive", operation: "delete", roles: ["admin"], access: "public" }`
to mean "only admins delete", reads the `roles` doc which says it is AND'd,
sees a `RESTRICTIVE` policy in `policies.sql`, and ships. Any caller who passes
a permissive delete policy can delete every row.

*Fix direction.* Either make `withRoles` AND for both modes and document the
"gate applies only to role-holders" form as an explicit
`policy.or(policy.not(...), ...)` the author writes themselves, or keep the
current semantics and (a) fix the `roles` doc to state the restrictive case, and
(b) reject at config-validation time the two degenerate combinations —
restrictive+roles with `access: "public"` (tautology) and restrictive+roles with
no base at all (inversion).

### M2 — Policy names bypass `toPostgresIdentifier`, and two injected defaults collide after Postgres truncates them

`packages/utils/src/policy-names.ts:49-56`;
`packages/utils/src/names.ts:67-90`;
`packages/server-postgres/src/security/policy-drift.ts:269-272`

Postgres truncates identifiers at 63 bytes. This repo has a helper for that,
with a doc that states the exact consequence: "Anything that later looks the
object up by the name it generated then misses" (`names.ts:70-72`). It is
applied to foreign-key constraint names
(`generate-postgres-ddl-logic.ts:550`, `:850`) and to nothing in the policy
path — `policy-names.ts` imports only `sha1Hex`.

Two consequences:

1. **A default policy is destroyed.** `<table>_default_admin_read` (19 chars of
   suffix) and `<table>_default_admin_write` (20) share their first 13 suffix
   characters, `_default_admi`. For any table name ≥ 50 characters both truncate
   to the *same* 63-byte identifier. The generator emits the read pair first,
   then `DROP POLICY IF EXISTS "<write name>"` — which, truncated, names the
   read policy just created — and then creates the write policy. The
   server/admin SELECT grant is gone.
2. **Orphan cleanup stops recognising its own output.** `<table>_<op>_<7hex>`
   for a 50-character table is 65 bytes; truncated it carries only 5 hex digits,
   and `isGeneratedPolicyName`'s `[0-9a-f]{7}` no longer matches. Every
   superseded policy on such a table is classified `kept` instead of `dropped`,
   which is H1's failure mode arriving even on the CLI path that *does*
   reconcile.

*Failure scenario.* A collection with
`table: "organization_membership_invitation_audit_entries_v2"` (51 chars).
`rebase db push` succeeds with no error. `pg_policies` holds one
`..._default_admi` policy where two were declared; the admin studio's reads of
that table return nothing, and `rebase doctor --policies` reports permanent
`missing` + `orphaned` drift that no push can resolve.

*Fix direction.* Route every name through `toPostgresIdentifier` in
`getPolicyNamesForRule`, and — because truncation can still collide — reserve
the tail for a disambiguator: truncate the *table* portion and always keep the
full suffix/hash. Add a guard that asserts the names a collection generates are
distinct after truncation. Note that changing the derivation renames live
policies, so this needs the orphan sweep from H1 to land first (see
`derived-names-are-frozen`).

### M3 — `generatePostgresPoliciesDdl` keys tables by bare name; `planCollectionPolicies` keys by `schema.table`. The two "mirrors" disagree, and one loses a table.

`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:1117-1126`
vs `:1062-1069`

`planCollectionPolicies` (the boot path) dedupes on
`qualified = ${schema}.${baseTableName}` (`:1067-1069`).
`generatePostgresPoliciesDdl` (the `db push` path, and the expectation
`checkPolicyDrift` reconciles against, `:1111-1113`) builds
`allTablesToGenerate = new Map<string, …>()` keyed by `getTableName(collection)`
alone and does `set(tableName, { collection })` — last writer wins. The doc at
`:1044-1047` claims the two produce "identical policies from identical
collections".

Because the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` line is emitted inside the
same loop (`:1134`), the losing collection's table gets **neither RLS enabled
nor any policy**. `rebase_user` holds blanket `SELECT/INSERT/UPDATE/DELETE`
grants (`rls-enforcement.ts:88`, `:246`), so with RLS off that table is fully
readable and writable by every request, including anonymous ones.

*Failure scenario.* The scaffold ships `users` at `schema: "rebase"`. A project
adds its own `{ slug: "app-users", table: "users", schema: "public" }`. Slugs
differ, so no existing validation complains. `drizzle/policies.sql` contains one
`users` block. Whichever collection lost the map race has an unprotected table.

*Fix direction.* Key both maps by `${schema}.${baseTableName}`, as
`planCollectionPolicies` already does, and add a config-validation error for two
collections resolving to the same qualified table (that is a mistake regardless).

### M4 — The policy emitter is the only emitter in the file that does not strip a schema prefix from `collection.table`

`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:101-131`
(`:103`, `:126-127`); compare `:525`, `:824`, `:1066`, `:1130`;
`packages/common/src/util/policy/policyToPostgres.ts:182-186`

Four other places in this file carry
`tableName.includes(".") ? tableName.split(".").pop()! : tableName`.
`generateSinglePolicyStatements` does not, and neither does `outerQualifier`.
Verified against the built compiler with `table: "myschema.foo"`:

```
EXISTS (SELECT 1 FROM "public"."team_members" "_ex0"
        WHERE "_ex0".user_id = "public"."myschema.foo".owner)
```

— a reference to a table literally named `myschema.foo` in schema `public`. The
`CREATE POLICY … ON "public"."myschema.foo"` header is wrong the same way.

*Failure scenario.* An introspected collection (or a hand-written one) carries
`table: "reporting.events"`. `planCollectionPolicies` plans `public.events`,
finds it, enables RLS, then every `CREATE POLICY` errors with
`relation "public.myschema.foo" does not exist`. Boot records one warning and
carries on with the table RLS-enabled and *policy-free*: the collection denies
100% of user reads. Fails closed, but the collection is dead and the message
names the wrong cause.

*Fix direction.* Compute `baseTableName` once at the top of
`generateSinglePolicyStatements` and in `outerQualifier`, using the same
expression the rest of the file uses. Better: give `getTableName` a
schema-splitting sibling so the strip is not open-coded in six places.

### M5 — One bad rule aborts the rest of its table's policy list, and only the first error is reported

`packages/server-postgres/src/schema/ensure-collection-policies.ts:81-102`

The `try` wraps `enableRls` **and** the whole `for (const statement of
plan.policyStatements)` loop, so the first failing statement abandons every
later one. Statements are ordered `DROP; CREATE; DROP; CREATE; …` per rule, so
rules after the failure keep whatever body a previous boot left them.

*Failure scenario.* A collection has rules `[A, B, C]`. Rule B is edited to
reference a table a migration has not created yet (the module doc's own example,
`:29-31`). In the same deploy, rule C is tightened to close a leak. Boot: A is
reapplied, B's old policy is dropped and its replacement fails, C is never
touched — its *old, loose* body survives. The log says
`Could not fully apply policies to "public.posts" — it stays locked (denies)`,
which is untrue (A and C still grant) and says nothing about C being skipped.

*Fix direction.* Move the `try` inside the statement loop, collect every failure
for the table, and report which rules were applied vs skipped. Since each rule's
statements are a self-contained `DROP`+`CREATE` pair, continuing past one broken
rule is safe and strictly better than abandoning the tail.

### M6 — `rebase doctor --policies` detects anonymous-grant rules and then exits 0

`packages/server-postgres/src/schema/doctor-policy-checks.ts:82-84`, `:104`

```js
warnOnAnonymousGrants(collections as never);
```

`validatePolicyPgRoles` above it is wrapped in a try/catch that sets
`problems = true` (`:76-80`). `warnOnAnonymousGrants` returns `void` and logs;
nothing reads a result, and `problems` is untouched. The function's own return
type makes this un-catchable by the caller. The file's header calls this "the
exit code `--policies` gates CI on", and the module docstring for the status
enum (`:15-26`) is a whole paragraph about not reporting success for work not
done — which this does, for the one finding in the file that is a live data
exposure rather than an empty table.

*Failure scenario.* CI runs `rebase doctor --policies` on a project whose
`securityRules` contain `using: "rebase.uid() != 'anon'"`. The warning is
printed among the output; the gate exits 0; the merge proceeds.

*Fix direction.* Have `findAnonymousGrants`/`warnOnAnonymousGrants` return the
risks (the data is already assembled in `rls-enforcement.ts:347-364`), and set
`problems = true` when the list is non-empty. Keep the *boot* path a warning —
that reasoning at `rls-enforcement.ts:333-339` is sound — but a CI gate is
exactly where it should be fatal.

### M7 — Junction write grants that cannot be embedded are dropped without a word

`packages/common/src/util/junction-policies.ts:316-335`

```js
const embedded = using ? embedParentExpression(using) : null;
if (embedded) grants.push(embedded);
...
if (!gatesEmbeddable) continue;
```

`embedParentExpression` returns `null` for any `raw` expression anywhere in the
tree, and for an `outerField` nested inside the author's own `existsIn`
(`:209-243`). Both are silent. The module doc is explicit that the failure mode
is "always *too locked*, never open" (`:45-48`) — correct, and the wrong half of
the problem. There is no `logger` import in this file and no diagnostic
returned, so nothing anywhere can tell the author that their junction is locked
*because of* a rule they wrote.

*Failure scenario.* `posts` has
`{ operation: "update", using: "{author_id} = rebase.uid() OR {status} = 'draft'" }`
— raw SQL, the documented escape hatch. `posts_tags` gets the locked baseline
and the endpoint-visibility read grant, and no write grant at all. Tagging a
post 403s for its own author. `db push` prints the generic derived-junction
comment and no warning; the author has no path from the symptom to the cause.

*Fix direction.* Return the dropped rules alongside the derived ones (or accept
an `onDrop` callback) and surface them from the two generators — in
`policies.sql` as a comment naming the rule and why, and at boot as a warning.
The rule shapes that disqualify are already enumerated in the doc; say them at
the site.

---

## Low

- **L1 — `wrapSql` interpolates compiled SQL into a JS template literal with no
  escaping.** `generate-drizzle-schema-logic.ts:387`, used at `:438-439`:
  `` `sql\`${clause}\`` ``. A raw rule or a `policy.literal` containing a
  backtick or `${` corrupts the generated `schema.ts`; `${…}` becomes a live JS
  interpolation evaluated when the schema module loads. I confirmed the compiler
  passes a backtick through unchanged (`using: "name = 'a\`b'"` →
  `` name = 'a`b' ``). Class 35. Admin-authored input only (the Studio AST editor
  writes `securityRules`, `ast-schema-editor.ts:417-427`), so it is not a
  privilege boundary today, but it is one bad literal away from an unreadable
  build. Fix: escape `` ` ``, `\` and `${` before wrapping, or emit
  `sql.raw(JSON.stringify(clause))`.
- **L2 — Identifiers in the policy DDL are quoted but not escaped.**
  `generate-postgres-ddl-logic.ts:126-131` interpolates `policyName`, `schema`,
  `tableName` and each `pgRoles` entry into `"…"` without doubling an embedded
  `"`. `quoteIdent` in `rls-enforcement.ts:85` does it correctly for the same
  job. A rule `name` containing a quote injects DDL executed by the owner
  connection.
- **L3 — `policy.rolesOverlap([])` compiles to `ARRAY[]`.**
  `policyToPostgres.ts:208-210`; verified:
  `string_to_array(rebase.roles(), ',') && ARRAY[]`. Postgres rejects this with
  `cannot determine type of empty array`. The `roles:` shortcut guards the empty
  case (`securityRuleToConditions.ts:57`) so only a structured condition reaches
  it; on the boot path it takes down the rest of that table's policies (see M5).
  Fix: emit `ARRAY[]::text[]`, or reject an empty role list at build time.
- **L4 — An author rule named like an injected default silently wins/loses.**
  `auth-default-policies.ts:106-138` appends the injected rules *after* the
  author's. A rule the author named `posts_default_admin_read` compiles to the
  same policy name, and the injected `DROP`+`CREATE` runs second — the author's
  rule is silently discarded. Fix: reject author names in the
  `<table>_default_*` / `<table>_require_*` namespace at validation time.
- **L5 — Doc drift on `authenticated()`.** `policy.ts:151-152` says it compiles
  to `rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous'`; it compiles to
  `… NOT IN ('anonymous', 'anon')` (`policyToPostgres.ts:99`, verified). Minor
  on its own, but H2's clearance regex was written against the doc's spelling.
- **L6 — A *named* rule that gains an operation orphans its old policy, and
  cleanup refuses to touch it.** `policy-names.ts:53-55`: a named rule is
  `rule.name` for one operation and `rule.name_<op>` for several, so adding an
  operation renames every policy. `isGeneratedPolicyName`
  (`policy-drift.ts:269-272`) matches only the hash shape, so these land in
  `kept` and are merely printed ("Drop them by hand if they are stale",
  `cli.ts:523`). Defensible — a custom name is indistinguishable from
  hand-written SQL — but the report should say *this looks like a rule you
  renamed*, which it can compute by matching the prefix.
- **L7 — `rewriteLegacyRlsFunctions` rewrites inside string literals.**
  `rls-functions.ts:88-93` is a plain global regex over the whole fragment, so
  `using: "note = 'see auth.uid() docs'"` has its literal rewritten. Harmless in
  practice; worth a note because the same function is the normaliser
  `sqlToPolicy` runs before parsing, so the rewritten literal is what gets
  stored back into the project's config.

---

## Checked and clean

- **The operation→clause matrix.** `needsUsing = op !== "insert"`,
  `needsWithCheck = op !== "select" && op !== "delete"`
  (`generate-postgres-ddl-logic.ts:108-109`, mirrored exactly at
  `generate-drizzle-schema-logic.ts:430-431`). `WITH CHECK` is emitted wherever
  Postgres accepts it, and `baseWithCheck` falls back to `baseUsing`
  (`securityRuleToConditions.ts:42-48`), matching Postgres's own default. An
  explicit `check` on a `delete` operation is dropped, which is correct.
- **A clause that cannot be produced becomes `false`, never a grant.**
  `generate-postgres-ddl-logic.ts:119-124`. This also catches the empty-string
  cases: `using: ""` and `using: "   "` parse to `raw("")`, compile to `""`,
  and the falsy check converts them to `false`. A rule with no condition and no
  roles (`RolesOnlySecurityRule` with everything omitted) denies.
- **The `AND`-out-of-`EXISTS` regression is fixed and stays fixed.**
  `sqlToPolicy.ts:49-79` splits only at paren depth 0 and outside string
  literals, with `''` escape handling; `stripOuterParens` (`:82-108`) refuses to
  unwrap `(a) AND (b)`. `OR` is split before `AND`, so precedence round-trips:
  `a = '1' AND NOT b = '2' OR c = '3'` recomposes as `((a) AND (NOT b)) OR (c)`.
- **The bare-`id`-in-a-subquery regression is fixed.** `outerQualifier`
  (`policyToPostgres.ts:182-186`) table-qualifies every `outerField` and every
  `{column}` placeholder in `raw`. Verified end-to-end: `policy.existsIn` with a
  correlated `outerField` emits
  `EXISTS (SELECT 1 FROM "public"."team_members" "_ex0" WHERE ("_ex0".team_id = "public"."documents".team_id) AND (("_ex0".user_id)::text = rebase.uid()))`.
  Subquery aliases are monotonic (`_ex0`, `_ex1`, …) through a shared counter, so
  nested `existsIn` cannot shadow.
- **`parseOperand` is anchored, and unquoted literals are recognised before bare
  words.** `sqlToPolicy.ts:300-346`. `NOT (rebase.uid() = rebase.uid())` stays
  `raw`; `a = false` parses as a boolean literal, not a column named `false`;
  `''` is decoded exactly once (`parseSingleQuoted`, `:359-376`) so `O'Brien`
  does not grow on a round trip; `'a' = 'b'` is rejected as a single literal.
  `>=`, `<=`, `<>` and `IS NOT NULL` all fall through to `raw` and are
  reproduced verbatim rather than mis-decomposed.
- **`serverContext()` is a primitive, not `not(authenticated())`.**
  `auth-default-policies.ts:56-63` and `policy.ts:168-185`. The injected baseline
  compiles to
  `(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])`
  (verified), which admits the owner/server plane and admins and nobody else.
  `applyAuthContext` coerces a blank uid to `ANONYMOUS_USER_ID` at the single
  chokepoint (`rls-enforcement.ts:295`), so a user request can never satisfy the
  server arm.
- **All four boot guards are actually called.** `warnOnRoleSchemaCollision`
  (`PostgresBootstrapper.ts:382`), `detectConnectionPosture` (`:384`),
  `ensureAppRole` (`:393`), `validatePolicyPgRoles` (`:412`, and again from
  `doctor-policy-checks.ts:74`), `warnOnAnonymousGrants` (`:421`),
  `warnOnLegacyRlsFunctions` (`:426`). `validatePolicyPgRoles` throws — a policy
  targeting an unreachable role fails the boot rather than emptying a table.
- **`rebase.roles()` COALESCEs to `''`.** `rls-bootstrap-sql.ts:69-71`, so
  `string_to_array(…, ',') && ARRAY['admin']` is a clean false rather than NULL
  when no roles are set. `rebase.uid()` falls back to the pre-rename
  `app.user_id` GUC (`:55-60`) and `applyAuthContext` writes both spellings
  (`rls-enforcement.ts:304-310`) — a rolling deploy resolves the principal in
  both directions.
- **Re-running the same rule set is idempotent.** Every policy is a
  `DROP POLICY IF EXISTS` immediately followed by its `CREATE POLICY`
  (`generate-postgres-ddl-logic.ts:126-131`), and `ENABLE ROW LEVEL SECURITY`
  runs *before* any policy statement (`ensure-collection-policies.ts:82-85`), so
  a mid-way failure leaves the table denying rather than open. The caveat is M5,
  not the ordering.
- **`policyToPostgres` is never called without a collection.** Only two call
  sites exist (`generate-postgres-ddl-logic.ts:116-117`,
  `generate-drizzle-schema-logic.ts:438-439`), both pass the collection, so the
  `outerQualifier`-returns-`""` branch is unreachable from the generators.
- **Junction derivation matches its documented model.**
  `junction-policies.ts:270-355`: locked baseline, `AND` of two endpoint
  `EXISTS` for reads, declaring-side `update` rules embedded for writes,
  restrictive gates AND'd in, injected parent defaults deliberately not
  inherited. `getJunctionCollectionConfig` gives both FK columns explicit
  `columnName`s so `outerField` resolves to the exact emitted column.
- **`getGeneratedPolicyNames` is the single derivation.**
  `auth-default-policies.ts:178-180` composes `getEffectiveSecurityRules` with
  `getPolicyNamesForRules`; the DDL generator, the Drizzle generator and the
  drift checker all go through `getPolicyNamesForRule`. No hand-rolled second
  copy survives.

---

## Open questions

1. **Is anything other than `db push` expected to reconcile policies for a
   managed tenant?** H1 assumes not, from `boot.ts:811-858` and
   `cli.ts:495-540`. If a control-plane job runs `dropOrphanedPolicies`
   out-of-band, H1 drops to medium and becomes a documentation problem.
2. **Does Postgres deparse `x NOT IN ('a','b')` as `x <> ALL (ARRAY[…])`?** H2's
   second half rests on this. It needs one `psql` round trip against a real
   policy to confirm, which this audit could not do.
3. **`isPostgresCollectionConfig` is `!engine || engine === "postgres"`**
   (`collections.ts:464-468`), and both `disableDefaultPolicies`
   (`auth-default-policies.ts:95`) and the junction opt-out
   (`junction-policies.ts:271`) gate on it, while `relationalCollections` gates
   on the *capability*. If a relational non-Postgres engine is ever real, those
   two flags become silently inert. UNCONFIRMED whether such an engine exists
   today.
4. **Does a bundle-booted managed runtime pick up `defaultSecurityRules`?**
   `applyCollectionDefaults` runs inside `loadCollectionsFromDirectory`
   (`loader.ts:121`, `:150`), and `boot.ts:838` uses that loader — so it should.
   Worth confirming that the `db push` side loads through the same function
   (`doctor.ts`'s `loadCollections`) rather than a second scan, since a
   divergence there means the two paths generate different policy *sets*, not
   just different names.
5. **Should `warnOnAnonymousGrants` also walk `getEffectiveSecurityRules` and the
   derived junction rules?** It currently walks `collection.securityRules` only
   (`rls-enforcement.ts:350`). The injected defaults are safe by construction, so
   this is probably fine — but the junction `_default_edge_write` rules are
   assembled from author expressions and are not inspected by anything.
