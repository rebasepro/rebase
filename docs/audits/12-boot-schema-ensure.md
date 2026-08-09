# Unit 12 — Boot-time schema and policy creation

Read-only audit, `main` @ `c678e1745`, 2026-08-09.
Lens: bug-classes **19** (check-then-act in the thing written to prevent a race)
and **4** (safety nets that swallow their own failures).

Scope read in full: `packages/server/src/boot/{ddl-bootstrap,boot,driver,sources}.ts`,
`packages/server-postgres/src/schema/{ensure-collection-tables,ensure-collection-policies,dynamic-tables,rls-bootstrap-sql}.ts`,
`packages/server-postgres/src/PostgresBootstrapper.ts`,
plus `packages/server-postgres/src/security/rls-enforcement.ts`,
`packages/server-postgres/src/auth/ensure-tables.ts`,
`packages/common/src/util/{internal-tables,auth-default-policies}.ts`,
`packages/server/src/collections/loader.ts`.

Note: `packages/server/src/boot/ensure-collection-schema.ts` **does not exist**.
`ensureCollectionSchema` / `ensureCollectionPolicies` live in
`packages/server/src/boot/boot.ts:681` and `:811`; only the *test* file
`ensure-collection-schema.test.ts` carries that name.

---

## Verdict

The unit is **well-documented and materially unsafe under concurrency**, and it
fails **open** rather than closed in one specific, reachable case.

Two things stand out. First, this repository contains a module written
explicitly to solve the boot-time DDL race —
`packages/server/src/boot/ddl-bootstrap.ts`, whose docblock carries a
measurement ("with five instances booting at once, 8 of 10 `ensureTable` calls
hit it") — and the collection-table path does not use it. It is used by
`api-key-store.ts` and `cron-store.ts` and by nothing else. Every statement in
`ensureCollectionTables` is fatal on failure, so the documented 80%-loss race
becomes a crash loop rather than a retry. There is **no advisory lock anywhere
in the collection schema or policy path**; the only one in the whole boot is
`pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'))` at
`packages/server-postgres/src/auth/ensure-tables.ts:389`, and it covers four
`CREATE OR REPLACE FUNCTION` statements only.

Second, the established context "boot creates TABLES but historically not RLS"
is **out of date in the good direction and still wrong in one place**. Boot now
does apply RLS (`boot.ts:267`). But table creation and RLS enabling are two
separate, non-atomic steps with the driver's `GRANT … ON ALL TABLES … TO
rebase_user` sandwiched between them, and the RLS half is deliberately
non-fatal. When it fails, the pod comes up and listens, serving a table that
`rebase_user` holds full DML on with row-level security never enabled. Both log
lines emitted in that state assert the opposite ("it stays locked (denies)",
"Collections will deny reads until policies are applied").

Six early returns were expected in the ensure path. There are **eight**, and
seven log; the eighth logs at the wrong level. The policy twin has **five**
silent returns by design.

---

## Findings

### HIGH-1 — The boot DDL path ignores the repo's own race-retry helper; a simultaneous boot crash-loops the fleet

`packages/server-postgres/src/schema/ensure-collection-tables.ts:735-827`
(statement loop at `:801-825`; `CREATE SCHEMA` at `:750`)
vs. `packages/server/src/boot/ddl-bootstrap.ts:35-144`

Every statement `ensureCollectionTables` issues is run bare:

```ts
for (const action of plan.actions) {
    try { await client.query(action.sql); }
    catch (err) {
        if (action.kind === "add-constraint" || action.kind === "comment-column") { … continue; }
        throw new Error(`Failed to ${action.kind} ${action.target}: …`);
    }
}
```

Only `add-constraint` and `comment-column` are contained. Everything else
rethrows, and `boot.ts:681` is fatal on purpose, so the pod dies.

The statements that race, all of which `CONCURRENT_DDL_SQLSTATES`
(`ddl-bootstrap.ts:35-41`) already enumerates as retryable:

| statement | site | SQLSTATE on the losing pod |
|---|---|---|
| `CREATE SCHEMA IF NOT EXISTS` | `ensure-collection-tables.ts:750` | `42P06` |
| `CREATE TYPE … AS ENUM` | `:266` | `42710` (see HIGH-2) |
| `CREATE TABLE IF NOT EXISTS` | `:335`, `:348` | `23505` on `pg_type_typname_nsp_index` |
| `ALTER TABLE … ADD COLUMN IF NOT EXISTS` | `:399` | `23505` on `pg_attribute` |
| `CREATE EXTENSION IF NOT EXISTS` | `:287` | `23505` / `42710` |
| `CREATE OR REPLACE FUNCTION` | `:295` | `XX000` tuple concurrently updated |
| `CREATE INDEX CONCURRENTLY` | `:593` | `40P01` deadlock (two boots, same table) |
| `ALTER TABLE … RENAME COLUMN` | `:382` | `42703` — peer already renamed it |

**Failure scenario.** A replica count moving 1→3, a rolling deploy, or a
CrashLoopBackOff restarting the whole fleet. Two pods read the catalogue
(`readExistingSchema`, `:754`), both plan the same `CREATE TABLE`, both run it,
one raises `23505`. That pod throws out of `ensureCollectionSchema`, exits,
restarts, and races again. The database is left partially migrated: statements
before the losing one committed (each runs in its own autocommit — the docblock
at `:730-733` says so deliberately), everything after it did not. So the pod
that *did* win is fine, and the losers can oscillate. Per the measurement in
`ddl-bootstrap.ts:16`, at five instances this is the common case, not the tail.

Worse, the `rename-column` row is not even in the retryable set: pod A renames
`categorie_id`→`category_id`, pod B planned the same rename from a stale read,
and B's `ALTER` fails with `42703`, which `isConcurrentDdlRace` correctly
refuses to retry — so B is fatal every boot until someone intervenes.

**Fix direction.** Route the whole action loop through
`createDdlBootstrapper(...).ensureObject`, or — better for this path, because
the plan is derived from a catalogue read that must not go stale under a peer —
wrap the entire ensure in `SELECT pg_advisory_lock(hashtext('rebase_schema_ensure'))`
so exactly one pod plans-and-applies and the others wait and then find the work
done. The advisory lock also fixes HIGH-2, the `rename-column` case and the
`CREATE INDEX CONCURRENTLY` deadlock, none of which a retry alone can.

---

### HIGH-2 — `CREATE TYPE … AS ENUM` is a bare check-then-act (class 19)

`packages/server-postgres/src/schema/ensure-collection-tables.ts:260-267`

```ts
if (existing.enums.has(name) || plannedEnums.has(name)) continue;
…
sql: `CREATE TYPE "${schema}"."${typeName}" AS ENUM (…);`
```

Postgres has no `CREATE TYPE … IF NOT EXISTS`. Every other statement in this
module at least carries the (illusory) `IF NOT EXISTS` guard; this one is guarded
*only* by the catalogue read at `:754`. It is the textbook shape of class 19 —
read, then unrelated write — and unlike the others there is no syntax that could
paper over it.

**Failure scenario.** Any two pods booting a bundle that declares an enum
property against a database that does not yet have the type. Both read absent,
both `CREATE TYPE`, the loser gets `42710`, and per HIGH-1 that is fatal.

**Fix direction.** `DO $$ BEGIN CREATE TYPE … ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
is the local fix; the advisory lock in HIGH-1 is the general one.

---

### HIGH-3 — A lost race in `ensureAuthTablesExist` skips the `REVOKE` and boots anyway

`packages/server-postgres/src/auth/ensure-tables.ts:885-894` (the swallow),
`:873-882` (the revoke it skips)

The whole of `ensureAuthTablesExist` is one `try` block ending in:

```ts
} catch (error) {
    if (error instanceof AuthSchemaVersionError) throw error;
    logger.error("❌ Failed to create auth tables", { error });
    logger.warn("⚠️ Continuing without creating auth tables.");
}
```

This is bug-class 4 as documented, and `ddl-bootstrap.ts:18-21` describes this
exact file's failure mode in the abstract:

> A bootstrap written as one long `try` block therefore abandons everything
> after the losing statement — including, in every store that has one, the
> `REVOKE` that takes the table back off the end-user role. That revoke is a
> security control and must not be collateral damage from a race.

`ensure-tables.ts` is that store, it has that revoke at `:873`, and it does not
use the helper.

**Failure scenario.** Ordering at boot is `initializeDriver` → `ensureAppRole`
(`PostgresBootstrapper.ts:393`) → `initializeAuth` → `ensureAuthTablesExist`
(`init.ts:711` then `:904`). `ensureAppRole` runs
`ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO rebase_user`
(`rls-enforcement.ts:250`), so every auth table created immediately afterwards is
granted to the end-user role at creation. The revoke at `:873` is what takes it
back. Two pods booting together; one loses a `CREATE INDEX IF NOT EXISTS` or
`CREATE TABLE IF NOT EXISTS` race in the middle of the block (`:340-376`); the
catch swallows it, the revoke never runs, the pod logs a warning and **serves**.
`rebase.refresh_tokens`, `rebase.mfa_secrets`, `rebase.api_keys` and
`rebase.magic_link_tokens` carry no RLS (comment at `:861-863` says so) and are
now readable and writable by every authenticated request.

It self-heals: the *next* successful boot's `ensureAppRole` reaches
`revokeInternalTableAccess` at `rls-enforcement.ts:260` for the tables that by
then exist. But the window is a full pod lifetime, and nothing reports it — the
only evidence is a `logger.error` that the pod then contradicts by coming up.

**Fix direction.** Contain each statement with `ddl.step()` / `ddl.ensureObject()`
so a lost race cannot skip later steps, and move the revoke out of the guarded
region entirely (or assert it in the health check). At minimum, make the
outer catch re-run the revoke in a `finally`.

---

### HIGH-4 — A table whose `ENABLE ROW LEVEL SECURITY` fails is served wide open, and both log lines say the opposite

`packages/server-postgres/src/schema/ensure-collection-policies.ts:81-101`,
`packages/server-postgres/src/PostgresBootstrapper.ts:893-897`,
`packages/server/src/boot/boot.ts:824-837`

The applier's own comment states the safety argument:

```ts
// Enable first: if a later policy statement fails, the table is left
// locked (deny-all for the user role) rather than open.
await client.query(plan.enableRls);
```

That holds for a *later* statement. It does not hold when `plan.enableRls` is
itself the statement that throws — and it is inside the same `try`. `ALTER TABLE
… ENABLE ROW LEVEL SECURITY` requires table ownership; the same module family
already documents that an adopted table may not grant ownership
(`ensure-collection-tables.ts:812-816`, on `COMMENT`). When it throws, the table
is recorded in `failures` and boot continues.

The state that leaves:

1. `ensureCollectionSchema` (`boot.ts:215`) created the table — with no
   `ENABLE ROW LEVEL SECURITY` and no `GRANT`; `ensure-collection-tables.ts`
   contains neither token.
2. `initializeRebaseBackend` (`boot.ts:217`) → `ensureAppRole`
   (`rls-enforcement.ts:246`) granted `rebase_user`
   `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`.
3. `ensureCollectionPolicies` (`boot.ts:267`) failed to enable RLS.
4. `server.listen` (`boot.ts:360-371`) runs anyway.

Result: a table with full DML granted to the role every authenticated request
runs as, and **no** row-level security. Fail-open, and it is the one outcome the
module's docblock (`ensure-collection-policies.ts:28-31`) promises is impossible.

The two messages a reader gets are both false in this state:

- `PostgresBootstrapper.ts:895` — *"it stays locked (denies) until this is resolved"*
- `boot.ts:833` — *"Collections will deny reads until policies are applied."*
  (the driver-has-no-`ensureCollectionPolicies` branch, which produces exactly
  the same state for **every** table)

This is class 4 stacked on class 5: a safety net whose failure path is
mis-described, so the remediation text tells an operator the risk is
availability when it is disclosure.

**Fix direction.** Split `enableRls` out of the per-table `try`, and treat *its*
failure as fatal (or, if that is too harsh for an adopted table, `REVOKE ALL ON
<table> FROM rebase_user` before continuing, which restores fail-closed without
crashing). Correct both messages to distinguish "RLS on, policies missing"
(denies) from "RLS never enabled" (open). For the missing-driver branch at
`boot.ts:824`, the honest line is that collections are served **unprotected**.

---

### MEDIUM-1 — `primary = dataSources[0]` is positional, not `isDefault`

`packages/server/src/boot/boot.ts:724` and `:822`,
`packages/server/src/boot/sources.ts:143-189`

`resolveDataSources` preserves declaration order when the project explicitly
declares a source keyed `"(default)"`:

```ts
const effective = hasDefault ? serverSide : [{ key: DEFAULT_DATA_SOURCE_KEY, … }, ...serverSide];
```

`isDefault` is computed per source (`sources.ts:186`) and used correctly
elsewhere — `driver.ts:294` hands the bundle schema only to the default source,
`boot.ts:294` filters the health probe on `DEFAULT_DATA_SOURCE_KEY`. Both ensure
functions instead take index `0`.

**Failure scenario.** `dataSources: [{ key: "analytics", engine: "postgres" }, { key: "(default)", engine: "postgres" }]`.
`primary` is `analytics`. `collectionsStoredBy` (`boot.ts:626`) keeps every
collection, because both sources are `postgres` and the filter compares engines,
not keys. Boot then creates the project's entire table set **and applies its RLS
policies** in the analytics database, while the default database — which is
where the driver registry routes every collection at request time — gets
nothing. The log says "Applied N additive schema change(s)". Every `/api/data/*`
route 500s on a missing relation, and the tables that exist are in a database
nothing reads.

The existing test (`packages/server/test/boot-sources.test.ts:50, :62`) always
declares `"(default)"` first, so the ordering assumption is never exercised.

**Fix direction.** `const primary = dataSources.find(s => s.key === DEFAULT_DATA_SOURCE_KEY)`,
and pin it with a test whose declaration order puts the default second.

---

### MEDIUM-2 — Non-transactional `DROP POLICY` → `CREATE POLICY`, on every boot, for every table

`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:126-131`
(the pair), applied at
`packages/server-postgres/src/schema/ensure-collection-policies.ts:88-93`

`generateSinglePolicyStatements` returns `[drop, create]`, and the applier runs
them as two separate `client.query()` calls with no surrounding transaction (it
cannot batch — the handle speaks the extended query protocol). Both DDL
statements take `ACCESS EXCLUSIVE` and each commits on its own, so the lock is
released between them.

**Failure scenario.** During a rolling deploy the outgoing pod is still serving.
For the duration between the two statements, that policy does not exist. Two
consequences, in order of severity:

- A **restrictive** policy is absent, so the permissive policies alone govern
  the write. `users_require_admin_write`
  (`packages/common/src/util/auth-default-policies.ts:129-135`) is exactly such
  a gate, and its whole purpose is that "no permissive rule … can let a
  non-admin change privileged columns like `roles`". A concurrent
  `UPDATE users SET roles = …` landing in that window is evaluated without it.
- A permissive `SELECT` policy is absent, so reads return **zero rows** rather
  than an error — a silent empty result, which is the failure mode
  `drizzle-conditions.ts:721` already calls out as opaque.

Secondarily, the module docblock (`ensure-collection-policies.ts:22-24`) claims
"It adds and replaces; it never drops data." True of data, not of policies: the
`DROP` lands unconditionally and the `CREATE` may not, so a `CREATE POLICY` that
fails permanently removes a policy that was working before this boot.

**Fix direction.** `CREATE OR REPLACE POLICY` (PG 15+) removes the window
entirely for the replace case. Failing that, apply each table's whole statement
list inside one explicit transaction — DDL is transactional in Postgres, so a
`BEGIN`/`COMMIT` around `plan.policyStatements` makes the swap atomic and also
makes a mid-table failure roll back rather than leave a half-applied ACL.

---

### MEDIUM-3 — `applied === 0` prints a success message on total failure

`packages/server/src/boot/boot.ts:852-856` (and the same shape at `:769-773`)

```ts
logger.info(applied > 0
    ? `Applied ${applied} RLS policy statement(s) before serving.`
    : "RLS policies are up to date.");
```

`applied` is `outcome.policiesApplied` (`PostgresBootstrapper.ts:922`), which
counts only `CREATE POLICY` statements that *ran*. If every table's `enableRls`
throws, `policiesApplied` is `0` and boot logs **"RLS policies are up to date."**
The `failures` array is dropped on the floor by boot — `boot.ts:847` destructures
`{ applied }` only — and is warned separately one layer down at
`PostgresBootstrapper.ts:893`, so the last word on the subject in the log is the
false reassurance.

Same for schema: `applied = plan.actions.length - plan.failures.length`
(`PostgresBootstrapper.ts:852`), so an all-failed plan reports "Collection schema
is up to date."

**Fix direction.** Return the failure count across the `BackendBootstrapper`
boundary and make the summary line read from it; "up to date" must require
`failures === 0 && skipped === 0`.

---

### MEDIUM-4 — Nothing verifies the policies after the fact, and the table check that exists is warn-only and mispositioned

`packages/server-postgres/src/PostgresBootstrapper.ts:596-684`,
`packages/server-postgres/src/security/policy-drift.ts:190`

There *is* an after-the-fact check: `initializeDriver` compares registered
collections against introspected tables and prints a `SCHEMA DRIFT` warning.
Three problems.

1. **It runs at the wrong point.** It is inside `initializeDriver`
   (`boot.ts:217`), which is between `ensureCollectionSchema` (`:215`) and
   `ensureCollectionPolicies` (`:267`). Its own remediation text says *"Check
   the \"Collection schema\" / \"policies\" log lines above"*
   (`PostgresBootstrapper.ts:665`) — the policies line has not been printed yet
   on this boot. Class 5.
2. **It covers tables only.** No check asks whether RLS is enabled or whether
   the expected policies exist.
3. **`checkPolicyDrift` — which answers exactly that question, including the
   `insecure` anonymous-permissive case — is never called at boot.** Its only
   production callers are `packages/server-postgres/src/cli.ts:506` (`db push`)
   and `packages/server-postgres/src/schema/doctor-policy-checks.ts:86`
   (`rebase doctor`). Neither can reach a managed tenant's in-cluster database,
   which is the entire justification given at
   `ensure-collection-policies.ts:11-15` for the boot applier existing at all.

The whole validation block is additionally wrapped in
`catch { logger.warn("⚠️ Startup schema validation could not run") }`
(`:680-684`) — class 4.

**Fix direction.** Call `checkPolicyDrift` after `ensureCollectionPolicies` and
log its `missing` and `insecure` sets, and move the table drift check to the same
point so its own remediation text becomes true.

---

### MEDIUM-5 — Column *types*, nullability and added enum labels are invisible to the ensure

`packages/server-postgres/src/schema/ensure-collection-tables.ts:602-676`
(`readExistingSchema`), `:387-401` (`addColumn`), `:260` (enums)

`readExistingSchema` selects `table_schema, table_name, column_name` and nothing
else, building `Map<string, Set<string>>` of names. `addColumn` returns early on
`present?.has(column)`. So:

| config change | what boot does | what the user sees |
|---|---|---|
| property type `string`→`number` | nothing, no log | writes fail at runtime with a cast error |
| `required` added | nothing, no log | nulls keep going in |
| `defaultValue` changed | nothing, no log | old default keeps applying |
| **enum gains a label** | nothing, no log | `invalid input value for enum` on the first row using it |
| property removed | nothing (documented, `:19-23`) | column stays — correct |
| table renamed | new empty table created | old table orphaned, data invisible |

The first four are silent. The enum one deserves separate weight: `ALTER TYPE …
ADD VALUE` is *additive and non-destructive*, so it is inside this path's stated
mandate ("create a missing table, add a missing column, create a missing enum
type"), and it is the one a developer hits routinely — adding a status to a
status enum. `existing.enums` is a set of type *names* (`:635`), so a type that
exists is never inspected for its labels.

**Fix direction.** At minimum, read `information_schema.columns.udt_name` /
`is_nullable` and `pg_enum.enumlabel`, and *report* every divergence as a warning
naming `rebase db push` — the additive path need not fix them, but silence here
is indistinguishable from a database that was never migrated, which is the
failure mode `boot.ts:669-674` says this whole function exists to make
impossible. Adding enum labels is safe enough to actually apply.

---

### MEDIUM-6 — `REBASE_MIGRATE_ON_BOOT` documentation contradicts the code, and `push` is a dead value

`packages/server/src/boot/env.ts:45`, `packages/server/src/boot/boot.ts:694` and `:816`

```ts
REBASE_MIGRATE_ON_BOOT: z.enum(["none", "ensure", "push", ""]).optional(),
```

Both consumers do `const mode = env.REBASE_MIGRATE_ON_BOOT || "ensure"` and then
compare only against `"none"`. So:

- **`"push"` is read by nothing.** It is accepted by the schema and documented
  in four locales; it behaves identically to `"ensure"`. Class 21 — a declared
  option nothing reads. Grep confirms no other consumer anywhere in
  `packages/`, `saas/`.
- **The documented production default is the opposite of the code.**
  `website/src/content/docs/docs/architecture/runtime-and-bundles.md:138` (and
  the `it`, `pt`, `de` copies) says *"`none`, `ensure` or `push`. Defaults to
  `none` in production."* The code defaults to `"ensure"` unconditionally —
  there is no `NODE_ENV` branch. An operator reading that table concludes a
  container restart cannot rewrite their schema. It can.
- **`self-hosting.md:103`** (`docs`, `it`, `pt`) says `ensure` is *"the default
  — auth tables only"*. It is not: `ensure` creates collection tables, columns,
  enum types, extensions, functions, indexes, and applies every RLS policy.

**Fix direction.** Either implement `push` or drop it from the enum and the
docs; correct the default and the description in all locales. Note this is
exactly what `pnpm verify:docs` cannot catch — these are prose claims, not
fenced code.

---

### LOW-1 — The one early return that breaks the function's own info/warn rule

`packages/server/src/boot/boot.ts:759-762`

The docblock states the rule at `:686-689`: *"`info` is for the bundle shapes
with legitimately nothing to create; `warn` is for a bundle that asked for
collection tables and is not getting them. A backend carrying a config package
is the shape that expects tables, so **every stop after that point** is a real
problem worth raising."*

Enumerating every exit:

| # | line | condition | level |
|---|---|---|---|
| 1 | `:695` | `mode === "none"` | info ✔ |
| 2 | `:703` | `kind !== "backend"` | info ✔ |
| 3 | `:707` | no `entry.config` | info ✔ |
| 4 | `:715` | no `collectionsDir` | warn ✔ |
| 5 | `:725` | no data source | warn ✔ |
| 6 | `:729` | adapter lacks the method | warn ✔ |
| 7 | `:752` | zero collections loaded | warn ✔ |
| 8 | `:759` | zero collections stored by primary | **info** ✘ |

Exit 8 is past the config-package gate, with N collections successfully loaded,
and it creates nothing. It is reached whenever `collectionsStoredBy`
(`boot.ts:626`) filters everything out — a `primary.engine` string that does not
match what the collections declare, or the MEDIUM-1 wrong-primary case, which
lands here whenever the misidentified primary has a different engine. The
companion `logForeignCollections` (`:656`) also logs at info. The policy twin
(`:845`) returns entirely silently.

**Fix direction.** `skip(…, "warn")` at `:760`, and give the policy function the
same line rather than a bare `return`.

---

### LOW-2 — `information_schema.columns` is privilege-filtered; the sibling catalogue reads are not

`packages/server-postgres/src/schema/ensure-collection-tables.ts:614-627`
vs. `:629-673`

Tables and columns are read from `information_schema.columns`, which Postgres
filters to objects the current role has *some* privilege on. Enums, constraints
and comments are read from `pg_type` / `pg_constraint` / `pg_description`, which
are not filtered.

**Failure scenario.** An adopted table owned by another role with no grants to
the connection role reads as **absent**. `CREATE TABLE IF NOT EXISTS` no-ops
(fine), then `ALTER TABLE … ADD COLUMN IF NOT EXISTS` raises `42501` and, per
HIGH-1, is fatal. The message names the column, not the ownership, so the
diagnosis is "boot cannot add a column that is already there".

**Fix direction.** Read tables from `pg_class`/`pg_attribute` so presence is
never confused with privilege, and add an ownership check to the error path so
`42501` on a table that *does* exist says so.

---

### LOW-3 — `ensureAppRole` skips grants for a schema created later in the same boot

`packages/server-postgres/src/security/rls-enforcement.ts:240-243`

```ts
const nspRows = await run("SELECT nspname FROM pg_namespace");
const existing = new Set(nspRows.map(r => String(r.nspname)));
for (const schema of uniqueSchemas) {
    if (!existing.has(schema)) continue;
```

`ensureAppRole` is called with `["public", "rebase", ...collectionSchemas]`
(`PostgresBootstrapper.ts:393`). On a genuinely first boot of a project where no
collection declares `schema: "rebase"`, the `rebase` schema does not exist yet —
it is created afterwards by `RLS_BOOTSTRAP_STATEMENTS[0]`
(`rls-bootstrap-sql.ts:50`) inside `ensureAuthTablesExist`. So the `continue`
fires, and neither `GRANT USAGE ON SCHEMA rebase` nor the
`ALTER DEFAULT PRIVILEGES IN SCHEMA rebase` runs on that boot. It self-heals on
the next one. Another check-then-act, though a benign one.

**Fix direction.** `CREATE SCHEMA IF NOT EXISTS` the required schemas before the
loop rather than skipping them, or move the `rebase` bootstrap ahead of
`ensureAppRole`.

---

### LOW-4 — The only DROP path at boot goes silent when its catalogue read fails

`packages/server-postgres/src/schema/rls-bootstrap-sql.ts:237-239` and `:261-263`

Answering "does boot ever DROP anything?": **yes, one path.**
`PostgresBootstrapper.ts:906-920` calls `dropLegacyAuthSchema` after applying
policies, which issues `DROP FUNCTION auth.uid()/jwt()/roles()` and
`DROP SCHEMA auth RESTRICT`. It is well-guarded — each function is matched on
result type *and* body text, `RESTRICT` never `CASCADE`, and both the policy
dependents and the string-body function dependents are enumerated first. That
design is sound and the reasoning at `:79-104` is correct.

The two blemishes:

```ts
} catch {
    return; // No catalogue access; nothing here is worth failing a boot for.
}
```

Both blocker queries swallow **without logging**. A boot where the catalogue read
fails is indistinguishable from one where there were no blockers, and the
docblock at `:225-228` says the whole point of this function over the previous
"fire and swallow" version was that "the schema stays forever and nothing ever
says why". These two returns reintroduce exactly that.

Residual class-19 note, low confidence on impact: `LEGACY_RLS_FUNCTION_DEPENDENTS_SQL`
is a read followed by an unrelated `DROP`. Postgres records no dependency for a
string-literal SQL body (that is the whole reason the query exists), so nothing
holds the lock between the check and the drop. A concurrent session creating such
a function — or a second pod's `db push` — falls in the gap. Given the control
plane defines `auth.is_org_member` this way (`:199-205`), the window is small but
the blast radius is eleven RLS policies.

**Fix direction.** Log at `warn` in both catches. Take the same advisory lock as
HIGH-1 around the drop.

---

### LOW-5 — `CREATE INDEX CONCURRENTLY` can leave an INVALID index that `IF NOT EXISTS` then skips forever

`packages/server-postgres/src/schema/ensure-collection-tables.ts:588-595`

```ts
sql: statement.replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX CONCURRENTLY IF NOT EXISTS")
```

Search index statements are emitted unconditionally on every boot — there is no
index existence read in `readExistingSchema`, so the plan relies entirely on
`IF NOT EXISTS`.

**Failure scenario.** A pod killed mid-build (a Kubernetes `startupProbe`
deadline during a long GIN build on a populated table, an OOM, a rolling
replace) leaves the index in Postgres marked `indisvalid = false`. It is
present, so on every subsequent boot `IF NOT EXISTS` skips it. The index is never
used by the planner and never rebuilt: full-text search silently sequential-scans
forever, and nothing logs. The `applied` count includes the skipped statement.

**Fix direction.** Read `pg_index.indisvalid` in `readExistingSchema` and plan a
`DROP INDEX` + rebuild for an invalid one; that is destructive in name only —
an invalid index holds no queries.

---

## Checked and clean

- **Table set and policy set agree.** Both `ensureCollectionTables` (`:252`) and
  `planCollectionPolicies` (`generate-postgres-ddl-logic.ts:1057`) filter through
  `relationalCollections`, so no table is created that the policy planner then
  ignores, and junctions are covered on both sides
  (`ensure-collection-tables.ts:344-349`, `generate-postgres-ddl-logic.ts:1087`).
- **A rule-less collection is not permanently deny-all.**
  `getEffectiveSecurityRules` (`auth-default-policies.ts:92-138`) injects
  baseline server/admin read and write policies, so `ENABLE ROW LEVEL SECURITY`
  on a collection with no `securityRules` still leaves the admin studio working.
  (`disableDefaultPolicies: true` with no explicit rules does yield RLS-on /
  zero-policies deny-all — but that is the documented opt-out, and it fails
  closed.)
- **Policies are ordered after auth initialization for the right reason.**
  `boot.ts:254-267` and `PostgresBootstrapper.ts:860-863`: `CREATE POLICY`
  validates the `rebase.uid()` functions exist, and those are created inside
  `ensureAuthTablesExist`. Verified the call order in `init.ts:711` → `:904`.
- **The HTTP listener does not open during the ensure.** `server.listen` is at
  `boot.ts:360-371`, after both ensure steps, so this pod's own requests cannot
  land in the RLS-off window. (HIGH-4 is reachable via a peer pod, or via this
  pod after a *failed* enable, not via a successful boot's own window.)
- **`loadCollectionsFromDirectory` fails loudly.**
  `packages/server/src/collections/loader.ts:142-148` accumulates per-file
  failures and throws; it does not skip a broken collection file and quietly
  create one fewer table.
- **Identifier interpolation is guarded.** `assertSafeIdentifier`
  (`ensure-collection-tables.ts:72-79`) is applied to every schema name that
  reaches a statement, and `quoteSqlLiteral` (`generate-postgres-ddl-logic.ts:142`)
  escapes enum labels. `revokeInternalTableSql` (`internal-tables.ts:114-120`)
  does the same. No unguarded interpolation found in the DDL path.
- **`preInitDriverResult`** (`boot.ts:793-795`) correctly wraps the raw
  connection as `{ internals }`; the narrow cast and its comment are right, and
  `packages/server/src/boot/ensure-collection-schema.test.ts:210-256` pins it.
- **The adapter→bootstrapper forwarding hop is covered in both directions.**
  `driver.ts:254-261`, `init.ts:597-604`, `PostgresAdapter.ts:54-62`, pinned by
  `adapter-to-bootstrapper.test.ts`, `bootstrapper-forwarding.test.ts` and
  `postgres-adapter-forwarding.test.ts`. This was bug-class 11's instance and it
  is now gated properly.
- **`ddl-bootstrap.ts` itself is correct** — narrow race classification
  (`:69-75`), bounded cause-chain walk (`:51-60`), jittered backoff (`:103-104`),
  per-statement containment. The defect is that the schema path does not use it.
- **`dynamic-tables.ts` issues no DDL.** It builds drizzle table objects from
  introspected metadata for BaaS mode; nothing in it can race or create. Clean
  for this audit's purposes.
- **`sources.ts` fails closed on a missing connection string** (`:156-163`) and
  on a `direct`-transport default (`:191-210`), with the right reasoning: a
  silent fallback would write to the wrong database.

---

## Open questions

1. **Is the multi-pod boot ever actually exercised?** `managed-boot-acceptance.test.ts`
   runs `ensureCollectionTables` → `ensureAppRole` → `ensureCollectionPolicies`
   in production order (`:180`, `:186`, `:190`) and re-runs both for idempotence
   (`:351`, `:355`), but sequentially, in one process. Nothing found runs two
   concurrent ensures against one database. The measurement in
   `ddl-bootstrap.ts:16` was clearly taken by hand. **UNCONFIRMED** whether the
   managed control plane ever starts more than one pod of a new revision
   simultaneously — if `maxSurge` is 1 and readiness gates the old pod out, the
   HIGH-1 window narrows considerably. Worth checking the rollout spec in
   `saas/`.
2. **Does any real project declare `"(default)"` other than first?** MEDIUM-1 is
   confirmed by reading, but I found no repository fixture or customer config
   that triggers it. The bug is real; the exposure is unknown.
3. **Is `ALTER TABLE … ENABLE ROW LEVEL SECURITY` failing on ownership a state
   that actually occurs in the managed tier?** HIGH-4's severity depends on it.
   In managed CNPG the runtime creates the tables and therefore owns them. The
   reachable variants I am confident about are the *driver lacks
   `ensureCollectionPolicies`* branch (`boot.ts:824`, which produces the same
   open state for every table and is documented as a live scenario in
   `PostgresBootstrapper.ts:669-673`) and an adopted/BYO database. **UNCONFIRMED**
   for a clean managed tenant.
4. **`REBASE_MIGRATE_ON_BOOT=push`** — was this ever implemented and removed, or
   never wired? The env enum, four doc locales and `errors.ts:266` all reference
   it. Determining intent decides whether MEDIUM-6's fix is "implement" or
   "delete".
5. **Should the boot applier reconcile orphaned policies?**
   `ensure-collection-policies.ts:22-24` explicitly declines to, deferring to
   `db push`. But a managed tenant's database is unreachable by `db push` — the
   stated reason this applier exists. So a policy renamed between releases is
   left behind on a managed tenant permanently, and a permissive orphan is
   additive access nobody declared. `dropOrphanedPolicies` already exists in
   `policy-drift.ts` and is called only from `cli.ts:498`. This reads like a gap
   rather than a decision, but it is a product call.
