# The request role on existing and shared databases

**Status:** proposal, 2026-11-09. Nothing here is built. Decisions for
Francesco are at the end.
**Verified against:** `main` at `ea426c9171` (0.29.0), and a throwaway
PostgreSQL 18.4 cluster.

## The short version

Rebase runs every signed-in request as one restricted role, `rebase_user`, and
lets RLS decide which rows that request sees. This is sound on a database
Rebase owns outright: Rebase Cloud (one CNPG cluster per tenant), the Docker
tenant path (one container per tenant), PGlite, and a scaffolded local
database.

It is not sound on a database someone already runs. That includes a cluster
shared with other apps, a second Rebase project on the same cluster, or a
schema that already has its own roles and RLS. Rebase is sold as a backend
"over any Postgres", and `rebase init --headless` and introspection target
exactly those databases. Five things go wrong there. The worst is that **two
Rebase projects on one cluster can read and write each other's data as each
other's admins.**

The recommendation, in order:

1. **Fix the two small bugs now.** The `pgRoles` check uses the wrong
   membership test, and the grant check never settles on a shared schema.
   Neither fix changes compatibility.
2. **Detect and explain before changing behaviour.** Add a read-only database
   preflight to `rebase doctor`. Add boot warnings for a request role that
   other logins can switch into. Publish a per-provider privilege table.
3. **Make the role name configurable, with `rebase_user` as the default.**
   Record the chosen name in the database, so a later boot cannot silently
   pick a different one.
4. **In one minor release with release notes,** point permissive policies at
   the request role instead of `public`, and grant only on the tables Rebase
   manages.

Every step keeps existing deployments working with no change on their side.
Step 4 changes behaviour only for roles that are not Rebase's own, and only
where those roles were silently relying on Rebase's grants and policies.

## How it works today

- The connection role owns the tables, so it bypasses RLS. That is the
  server context.
- On each user request, `applyAuthContext`
  (`packages/server-postgres/src/security/rls-enforcement.ts:597`) sets
  `app.uid`, `app.user_roles`, `app.is_anonymous` and `app.jwt`, then
  `set_config('role', 'rebase_user', true)`. All of this happens in one
  statement, inside the transaction.
- `rebase_user` is `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`. It gets DML on
  the managed schemas, and RLS filters every statement.
- Every collection carries an injected baseline,
  `rebase.uid() IS NULL OR roles && ARRAY['admin']`
  (`packages/common/src/util/auth-default-policies.ts:63`). The `IS NULL` arm
  is the server context. It is safe only because no request path ever leaves
  `app.uid` empty (see the memory note on the `auth.uid() IS NULL` false
  positive).

The model has two load-bearing assumptions. First, only this project's server
can become `rebase_user`. Second, only `rebase_user` and the owner ever touch
these tables. A database Rebase owns satisfies both. An existing database
satisfies neither.

## Findings

Each finding was re-read in source and reproduced on PG 18.4 on 2026-11-09.

| # | Finding | Where | Reproduced |
|---|---|---|---|
| 1 | The role name is a hardcoded constant, and roles belong to the whole cluster. Project A's connection role is a member of the same `rebase_user` as project B's. By default PUBLIC has `CONNECT` on every database, so A can connect to B's database, set `app.uid`/`app.user_roles` (anyone can set a custom GUC), `SET ROLE rebase_user`, and pass B's policies as B's admin. | `packages/common/src/util/internal-tables.ts:56`; `ensureAppRole` at `rls-enforcement.ts:316` adopts whatever role of that name exists | `app_a` connected to `db_b`, claimed `admin`, and read 2 of 2 rows in a table only B's admins should see |
| 2 | Grants cover whole schemas. `ensureAppRoleGrants` runs `GRANT … ON ALL TABLES IN SCHEMA` on `public`, `rebase` and every collection schema, plus `ALTER DEFAULT PRIVILEGES`. That reaches tables Rebase does not manage. If the connection has no privilege on some table in `public`, the statement errors, and boot aborts when the connection currently bypasses RLS (`PostgresBootstrapper.ts:1068-1072`). If it holds privileges without grant option, Postgres only warns, but `readSchemaGrants` keeps reporting the schema as incomplete, so the grant re-runs on every boot. Each run rewrites every table's `pg_class` row and invalidates cached plans. | `rls-enforcement.ts:522-540`, `readSchemaGrants` at `:441` | `ERROR: permission denied for table payroll`. With a plain `SELECT` grant: `WARNING: no privileges were granted for "payroll"` |
| 3 | Default policies apply `TO public`. A rule without `pgRoles` compiles to `TO public` (`packages/common/src/util/policy/compileRulePolicies.ts:58`). The injected baseline's `rebase.uid() IS NULL` arm is true for any session that never sets `app.uid`. So any foreign role with a table grant sees every row, and with write grants can write every row. | `compileRulePolicies.ts:58`, `auth-default-policies.ts:63-72` | `other_app`, given `SELECT` and never setting `app.uid`, read 2 of 2 rows |
| 4 | Existing role-based RLS never applies. A policy written `TO authenticated` (Supabase style) needs the current role to *have the privileges of* `authenticated`. `rebase_user` is `NOINHERIT`, so membership alone does not give them. `validatePolicyPgRoles` tests `pg_has_role(…, 'MEMBER')`, passes, and suggests `GRANT authenticated TO rebase_user`. That grant still yields 0 rows. | `rls-enforcement.ts:824-877`, test at `:849` | With `rebase_user` a member of `authenticated`: `MEMBER = t`, `USAGE = f`, rows seen 0 |
| 5 | No preflight. Nothing tells an operator, before DDL runs, which privileges Rebase needs or what it will grant on their database. The error after the fact (`appRoleSetupInstructions`, `rls-enforcement.ts:283`) prints schema-wide grants, which reproduces finding 2. `rebase doctor` checks the environment and policy drift, not privileges. | `packages/cli/src/commands/doctor.ts` | n/a |

Not yet verified, and worth checking against a live Supabase project before
deciding priority: Supabase's stock default privileges grant tables created in
`public` to `anon` and `authenticated`. If they still do, finding 3 combines
with them. Every Rebase collection table created on a Supabase database would
then be readable in full through Supabase's own Data API by an anonymous
caller, because PostgREST never sets `app.uid`. `packages/rls-check` already
lists `anon`/`authenticated`/`web_anon` as exposed roles
(`packages/rls-check/src/introspect.ts:198`), so it would flag the result, but
only after the fact.

## Constraints any fix has to respect

- **Shipped names are frozen** (contract 6 in `docs/compatibility.md`, and
  `pnpm check:derived-names`). `rebase_user` appears in users' own migrations:
  the docs tell them to write `GRANT … TO rebase_user` for functions, scripts
  and deployment setup (`website/.../backend/custom-functions.md`,
  `deployment/instapods.md`, `deployment/hostman.md`, among others). It also
  appears in the exported `REBASE_USER_ROLE` (`packages/server-postgres/src/index.ts:80`).
  The default cannot change, and the export has to be deprecated before it is
  removed.
- **No upgrade may break an existing database.** A new check that would
  refuse to boot a deployment that works today is a breaking change, however
  correct it is.
- **Where a fact lives.** The test is whether the value differs between two
  deployments of the same commit. The request role name does: staging and
  production of one project can share a cluster. So the name is a placement
  fact. It belongs in the environment, not in `rebase.json` or the
  collections.
- **The role is referenced in about 15 source files** across server-postgres,
  server (the API key, cron and job stores revoke from it), cli, studio (RLS
  presets) and rls-check. `driver.rlsUserRole` and `applyAuthContext(…, userRole)`
  already carry the name at runtime. The constant is the problem, not the
  plumbing.

---

## Issue 1: the shared role name

### Options

**1A. A configurable name, defaulting to `rebase_user`.** For example
`REBASE_REQUEST_ROLE=acme_prod_user`. Every site reads one resolved value: the
driver's `rlsUserRole`, set once at boot.
- For: no change for anyone who does not set it. Two projects on one cluster
  can each get their own role. Staging and production on one cluster can too.
- Against: a project has to know to set it. That is what the detection in 1C
  and the preflight in issue 5 are for. User SQL that says `TO rebase_user`
  has to be updated by a project that opts in.

**1B. A name derived per database,** for example `rebase_user_<db>` or a hash
of `current_database()`.
- For: shared clusters are safe with no configuration.
- Against: a derived identifier is frozen the moment it ships. Renaming the
  database, restoring it under another name, or a `_dev_diff` scratch copy
  would each derive a different role and lose every grant. Long database names
  hit the 63-byte limit. It also changes the default for every new project,
  which then diverges from every doc and user migration that says
  `rebase_user`.

**1C. Keep one name, and detect when other logins can become it.**
`pg_auth_members` is a shared catalogue, so any database can list the members
of the request role. A member other than the connection role, or a superuser,
means another login can switch into it.
- For: cheap, read-only, and it catches the dangerous state whatever caused it.
- Against: detection is not a fix. Two Rebase projects on one cluster both
  *need* membership, so refusing to boot would force one cluster per project.
  It would also break deployments that run today.

**1D. Bind the request context cryptographically,** for example a signed
`app.jwt` that `rebase.uid()` verifies.
- Rejected. It costs a signature check per row evaluation, needs key
  distribution into the database, and keeps a shared role whose grants still
  leak. Who can become the role is the real boundary. Membership already
  expresses that.

**1E. Revoke `CONNECT` from PUBLIC on each database.**
- An operator hardening step, not something Rebase should run on a database it
  does not own. The preflight should check for it and recommend it.

### Recommendation

1A plus 1C, with the name recorded in the database:

- `REBASE_REQUEST_ROLE` (name to be decided) is read at boot. It defaults to
  `rebase_user`.
- On the first provisioning boot, store the name in `rebase.schema_meta`. A
  later boot with a different configured name **refuses**. It does not
  provision a second role and leave the first one holding grants. It names the
  migration command below. This makes the name declared once and then read,
  never re-derived.
- At boot, list the request role's members. If any login role other than the
  connection role can switch into it:
  - when the name is the default `rebase_user`, **warn**, naming the other
    members and saying how to move to a dedicated name. Refusing here would
    break shared clusters that run today.
  - when the name is non-default, **refuse**. Being exclusive is the whole
    reason to pick a dedicated name, and nothing that runs today is configured
    that way.
- Add `rebase db request-role migrate --to <name>`. It creates the new role,
  re-issues in *this database only* every grant the old role holds (from
  `aclexplode` over `pg_class`, `pg_proc`, `pg_namespace` and default ACLs),
  runs `ALTER POLICY … TO` on policies that name the old role, records the new
  name, and leaves the old role alone. `ALTER ROLE … RENAME` would be simpler,
  but the role belongs to the cluster: on a shared cluster, renaming it moves
  every other database's grants too. Offer the rename only when the preflight
  shows no other database uses the role.

### Compatibility impact

None by default. The exported `REBASE_USER_ROLE` stays and is deprecated in
favour of reading the resolved name from the driver (alias, plus a one-time
warning, as with other public names). rls-check gains a `--request-role` flag
and reads the recorded name from `schema_meta` when it can. Its hardcoded
`rebase_user` (`packages/rls-check/src/checks/anonymous-write-allowed.ts:142`)
remains the fallback.

---

## Issue 2: blanket grants

### Options

**2A. Grant per managed table.** Grant only on tables the registry knows:
collection tables, junction tables, auth tables, and Rebase's own RLS-enabled
tables. Issue the grant where the table is created: the boot-time ensure, and
`migration-post-process.ts` for Atlas migrations.
- For: Rebase's footprint is exactly what it serves. The error and the
  re-run-every-boot loop go away. A foreign table is never touched.
- Against: a table a user creates by hand and then reads through user-context
  SQL (a custom function that runs as the request role) no longer gains the
  grant automatically. It needs an explicit `GRANT`, which is normal Postgres
  practice.

**2B. Keep schema-wide grants in schemas Rebase owns, and grant per table
elsewhere.** A schema counts as Rebase's when its owner is the connection
role and every table in it is managed.
- For: nothing changes for the common case.
- Against: the behaviour flips on a catalogue fact the operator never chose.
  One stray table in `public` changes how grants work, which is hard to
  explain and hard to test.

**2C. Keep schema-wide intent, but issue the grant per table the connection
owns.**
- For: fixes the abort and the loop with minimal change.
- Against: it still hands `rebase_user` every unmanaged table the connection
  owns. On a database where the app role predates Rebase, that is all of them.

**2D. Put Rebase's collections in their own schema on existing databases.**
- Already possible through the collection's `schema`. A good recommendation in
  the docs, but not a fix: introspected projects serve the tables where they
  already are.

### Recommendation

2A:

- The readiness check (`readSchemaGrants`) asks about managed tables only, so
  it settles. That part is the Phase 0 bug fix and changes nothing else.
- New databases get per-table grants and no `ALTER DEFAULT PRIVILEGES` in
  `public`. Default privileges stay for the `rebase` schema and for collection
  schemas Rebase created, where every table is Rebase's by construction.
- On existing databases, never revoke a grant that was already made. Removing
  access from a running deployment is the breaking direction. The preflight
  reports unmanaged tables that `rebase_user` can reach, with the `REVOKE` to
  run, and leaves the decision to the operator.
- A managed table the connection cannot grant on fails with an error that
  names that table, not the whole schema.
- `appRoleSetupInstructions` prints per-table grants for managed tables.

### Compatibility impact

Existing databases are unchanged, since nothing is revoked. On new databases,
a hand-made table read through user-context SQL needs an explicit grant. That
goes in the release notes and in the custom-functions doc, which already shows
`GRANT … TO rebase_user`.

---

## Issue 3: `TO public` defaults

### Options

**3A. Point permissive policies at the request role.** When a rule has no
`pgRoles`, the compiler emits `TO <request role>` instead of `TO public`. When
the connection is subject to RLS natively and does not switch roles, the
target is the connection role. Restrictive policies (the admin write gate and
the tenancy gate) **stay `TO public`**. A restrictive policy can only remove
access, so applying it to everyone is the safe direction.
- For: a foreign role with a grant gets nothing from Rebase's permissive
  policies, so finding 3 closes. The server context is unaffected, because the
  owner bypasses non-FORCE RLS.
- Against: a foreign role that reads Rebase tables today through `TO public`
  (an analytics reader, a PostgREST role) starts seeing 0 rows. This is the
  intended fix, but it is a behaviour change.

**3B. Drop the `rebase.uid() IS NULL` server arm.**
- Not possible everywhere. When the connection is subject to RLS natively, or
  when `REBASE_PROVISION=false` leaves it unswitched, that arm is how the
  server context reads.

**3C. Replace the arm with an explicit marker** such as `app.server = 'on'`.
- No better. Any session can set any custom GUC.

**3D. Leave it, document grant hygiene, and rely on rls-check.**
- Finds the problem after the leak instead of preventing it.

### Recommendation

3A. Two details decide whether it is safe to ship:

- **The change happens in the compiler, not on the rule.** Policy names hash
  `rule.pgRoles` (`packages/utils/src/policy-names.ts:28`). Writing
  `pgRoles: [requestRole]` onto the rule would rename every policy in every
  deployed database. Changing only the emitted `TO` list keeps every name.
  `ensure-collection-policies` then has to compare the role list as well as
  the expressions, and issue `ALTER POLICY … TO` in place, once. Check
  whether it compares roles today before building this.
- **The way back is explicit.** `pgRoles: ["public"]` on a rule restores
  today's behaviour for that rule, under a new hashed name. That is the
  documented route for a project that really wants a foreign role to pass.
  Junction-derived policies follow the same rule.

### Compatibility impact

One `ALTER POLICY` per permissive policy on the first boot after upgrade, and
one policy-only diff in the next `rebase db generate`. That diff needs checking
against Atlas before release: confirm it plans `ALTER POLICY`, not drop and
recreate. Rebase's own requests and the server context see no change. Foreign
roles that were silently relying on `TO public` lose access, so release notes
must name the change.

---

## Issue 4: existing role-based RLS

### Options

**4A. Fix the check (a bug fix, needed whatever else is chosen).**
`validatePolicyPgRoles` should test `pg_has_role(request_role, role, 'USAGE')`,
which is the test the policy machinery actually applies, not `'MEMBER'`. Its
hint should give the grant that works.

**4B. A documented mapping for existing roles (PostgreSQL 16 and newer).**
Since PG 16, inheritance is set per grant:
`GRANT authenticated TO rebase_user WITH INHERIT TRUE` makes `TO authenticated`
policies apply to the request role, while the role itself stays `NOINHERIT`
for every other membership. This could be a setting
(`REBASE_REQUEST_ROLE_INHERITS=authenticated`) that Rebase grants and checks,
or a documented statement the preflight verifies.
- Against: on PG 15 and older the only lever is the role-level `INHERIT`
  attribute, which opens every membership. There the mapping should be
  refused, not degraded.

**4C. Bridge the claims too.** Roles alone do not make Supabase policies
correct. They read `auth.uid()`, which reads `request.jwt.claims`, and Rebase
never sets it. So a request that passes `TO authenticated` would then fail, or
worse, wrongly pass, every `auth.uid() = owner_id` test. A bridge would set
`request.jwt.claims` (and `request.jwt.claim.sub`) from the same values as
`app.jwt`.
- For: an existing Supabase schema's policies work unchanged.
- Against: Rebase would be committing to another platform's GUC contract, and
  those GUCs are also how PostgREST decides identity. Setting them on a shared
  database is its own trust question.

**4D. Import, don't map.** The Studio RLS editor already shows database-only
policies. Offer to convert `TO authenticated` / `auth.uid()` policies into
`securityRules`, which then compile to Rebase's own helpers.

### Recommendation

4A now. 4B as a documented, preflight-checked mapping on PG 16 and newer.
4D as the long-term path. 4C only as an explicit opt-in, and only if a real
adopter needs it; it is one of the decisions below.

### Compatibility impact

4A turns a silent "0 rows" into a boot error for projects whose `pgRoles` name
a role the request role is a member of but does not inherit. Those
collections read as empty today, so they are already broken. The error makes
that visible. 4B and 4D are additive.

---

## Issue 5: no preflight

### Options

**5A. `rebase doctor --database`.** Read-only catalogue queries against
`DATABASE_URL`. It reports, and prints the exact SQL to run as an
administrator:
- whether the request role exists, with its attributes;
- whether the connection role is a member and holds `SET` (the PG 16 trap; the
  fix itself is the separate task);
- other login roles that can become the request role (issue 1);
- whether PUBLIC holds `CONNECT` on this database (1E);
- the schemas Rebase will write to, whether the connection owns them, and
  which tables in them it does not manage (issue 2);
- foreign roles with grants on managed tables (issue 3);
- policies `TO` roles the request role does not inherit (issue 4);
- default privileges that will hand new tables to `anon`/`authenticated`
  (the Supabase shape).

**5B. `rebase db provision --print`.** Writes the SQL a provisioning boot
would run, without running it. `REBASE_PROVISION_SQL_OUT` already records it
(`packages/server-postgres/src/security/rls-enforcement.ts`,
`verify-auth-tables.ts`). This exposes that recorder as a dry run, so a DBA
can review the SQL and apply it themselves.

**5C. A provider table in the docs.** For each provider: what the connection
role usually is, whether it can `CREATEROLE`, the PG 16 `SET` caveat, and
whether roles are shared between databases.

| Provider | Usual connection role | Notes to verify per provider before publishing |
|---|---|---|
| Supabase | `postgres` (not a superuser, has CREATEROLE) | One database per project. `anon`/`authenticated`/`authenticator` already exist, with default privileges in `public` (see the unverified note above). Issues 3 and 4 apply directly. |
| Neon | the project owner, member of `neon_superuser` | Roles belong to a branch, and every database on a branch shares them. Two Rebase databases in one Neon project share `rebase_user`, so issue 1 applies. |
| AWS RDS / Aurora | master user, member of `rds_superuser` | CREATEROLE, not a superuser, so the PG 16 `SET` trap applies. Instances are often shared between apps. |
| Google Cloud SQL | `postgres`, member of `cloudsqlsuperuser` | As RDS. |
| Azure Flexible Server | admin, member of `azure_pg_admin` | As RDS. |
| InstaPods | `instapod`; superuser via `sudo -u postgres` | The repo guide already pre-creates the role (`deployment/instapods.md`). |
| Hostman | `gen_user`; CREATE ROLE granted from the panel | Not available on the smallest tier. The guide pre-creates the role with `WITH SET TRUE` (`deployment/hostman.md`). |

### Recommendation

All three. 5A carries the work. It also gives issues 1 to 4 their "tell the
operator" half, so none of them needs to start by refusing to boot.

### Compatibility impact

None. Read-only and additive.

---

## Phased plan

Each phase ships on its own, and none depends on a later one.

| Phase | What | Compatibility | Rough size |
|---|---|---|---|
| **0. Bug fixes** | `validatePolicyPgRoles` uses `USAGE`, and its hint says `WITH INHERIT TRUE` (4A). `readSchemaGrants` counts managed tables only, so the grant settles and stops re-running every boot (first half of 2A). Per-table error naming the managed table it cannot grant on. | 4A surfaces collections that are already empty as a boot error. Nothing else changes. | Small |
| **1. Detect and tell** | `rebase doctor --database` (5A). `rebase db provision --print` (5B). Boot warning when another login can become the request role (1C, warning only). Provider table and an "existing database" page in the docs (5C). Re-check the Supabase default-privileges hypothesis on a live project. | None | Medium |
| **2. Configurable name** | `REBASE_REQUEST_ROLE`, default `rebase_user`, recorded in `schema_meta`; a mismatch refuses to boot. Every hardcoded site reads the driver's resolved name. `rebase db request-role migrate`. Refuse to boot when a *non-default* role has other members. Deprecate the `REBASE_USER_ROLE` export. rls-check gains `--request-role`. | None for the default. | Medium-large (~15 files plus CLI) |
| **3. Behaviour changes** (one minor release, with notes) | Permissive policies `TO <request role>` (3A). Per-table grants on new databases, no default privileges in `public` (2A). | Foreign roles relying on `TO public` lose access. Hand-made tables on new databases need an explicit grant. Nothing is revoked on existing databases. | Medium |
| **4. Interop (only on demand)** | PG 16+ inheritance mapping as a setting (4B). Supabase claims bridge, opt-in (4C). Policy import in the Studio (4D). | Additive | Per item |

Out of scope here, and covered by the separate fix task: the PG 16+ CREATEROLE
`SET` membership bug, redacting the setup SQL from logs, and adopting an
existing `rebase_user` without checking its attributes.

## Decisions for Francesco

1. **Default name.** Keep `rebase_user` as the default (recommended, since
   docs and user migrations say it), or derive a per-database default for
   *new* projects only (1B)?
2. **Refusing to boot.** Is "warn for the default name, refuse for a dedicated
   name" the right line? Or should a shared default `rebase_user` with foreign
   members also refuse in production, accepting that this breaks shared
   clusters that work today?
3. **Phase 3 as a minor release.** Is pointing permissive policies at the
   request role (3A) acceptable in a 0.x minor release with release notes, or
   does it wait for a major?
4. **Grant scope escape hatch.** Should per-table grants (2A) have an env
   switch back to schema-wide grants for projects that want them, or is an
   explicit `GRANT` the only route?
5. **Supabase interop.** Is setting Supabase's `request.jwt.claims` (4C) in
   scope at all, or is Rebase's position "import your policies into
   `securityRules`" (4D)?
6. **Env var name.** `REBASE_REQUEST_ROLE`, or something matching another
   existing prefix?
