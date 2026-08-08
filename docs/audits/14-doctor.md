# Audit — Unit 14: `rebase doctor` and its diagnostics

Read-only audit of `packages/server-postgres/src/schema/doctor.ts`,
`packages/server-postgres/src/schema/doctor-cli.ts`,
`packages/cli/src/commands/doctor.ts`, the dispatch in
`packages/server-postgres/src/cli.ts`, the RLS half
(`packages/server-postgres/src/security/policy-drift.ts`,
`rls-enforcement.ts`), and every generator the doctor compares itself against.
2026-08-08.

## Verdict

The diagnoses that fire are, in the main, *correct* — the column-type
expectations agree with `generate-postgres-ddl-logic` property by property,
including the serial widths and the array `udt_name`s; the enum type name is
derived the same way in all three places; the policy-drift checker deliberately
compares clause *presence* rather than Postgres-rewritten text, and says why.
The `sdk_ungeneratable` regression is genuinely fixed: all eleven category
values are declared in the union and in `formatCategory`, and ten of the eleven
are actually emitted.

What is wrong is nearly everything around them. Doctor is the product's
"is my project healthy?" command, and it is currently unable to answer *no*
safely in either direction. It reports **`✅ Collections → Database: In sync`
and `✓ All schemas are in sync!` when it never opened a connection** — a skipped
phase is initialised to `{ passed: true, issues: [] }` and counted among the
passing phases, and a unit test enshrines that as the clean case. The documented
CI gate, `rebase doctor --policies`, fails open two independent ways: a
collections path that does not resolve yields `[]` from the loader (a `warn`,
not a throw), which makes `checkPolicyDrift` return an empty diff and print
`✓ RLS policies match your collections`; and any exception at all is caught,
logged as `⚠ Could not check RLS policies`, and exits **0**. Both are bug class
4 verbatim — a skip that reports success — and the second is the shape the class
was named for.

Then class 5. The two staleness checks regenerate their artefact *in the order
`readdirSync` happened to return the files*, while `rebase schema generate` and
`rebase generate-sdk` both sort by slug before generating. I confirmed by
execution that both generators are order-dependent, so on any project whose
filename order differs from its slug order the doctor reports "out of date" on a
freshly generated file — and the fix it prints, `rebase schema generate`,
rewrites the file in sorted order and changes nothing about the comparison. The
advice is a loop. Finally the entire report is written through
`logger.info`, so the default output has `ℹ️ [INFO] ` glued to the front of every
line of the ASCII box (verified), and `LOG_LEVEL=warn` — documented, settable in
the scaffold's own `.env.example` — makes `rebase doctor` print **nothing at all**
while still exiting 1.

Coverage is also narrower than advertised. The docs promise a
"Generated schema ↔ Database — are there unapplied changes?" phase; there is no
such phase and nothing in the repo reads `rebase.atlas_schema_revisions`. Driver
/ framework version, `AUTH_SCHEMA_VERSION`, the `rebase.uid()` bootstrap, and
reverse drift (a table or column no collection describes) are all uncovered, and
`rebase build` tells users to "See `rebase doctor`" about native dependencies —
a diagnostic that does not exist.

---

## Critical

None. Nothing here corrupts data. But H1 and H2 are the failure mode a
diagnostic tool cannot have: reporting health it did not measure.

---

## High

### H1. A skipped database phase is counted as a passing one, and rendered as "In sync"

`packages/server-postgres/src/schema/doctor.ts:748-756`, `:764`, `:670-677`,
`:653-659`

`runDoctor` initialises the database phase to `{ passed: true, issues: [] }` and
only overwrites it when `options.databaseUrl` is set. `summary.passed` then
counts it (`:764`), `renderPhase` keys its header off issue counts (`:670`) so an
empty phase prints `✅ Collections → Database: In sync`, and with no errors
anywhere the footer prints `✓ All schemas are in sync!` (`:658`). The only
signal that nothing happened is a grey line several screens up.

The unit test agrees with the bug — `test/doctor.test.ts:236` comments
"No databaseUrl → phase 2 is skipped and counts as passing", and `:253-270`
("reports a clean summary when every phase is in sync") asserts
`{ passed: 3, warnings: 0, errors: 0 }` for a run that never had a database.
That is bug class 7's shape sitting on top of class 4.

**Failure scenario.** A user's `.env` has `POSTGRES_URL` rather than
`DATABASE_URL`, or they run `rebase doctor` from a CI job that did not export it.
Their tables do not exist at all. Doctor prints two green ticks and
"✓ All schemas are in sync!", exits 0, and the user goes looking for the bug
somewhere else.

**Fix direction.** A phase that did not run is a third state, not a passing one.
Give the phase a `skipped` flag, render it as `⏭ Collections → Database:
skipped (DATABASE_URL not set)`, exclude it from `summary.passed`, and never
print "All schemas are in sync" when any phase was skipped. Then change the test
to assert the skipped rendering rather than `passed: 3`.

### H2. `rebase doctor --policies` — the documented CI gate — fails open, twice

`packages/server-postgres/src/schema/doctor-cli.ts:20-63`, `:93-97`;
`packages/server-postgres/src/security/policy-drift.ts:196-198`;
`packages/server/src/collections/loader.ts:112-115`

The docs say (`website/src/content/docs/docs/cli/schema.md:101`):
*"run `rebase doctor --policies`. It exits non-zero on drift, so it works as a
CI gate."*

**(a) Vacuous success.** `runPolicyChecks` resolves `collectionsPath` against
`process.cwd()` (`doctor-cli.ts:30`), which is `backend/`, not the project root.
When the path does not resolve, `loadCollectionsFromDirectory` logs
`[collections] Not found: …` at warn and **returns `[]`** (`loader.ts:112-115`).
`checkPolicyDrift` then computes `expected = []`, so `schemas` is empty and it
early-returns an empty drift (`policy-drift.ts:196-198`). `hasDrift` is false, so
doctor-cli prints `✓ RLS policies match your collections` (`:55`) and exits 0.
A green tick asserting the database matches the config, from a scan of zero
collections and zero policies. This is precisely the vacuity floor class 4 warns
about.

**(b) Swallowed failure.** Everything in `runPolicyChecks` is inside one
`try`, and the `catch` (`:57-59`) logs `⚠ Could not check RLS policies` and falls
through to `return problems`, which is still `false` unless
`validatePolicyPgRoles` had already failed. A collections file that throws on
import, a `pg_policies` read the CI role is not granted, a connection reset — all
of them produce a warning and **exit 0**.

**Failure scenario.** CI runs `rebase doctor --policies` from the repository root
instead of `backend/`. Every run is green. A `securityRules` edit that was never
pushed to production sits undetected for as long as anyone cares to leave it —
which is the exact incident `policy-drift.ts`'s own docblock was written about.

**Fix direction.** Fail closed on both: refuse to report success when
`collections.length === 0` (a project with no collections has nothing to gate and
should say so, non-zero), and set `problems = true` in the `catch` rather than
returning the pre-catch value. Resolve `--collections` against the project root,
not the cwd (see L6). A vacuity assertion in a test — "checking zero collections
must not exit 0" — is the cheap gate.

### H3. Both staleness checks compare against an *unsorted* regeneration, so the fix they print is a no-op

`packages/server-postgres/src/schema/doctor.ts:170-195` and `:231-250`;
`packages/server-postgres/src/schema/generate-drizzle-schema.ts:68`;
`packages/cli/src/commands/generate_sdk.ts:375`

Both writers sort before generating:

- `generate-drizzle-schema.ts:68` — `collections.sort((a, b) => a.slug.localeCompare(b.slug))`
- `generate_sdk.ts:375` — the same line, with a comment explaining that
  determinism is what makes `rebase generate-sdk && git diff --exit-code` a
  usable staleness gate.

The doctor sorts neither. It passes `relationalCollections(collections)` and
`collections` straight through in `readdirSync` order (`loader.ts:129`).

Both generators are order-dependent. Verified by execution:
`generateTypedefs([a,b]) === generateTypedefs([b,a])` → `false`;
`await generateSchema([a,b]) === await generateSchema([b,a])` → `false`.

**Failure scenario.** A project has `blogPosts.ts` (slug `articles`) and
`authors.ts` (slug `authors`). `readdirSync` yields `authors.ts, blogPosts.ts`
→ slugs `[authors, articles]`; the generator wrote the file from
`[articles, authors]`. `rebase doctor` reports *"Generated schema is out of
date — collection definitions have changed since last generation"* and
*"Generated SDK types are out of date"* on a project that is perfectly in sync.
The user runs the printed fix, `rebase schema generate`; it rewrites the file in
sorted order — the order it was already in — and doctor says exactly the same
thing on the next run. Class 5's canonical shape: the state the message
describes is unchanged by the command it recommends.

The same defect makes the check unreliable in the other direction on Linux,
where `readdirSync` returns hash order rather than alphabetical: the order is
stable per-directory but arbitrary, so whether the check works at all is a
property of the filesystem.

**Fix direction.** Sort in the doctor with the identical expression, or better,
sort inside `generateSchema` / `generateTypedefs` so the *generators* are
order-independent and no caller can get this wrong again (class 2's fix shape:
one predicate, not three agreeing copies). Pin it with a test that generates from
a shuffled input and asserts byte equality.

### H4. The whole report goes through `logger.info`, so a log level silences it and the default level mangles it

`packages/server-postgres/src/schema/doctor.ts:614-706`;
`packages/server/src/utils/logger.ts:48-52`, `:100-120`;
`packages/cli/templates/template/.env.example:47`

`renderReport`/`renderPhase` emit every line — including the box borders and the
blank spacers — with `logger.info`. Verified output at the default level:

```
ℹ️ [INFO]   ┌─ ✗ Stale Schema ──────────────────────────────
ℹ️ [INFO]   │ Generated schema file does not exist.
ℹ️ [INFO]   │ Fix: Run `rebase schema generate`
```

At `LOG_LEVEL=warn` the same call produced **no output whatsoever**, while
`doctor-cli.ts:109` still exits 1.

`LOG_LEVEL` is a documented, first-class setting
(`website/src/content/docs/docs/getting-started/configuration.md:60`) and ships in
the scaffold's `.env.example`. It reaches the doctor process: the plugin CLI's
`loadEnv()` (`cli.ts:32-58`) copies `.env` into `process.env` before
`doctorPluginCommand` spawns the child with `env: { ...process.env }`
(`cli.ts:1195-1201`).

**Failure scenario.** A developer quiets their dev server with `LOG_LEVEL=warn`
in `.env`. Later, `rebase doctor` exits 1 and prints nothing. There is no way to
tell a failing doctor from a crashed one.

Also: `NODE_ENV=production` — plausible when pointing doctor at a deployed
database — turns every line into a JSON log record with the chalk escapes
embedded in the `message` field.

**Fix direction.** A CLI report is not application logging. Write it with
`console.log` (as `packages/cli` does throughout) or through a dedicated writer
that ignores `LOG_LEVEL` and `NODE_ENV`. Keep `logger` for the diagnostics
*about* the run.

---

## Medium

### M1. A database that is down destroys the whole run, and reports it with a raw stack

`packages/server-postgres/src/schema/doctor.ts:318-606` (a `try`/`finally` with
no `catch`); `doctor-cli.ts:114-117`

`checkCollectionsVsDatabase` lets everything propagate. `runDoctor` calls
`renderReport` only after all three phases, so an `ECONNREFUSED` on the first
query throws past the render and out to
`main().catch(err => logger.error("✗ Doctor failed", { error: err }))` — which,
via the logger's `serialiseError`, prints the message *and the whole stack* as a
JSON blob. The schema and SDK phases already completed and their results are
discarded.

Worse, the repo already owns the fix. `cli-errors.ts:211,251` export
`checkDatabaseConnectivity` and `diagnoseDbError`, which recognise ECONNREFUSED
(including the dual-stack `AggregateError`), auth failures and
`ssl is not enabled`, and print a banner naming `docker compose up -d db`. They
are used by `db push` and `db migrate` (`cli.ts:472,802,858,896`) and by nothing
in the doctor. The one command whose job is diagnosis does not use the
diagnoser.

**Fix direction.** Catch inside the phase, convert the error into a
`DoctorIssue` (or a `skipped`/`failed` phase state), render the report, and pass
the error through `diagnoseDbError` for the message.

### M2. Anonymous-grant findings never reach the report or the exit code

`packages/server-postgres/src/schema/doctor-cli.ts:46`;
`packages/server-postgres/src/security/rls-enforcement.ts:336-372`

`warnOnAnonymousGrants(collections)` returns `void` and only calls
`logger.warn`. Its finding is "these rules read as a lockdown but are true for
every anonymous caller" — a security defect — and it contributes nothing to
`problems`, nothing to `report.summary`, and nothing to the exit code. Under
`LOG_LEVEL=error` it is invisible; under H4's silencing it is invisible with
everything else.

**Fix direction.** Return the risks, count them as `error`-severity issues, and
let them fail the gate.

### M3. Junction tables are looked for in the wrong schema

`packages/server-postgres/src/schema/doctor.ts:588-601` vs
`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:466-497`

Doctor computes the junction's schema from the *declaring collection*:
`const junctionSchema = (collection as { schema?: string }).schema || "public"`.
The DDL generator registers the junction under a synthetic collection
`{ table: junctionTableName, properties: {} }` that carries **no `schema`**, so
`:497` resolves it to `"public"` unconditionally.

**Failure scenario.** A collection declares `schema: "tenant"` and a
`manyToMany`. `db push` creates `public.<junction>`; doctor looks for
`tenant.<junction>`, does not find it, and emits an **error**-severity
`missing_table` — non-zero exit — on a healthy project. Running the printed fix
(`rebase db push`) recreates it in `public` and changes nothing.

**Fix direction.** Derive the junction schema from the same expression the DDL
generator uses, or (better) fix the generator to place the junction in the
declaring collection's schema and make both read one helper.

### M4. Relations declared in `collection.relations[]` are never checked

`packages/server-postgres/src/schema/doctor.ts:429-475` vs
`packages/common/src/util/relations.ts:39-67`

`resolveCollectionRelations` builds its map from **two** sources: the
`collection.relations` array (`:49-52`) and relation *properties* declared inline
(`:57-63`). The doctor's FK-column and FK-constraint checks live inside
`for (const [propName, prop] of Object.entries(collection.properties ?? {}))`
and only run for `prop.type === "relation"`. A `belongsTo` declared in the
`relations` array without a matching property still puts a `localKey` column and
a FOREIGN KEY on the table, and doctor checks neither.

**Fix direction.** Iterate `resolveCollectionRelations(collection)` — the
resolved map — and check every `belongsTo` in it, rather than walking the
properties and resolving per property.

### M5. A relation target that throws is swallowed into a nonsense diagnosis

`packages/server-postgres/src/schema/doctor.ts:449-472`

```ts
let targetTableName = "unknown";
try { const targetColl = relation.target(); … } catch { /* ignore */ }
const hasFk = tableFks.some(fk => … fk.foreign_table_name === targetTableName …);
```

A target thunk throws on a circular import — the failure `generate-types.ts:259`
documents at length. When it does, `targetTableName` stays `"unknown"`, `hasFk`
is necessarily `false`, and doctor emits
*`Column "author_id" exists but has no FOREIGN KEY constraint referencing
"unknown"`* with the fix "Run `rebase db push` or add the constraint manually".
The constraint is there; the message names a table that does not exist; the fix
will not help. Class 4 producing a class 5 message.

**Fix direction.** A target that cannot be resolved is its own diagnosis —
report it as an error naming the circular import, and skip the FK check rather
than answering it with a fabricated table name.

### M6. Every drift that actually breaks the app is a warning, so doctor exits 0

`packages/server-postgres/src/schema/doctor.ts:190`, `:246`, `:466`, `:528`,
`:548`, `:570`; `doctor-cli.ts:109`

`error` is reserved for `missing_table`, `missing_column` and a missing schema
file. Everything else is `warning`: a stale generated schema (which is what
makes the server refuse to boot — see `schemaStaleCommand`'s own message at
`cli.ts:1016-1020`), a stale SDK, a **column of the wrong type**, a missing enum
type, enum values out of sync, a missing FOREIGN KEY. `doctor-cli.ts:109` exits
non-zero on `errors > 0` only, so all of those exit 0.

**Failure scenario.** A `number` property gains `columnType: "bigint"` and the
migration is never applied. Doctor reports a type mismatch, exits 0, CI is green,
and the first write past 2³¹ fails in production.

**Fix direction.** Add `--strict` (or `--fail-on=warning`) and use it in the
documented CI recipe; at minimum promote `type_mismatch` and `schema_stale` to
errors, since both have a known runtime failure.

### M7. "The comparison did not run" is reported as staleness, with a fix that fails the same way

`packages/server-postgres/src/schema/doctor.ts:196-204` and `:266-273`

Both catches turn any generator failure into
*"Could not regenerate schema for comparison: <message>"* / *"Could not
regenerate SDK types for comparison"* at **warning** severity, with the fix
"Run `rebase schema generate` to verify". The SDK side got this right for
`CodegenError` (`:259-265`) — the comment explains exactly why reporting an
ungeneratable schema as staleness "described the wrong problem and pointed at a
command that would fail the same way" — and then the `else` branch does that for
every other cause.

It is worse than it reads, because the recommended command *also* soft-fails:
`generate-drizzle-schema.ts:88` catches, logs `Error generating schema`, and
returns — the process exits **0**. So the user runs the fix, sees an error
scroll past, gets a zero exit code, re-runs doctor, and sees the same warning.

**Fix direction.** Distinguish "could not run" from "ran and disagreed": the
former is an `error`-severity issue whose fix is to fix the collections, not to
re-run the generator. And make `rebase schema generate` exit non-zero when it
fails (out of unit, but it is this remediation's premise).

### M8. Three pieces of user-facing text point at doctor capabilities that do not exist

- `website/src/content/docs/docs/cli/schema.md:162-165` lists three phases,
  including **"Generated schema ↔ Database — are there unapplied changes?"**.
  There is no such phase. Doctor compares collections→schema,
  collections→database and collections→SDK; it never reads the generated schema
  against the database, and nothing in the repo queries
  `rebase.atlas_schema_revisions` to find unapplied migrations. The internal
  field name `schemaToDatabase` (`doctor.ts:52`) preserves the fiction while the
  rendered label (`:631`) says "Collections → Database".
- `packages/cli/src/commands/build.ts:170` — *"These cannot run on the managed
  runtime. See `rebase doctor`."* Doctor has no native-dependency or
  managed-runtime diagnostic of any kind. Following the advice tells the user
  nothing.
- `packages/cli/src/commands/doctor.ts:27-40` — `printDoctorHelp` documents no
  flags at all, while `--policies`, `--collections`, `--schema` and `--sdk` are
  all parsed, and `--policies` is documented in the website docs as the CI gate.

**Fix direction.** Correct the docs to the three phases that exist; either
implement a migration-status check or drop the claim; either add a
`managed-runtime` diagnostic or point `build` somewhere real; list the flags in
`--help`.

---

## Low

- **L1. `missing_constraint` is declared and emitted nowhere.**
  `doctor.ts:40` (category union) and `:713` (`formatCategory` label). Nothing
  ever pushes an issue with it — verified by grep across the workspace, two hits
  total, both declarations. Class 21: a declared entry with no producer. Either
  implement a unique/check-constraint diagnostic or delete both lines.
- **L2. `is_nullable` is selected and never read.** `doctor.ts:287` (interface),
  `:332` (the `SELECT`). Class 20 — the value is computed and discarded, and its
  absence *is* a missing diagnostic: `validation.required` drift (a column that
  should be `NOT NULL` and is not, or vice versa) is invisible to doctor today.
- **L3. `sdk_ungeneratable` is reachable, but only for projects that already
  generated an SDK.** `doctor.ts:220-229` returns early on a missing SDK file,
  before `generateTypedefs` is ever called, so a project with two slugs that
  collide on one accessor (`my-notes` / `my_notes` → `myNotes`,
  `generate-types.ts:222-228`) gets `ℹ SDK not generated (optional)` and a
  **pass**, while `rebase generate-sdk` would refuse. The CodegenError paths for
  a missing/empty slug are unreachable from doctor for a different reason: the
  loader's `assertCollectionConfigs` rejects them first
  (`validate-config.ts:476-481`). So of the three throw sites, one is reachable.
- **L4. `reference` is hardcoded to `text` while the DDL follows the target's
  primary key.** `doctor.ts:122-126` returns `"text"` unconditionally;
  `generate-postgres-ddl-logic.ts:240-246` returns `INTEGER` / `UUID` / `TEXT`
  depending on the target's PK. A reference to a collection with a numeric or
  uuid id would be reported as a `type_mismatch` on a correct column.
  **UNCONFIRMED reachability**: `PostgresProperty` is
  `Exclude<Property, ReferenceProperty>` (`types/properties.ts:94`), so a
  Postgres collection cannot declare one without a cast. The doctor's own
  comment states the correct rule and then implements one branch of it.
- **L5. A fourth private copy of `resolveColumnName`.** `doctor.ts:27` duplicates
  `generate-postgres-ddl-logic.ts:20` (which is *exported*, and imported by
  `ensure-collection-tables.ts:43`) and `generate-drizzle-schema-logic.ts:39`.
  They agree today. Class 2: a doctor that computes a column name independently
  of the generator will diverge on the first change, and the symptom is drift
  reported on a healthy column.
- **L6. `--collections` resolves against `backend/`, not the project root.**
  `doctor-cli.ts:100` / `:30` resolve against `process.cwd()`, which
  `packages/cli/src/commands/doctor.ts:80` sets to `backendDir`. So
  `rebase doctor --collections=./config/collections` run from the project root
  looks in `backend/config/collections`, finds nothing, and exits 1 with
  "No collections found." This is the exact trap `generate_sdk.ts:391-400`
  documents having fixed for that command ("defaults hang off the project root,
  not the cwd").
- **L7. A project with no relational collections gets a hard error.**
  `doctor.ts:156-165` checks `fs.existsSync(schemaFilePath)` and returns an
  `error` **before** the `postgresCollections.length === 0` early return at
  `:171`. A Firestore- or Mongo-only project therefore fails doctor for not
  having a Drizzle schema it has no reason to generate. `test/doctor.test.ts:101`
  ("should return error for nonexistent schema file even with empty
  collections") enshrines it.
- **L8. Unused imports.** `doctor.ts:12` (`path`) and `:13` (`pathToFileURL`) are
  imported and never referenced — leftovers from when `loadCollections` had its
  own scan. Visible to `no-unused-vars`, invisible behind `--quiet`.
- **L9. No JSON output, and adding one costs three layers.** There is no `--json`
  flag anywhere in the chain. `doctorPluginCommand` (`cli.ts:1184-1192`) rebuilds
  the child's argv from a fixed list, so unrecognised flags parsed permissively
  into `_` are silently **dropped** rather than forwarded — a future flag needs
  editing `commands/doctor.ts`, `cli.ts` and `doctor-cli.ts`. `runDoctor` already
  returns a fully structured `DoctorReport`; nothing serialises it. The
  `rebase_doctor` MCP tool (`packages/mcp/src/index.ts:589-593`) therefore hands
  an agent chalk-coloured `ℹ️ [INFO]` log lines instead of the report object.
- **L10. Summary line details.** `doctor.ts:648` prints "1 errors";
  `summary.passed` counts *phases* while `warnings`/`errors` count *issues*, so
  "2 passed, 1 errors" invites reading `2` as issues.
- **L11. Uncovered failure modes.** Beyond M8's missing migration check: no
  driver/framework version check (`minimumFrameworkVersion` exists and is
  enforced elsewhere), no `AUTH_SCHEMA_VERSION` check
  (`auth/schema-version.ts:37` — a database stamped ahead of the running code
  throws `AuthSchemaVersionError` at boot, which doctor could pre-empt), no check
  that the `rebase.uid()` helpers exist, no reverse drift (a table or column in
  the database that no collection describes — so a deleted collection leaves a
  live table and doctor says "in sync"), and no invocation of the repo's own
  `packages/rls-check` scanner.
- **L12. The e2e asserts only that it exited 0.**
  `packages/cli/test/e2e/cli.test.ts:279-287` runs `rebase doctor` with
  `stdio: "inherit"` and no expectation. "It ran" is exactly what class 4 says
  proves nothing — and because the template's filename order happens to match its
  slug order, it cannot see H3 either. The unit tests mock `logger.info`
  (`test/doctor.test.ts:214`), so no test in the repo has ever looked at what
  doctor prints.

---

## Checked and clean

- **Every diagnostic code is declared and labelled.** All eleven `category`
  values in the union at `doctor.ts:40` appear in `formatCategory`'s
  `Record<DoctorIssue["category"], string>` at `:709-721`, which is exhaustive by
  type — the `sdk_ungeneratable` omission cannot recur silently. Ten of the
  eleven have a producer; `missing_constraint` is the exception (L1).
- **Column type expectations match the DDL generator.** Compared
  `getExpectedColumnType` (`doctor.ts:58-133`) against
  `generate-postgres-ddl-logic.ts:144-246` and
  `generate-drizzle-schema-logic.ts:116-200` for string (text default, char,
  varchar, uuid, enum→USER-DEFINED), number (integer/numeric, serial widths
  mapped to their underlying widths, `columnType` passed through, `isId:
  "increment"` → integer), boolean, date (date/time/timestamptz), map, array
  (including `udt_name` `_text`/`_int4`/`_bool`/`_numeric`), vector and binary.
  No disagreement found other than L4.
- **Enum type names agree in all three places.** `<table>_<resolvedColumnName>`
  in `doctor.ts:544`, `generate-postgres-ddl-logic.ts:429` and
  `generate-drizzle-schema-logic.ts:553`.
- **A number enum is not falsely reported.** The generators emit a `CREATE TYPE`
  for number enums but keep the column `numeric`/`integer`; doctor gates
  `missing_enum` on `prop.type === "string"` and expects the numeric type, so the
  two agree. (The orphaned `CREATE TYPE` is a generator issue, out of scope.)
- **Policy drift compares the right things.** `checkPolicyDrift` diffs name,
  roles, command and clause *presence*, deliberately not the rewritten
  expression text, and `policy-drift.ts:174-188` records why — plus the separate
  tautology scan for `auth.uid() IS NOT NULL` that the name-keyed diff cannot
  see. `parseExpectedPolicies` reads the same DDL `db push` applies, so this is
  not a reimplementation.
- **`validatePolicyPgRoles`'s remediation is runnable.** `GRANT <role> TO
  rebase_user` is valid SQL, `rebase_user` is the role requests actually run as,
  and the Supabase-convention hint (`service_role` → `roles: ["admin"]`) names a
  real alternative.
- **`--help` is answered before the project guard** (`commands/doctor.ts:43-46`),
  so `rebase doctor --help` works outside a project. The documented regression
  has not returned.
- **Default paths agree with the writers.** `src/schema.generated.ts` matches
  `schemaCommand`'s default output (`cli.ts:1065`); `../generated/sdk/
  database.types.ts` matches what `generate-sdk` writes
  (`codegen/src/index.ts:34` + `generate_sdk.ts:337`); `../config/collections`
  matches the scaffold layout.
- **`--policies` survives all three process hops** — `entry` →
  `doctorCommand(rawArgs.slice(2))` → `runPluginCommand` →
  `doctorPluginCommand(rawArgs.slice(1))` → `execa(tsx, doctor-cli.ts,
  --policies)`. Verified by reading each `slice` against `process.argv`'s layout.
- **Both pools are closed in a `finally`** (`doctor.ts:604-606`,
  `doctor-cli.ts:59-61`).
- **`generateSDK` writes `generateTypedefs`' output verbatim** — no banner, no
  timestamp — so the SDK comparison is sound apart from the ordering defect
  (H3), and the deliberate absence of a generation timestamp is documented at
  `generate_sdk.ts:411-419`.

---

## Open questions

1. **Is the schema/database phase meant to be a *schema*→database comparison?**
   The field is `schemaToDatabase`, the docs describe "Generated schema ↔
   Database — are there unapplied changes?", and the implementation compares
   collections→database. Was the generated-schema comparison dropped, or never
   written? If the former, the migration-status check probably went with it.
2. **Should `rebase doctor` gate CI at all, or only `--policies`?** The docs
   commit only `--policies` to an exit code. If the full doctor is meant to gate,
   M6 (everything is a warning) needs a decision about which categories are
   fatal; if it is not, H1's false green matters less for CI and more for the
   interactive user.
3. **Who owns the junction table's schema?** M3 is fixable in the doctor (match
   the generator) or in the generator (honour the declaring collection's
   schema). The second is a behaviour change to `db push` for schema-qualified
   collections and would need a migration story.
4. **Is `reference` reachable on a Postgres collection?** `PostgresProperty`
   excludes it, yet both the DDL generator and the doctor implement it. If it is
   genuinely unreachable, both branches are dead code worth deleting; if it is
   reachable through introspection or a cast, L4 is a live false positive.
5. **Should doctor pre-empt `AuthSchemaVersionError`?** It is a boot-time hard
   failure with a clear pre-flight check (`auth/schema-version.ts:139`), and it
   is the kind of thing a user runs doctor *for*.
