# The request role on existing and shared databases

**Status:** built, 2026-11-09 (unreleased): Phases 0–4. Where the build departs from this text, the
notes under "As built" at the end say so.
**Direction (Francesco, 2026-11-09):** keep today's behaviour as the default,
and give every opinion Rebase has about the database security model an escape
hatch, so Rebase can fit whatever role, grant and RLS model a database already
has. Every behaviour change below is therefore opt-in.
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
exactly those databases. Five things go wrong there (see [Findings](#findings)).
The worst is that two Rebase projects on one cluster can read and write each
other's data as each other's admins.

The plan:

1. **Fix two bugs.** The `pgRoles` check uses the wrong membership test, and
   the grant check never settles on a shared schema.
2. **Detect and explain.** Add a read-only database preflight to
   `rebase doctor`, and boot warnings when other logins can switch into the
   request role.
3. **Add one settings block, `rls`, on the Postgres driver.** Each setting
   defaults to what Rebase does today, and each choice Rebase makes about
   roles, grants, policy targets and request identity becomes a value you can
   change. That covers the role name, whether Rebase creates the role at all,
   how it grants, whom default policies target, which session variables carry
   the identity, and a per-request role for Supabase- or PostgREST-style
   databases.

None of this changes anything for an existing deployment that sets nothing.

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
  `app.uid` empty.

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

Not yet verified, and worth checking against a live Supabase project:
Supabase's stock default privileges grant tables created in `public` to `anon`
and `authenticated`. If they still do, finding 3 combines with them. Every
Rebase collection table created on a Supabase database would then be readable
in full through Supabase's own Data API by an anonymous caller, because
PostgREST never sets `app.uid`. `packages/rls-check` already lists
`anon`/`authenticated`/`web_anon` as exposed roles
(`packages/rls-check/src/introspect.ts:198`), so it would flag the result, but
only after the fact.

## Constraints any fix has to respect

- **Shipped names are frozen** (contract 6 in `docs/compatibility.md`, and
  `pnpm check:derived-names`). `rebase_user` appears in users' own migrations:
  the docs tell them to write `GRANT … TO rebase_user` for functions, scripts
  and deployment setup (`website/.../backend/custom-functions.md`,
  `deployment/instapods.md`, `deployment/hostman.md`, among others). It also
  appears in the exported `REBASE_USER_ROLE`
  (`packages/server-postgres/src/index.ts:80`). The default cannot change, and
  the export has to be deprecated before it is removed.
- **No upgrade may break an existing database.** Every new behaviour is opt-in.
  A new check that would refuse to boot a deployment that works today is a
  breaking change, however correct it is.
- **Where a fact lives.** The test is whether the value differs between two
  deployments of the same commit. The role name does: staging and production
  of one project can share a cluster. So it must be settable from the
  environment. The other settings describe the shape of the project, so they
  belong in code, with an environment override for operators.
- **The role is referenced in about 15 source files** across server-postgres,
  server (the API key, cron and job stores revoke from it), cli, studio (RLS
  presets) and rls-check. `driver.rlsUserRole` and `applyAuthContext(…, userRole)`
  already carry the name at runtime. The constant is the problem, not the
  plumbing.

---

## The escape hatches

### Rules every setting follows

1. **The default is today's behaviour.** A project that sets nothing gets
   exactly what 0.29.0 does, apart from the two bug fixes in Phase 0.
2. **One place.** All settings live in one `rls` block on
   `PostgresDriverConfig`, next to `realtime` and `readRouting`, so there is
   one thing to read to know a project's security model. Settings are per data
   source, like every other driver setting.
3. **The environment can override code** for settings an operator may need to
   change per deployment, as `REALTIME_*` already does
   (`postgresDriverConfigFromEnv`, `PostgresBootstrapper.ts:587`).
   Function-valued settings are code only.
4. **A non-default choice says what it gives up.** At boot, the one line that
   reports how requests are isolated also lists every non-default setting.
   A setting that hands a safety job to the operator logs once, at info, which
   job that is. For example, `grants: "none"` means "Rebase grants nothing;
   requests to a table you have not granted will be refused".
5. **`rebase doctor --database` reports the effective settings** and checks
   the database against them, not against the defaults.
6. **No setting can disable the role switch while the connection bypasses
   RLS.** That stays fatal, as it is today. Without the switch, every user
   request would run with no policy applied. A hatch that allowed it would not
   adapt Rebase to another model. It would turn security off.

### The settings

```ts
postgresDriver({
  rls: {
    requestRole: "rebase_user",       // string | { anonymous, signedIn } | (auth) => string
    requestRoles: undefined,          // every role a function-valued requestRole can return
    provisionRole: "auto",            // "auto" | "never"
    grants: "schema",                 // "schema" | "managed" | "none"
    policyTarget: "public",           // "public" | "requestRole"
    defaultPolicies: true,            // false = disableDefaultPolicies on every collection
    inheritRoles: [],                 // e.g. ["authenticated"]; PG 16+
    identity: "rebase",               // "rebase" | "supabase" | (auth) => [name, value][]
    sharedRole: "warn",               // "warn" | "refuse" | "ignore"
  }
})
```

| Setting | Env override | Default (today) | Alternatives | Fixes | For |
|---|---|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (string form) | `"rebase_user"` | Any role name. A map `{ anonymous, signedIn }`, or a function of the auth context, for a per-request role. | 1, 4 | Shared clusters. Staging and production on one cluster. Supabase/PostgREST-style `anon`/`authenticated` roles. |
| `requestRoles` | none | derived from `requestRole` | The full list of roles a function can return, so provisioning, grants and the preflight know every one | 1, 4 | Function-valued `requestRole` |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: create the role if missing, grant membership | `"never"`: the role and membership are the operator's; boot checks and reports, never creates | 1, 5 | Locked-down DBAs. Providers without CREATEROLE. Roles managed in Terraform. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: schema-wide grants plus default privileges | `"managed"`: only tables Rebase manages, granted where they are created. `"none"`: Rebase grants nothing. | 2 | Shared `public` schema. Grants managed outside Rebase. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: permissive policies apply only to the request role(s) | 3 | Tables other roles also read. Supabase Data API. |
| `defaultPolicies` | none | `true` | `false`: no injected baseline anywhere. The per-collection `disableDefaultPolicies` still works and wins. | 3 | Projects that bring their whole RLS model |
| `inheritRoles` | none | `[]` | Roles granted to the request role `WITH INHERIT TRUE`, so policies `TO` them apply. Refused on PG 15 and older. | 4 | Existing `TO authenticated` policies |
| `identity` | `REBASE_RLS_IDENTITY` (named forms) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: also `request.jwt.claims` and `request.jwt.claim.sub`, so `auth.uid()` works. A function: any extra settings. The `app.*` settings are always set, because Rebase's own policies read them. | 4 | Existing policies written against another platform's helpers |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` when another login can become the request role | `"refuse"`: fail boot. `"ignore"`: say nothing (logged once as a non-default). | 1 | Strict production. Deliberately shared roles. |

Two settings need care in how they are built.

**`policyTarget: "requestRole"` must not put a deployment's role name into the
migrations.** Policies also land in generated migration files. If they said
`TO acme_prod_user`, staging and production of the same commit would need
different migrations. Instead, keep `TO public` and have the compiler add a
predicate, `rebase.is_request_role()`. It is `STABLE`, wrapped as
`(SELECT …)` so it is evaluated once per statement, and it compares
`current_user` with the role or roles recorded in `rebase.schema_meta`. The
policy text is then the same in every deployment, and foreign roles fail the
policy. The predicate is added by the compiler, not on the rule, because
policy names hash `rule.pgRoles` and the rule's semantics
(`packages/utils/src/policy-names.ts:28`), so names stay as they are. Restrictive
policies (the admin write gate and the tenancy gate) get no predicate: they
can only remove access, so applying them to everyone is the safe direction.

**A per-request role needs every possible role declared.** With a map or a
function, Rebase must know the full set (`requestRoles`) to provision
membership, grant, record the roles in `schema_meta`, and preflight each one.
A function that returns a role not in that set fails the request closed, with
a message naming the role. The service identity used by `rebase.dataAsAdmin`
(`uid: "service"`) resolves through the same function, so a project decides
what role its server-side code runs as.

---

## Issue 1: the shared role name

**Options considered.**
- **A configurable name** (chosen).
- **A name derived per database.** Rejected. A derived identifier is frozen
  the moment it ships. A renamed or restored database, or a `_dev_diff`
  scratch copy, would derive a different role and lose every grant. Long names
  hit the 63-byte limit.
- **Detection only.** Two projects on one cluster both need membership, so
  detection alone cannot fix it.
- **A signed request context.** Rejected. It costs a signature check per row,
  and the real boundary is who can become the role, which membership already
  expresses.
- **Revoking `CONNECT` from PUBLIC.** Operator hardening that the preflight
  recommends. Rebase does not run it on a database it does not own.

**What gets built.**
- `requestRole`, defaulting to `rebase_user`.
- On the first provisioning boot, the name (or names) is stored in
  `rebase.schema_meta`. A later boot configured with a different name refuses,
  and names the migration command. Without that check, the old role would keep
  its grants while a second role was provisioned.
- `sharedRole` (default `"warn"`) decides what happens when another login role
  can switch into the request role. `pg_auth_members` is a shared catalogue,
  so any database can read it.
- `rebase db request-role migrate --to <name>` creates the new role, re-issues
  in this database only every grant the old one holds, records the new name,
  and leaves the old role alone. `ALTER ROLE … RENAME` is offered only when
  the preflight shows no other database uses the role, because a rename moves
  every database's grants on the cluster.

**Compatibility.** None by default. The exported `REBASE_USER_ROLE` stays,
deprecated in favour of reading the resolved name from the driver. rls-check
gains `--request-role` and reads `schema_meta` when it can. Its hardcoded
`rebase_user` (`packages/rls-check/src/checks/anonymous-write-allowed.ts:142`)
stays the fallback.

## Issue 2: blanket grants

**Options considered.**
- **Per managed table** (built as `grants: "managed"`).
- **A schema-wide or per-table switch chosen by catalogue detection.**
  Rejected: one stray table would flip behaviour the operator never chose.
- **Per owned table.** Rejected: it still grants every unmanaged table the
  connection owns.
- **Own schema for collections.** Already possible through `schema`. The docs
  recommend it for existing databases.
- **Grant nothing** (built as `grants: "none"`).

**What gets built.**
- Phase 0 bug fix, every mode (built): the grant step and its readiness check
  cover only the tables, sequences and schemas the connection may grant on.
  That means the ones it owns (directly or by inheriting the owner), or holds
  every needed privilege on `WITH GRANT OPTION`. Grants are issued by name, not
  `ON ALL … IN SCHEMA`, so the check settles instead of re-granting every boot,
  and another application's table can no longer fail the boot. A collection
  table the connection cannot grant on gets a boot **warning** naming the
  table, its owner and the grant to run, not an error. Requests to it fail
  closed, and an introspected project serves every table in its schema,
  whoever owns it.
- `"managed"`: grants per table, issued at boot and by
  `migration-post-process.ts`. No default privileges in shared schemas.
  Nothing already granted is revoked. The preflight lists unmanaged tables the
  role can reach, with the `REVOKE` to run.
- `"none"`: no grants, no default privileges, and no revoke sweep of Rebase's
  internal tables (the operator owns those too). The preflight lists what the
  role is missing. Boot still warns when the role can reach an internal table
  such as refresh tokens or API keys, using the existing
  `findExposedInternalTables` (`rls-enforcement.ts:391`).
- `appRoleSetupInstructions` prints SQL that matches the mode.

**Compatibility.** None. `"schema"` stays the default.

## Issue 3: `TO public` defaults

**Options considered.**
- **Restrict permissive policies to the request role** (built as
  `policyTarget: "requestRole"`, via the predicate above).
- **Drop the `IS NULL` server arm.** Not possible: it is how the server context
  reads when the connection is subject to RLS natively, or unswitched under
  `REBASE_PROVISION=false`.
- **An explicit server marker GUC.** No better, because any session can set
  any custom GUC.
- **Rely on rls-check.** That finds the leak after it has happened.

**What gets built.** `policyTarget` and `defaultPolicies` as above. A rule
with `pgRoles` set keeps exactly the `TO` list it names, in every mode.

**Compatibility.** None by default. Switching a project to `"requestRole"`
rewrites each permissive policy once, through `ensure-collection-policies`
and in the next `rebase db generate`. Before building, check that Atlas plans
this as an in-place change rather than a drop and recreate. Foreign roles that
were reading through `TO public` stop seeing rows in that project, which is
the point.

## Issue 4: existing role-based RLS

**What gets built.**
- **Phase 0 bug fix:** `validatePolicyPgRoles` tests
  `pg_has_role(request_role, role, 'USAGE')`, which is the test the policy
  machinery applies, and its hint gives the grant that works
  (`WITH INHERIT TRUE`, or `inheritRoles`). This turns "the collection reads
  as empty" into a boot error. Those collections are already broken, so the
  error only makes it visible.
- `inheritRoles` for policies written `TO authenticated` and similar. On PG 15
  and older the only lever is the role-level `INHERIT` attribute, which would
  open every membership, so the setting is refused there rather than degraded.
- `identity: "supabase"` for policies that read `auth.uid()`. Roles alone do
  not make those policies correct: without `request.jwt.claims`, every
  `auth.uid() = owner_id` test fails, or wrongly passes.
- A per-request `requestRole` (`{ anonymous: "anon", signedIn: "authenticated" }`)
  for databases whose policies already distinguish those two roles. Together
  with `identity: "supabase"`, an existing Supabase schema's policies apply to
  Rebase requests unchanged.
- Longer term: the Studio RLS editor offers to convert database-only policies
  into `securityRules`, for projects that would rather move to Rebase's model
  than map onto theirs.

**Compatibility.** The bug fix is described above. Everything else is
additive.

## Issue 5: no preflight

**What gets built.**
- **`rebase doctor --database`.** Read-only catalogue queries against
  `DATABASE_URL`. It reads the effective `rls` settings and reports, with the
  exact SQL to run as an administrator:
  - whether each request role exists, with its attributes;
  - whether the connection role is a member and holds `SET` (the PG 16 trap;
    the fix itself is the separate task);
  - other login roles that can become a request role;
  - whether PUBLIC holds `CONNECT` on this database;
  - the schemas Rebase will write to, and the unmanaged tables in them;
  - foreign roles with grants on managed tables;
  - policies `TO` roles the request role does not inherit;
  - default privileges that hand new tables to `anon`/`authenticated`;
  - for each finding, the setting that would adapt Rebase to it. For example,
    "`public` holds 40 tables Rebase does not manage: consider
    `grants: "managed"`".
- **`rebase db provision --print`.** Exposes the `REBASE_PROVISION_SQL_OUT`
  recorder as a dry run, so a DBA can review the SQL and apply it themselves.
- **A provider table in the docs:**

| Provider | Usual connection role | Notes to verify per provider before publishing |
|---|---|---|
| Supabase | `postgres` (not a superuser, has CREATEROLE) | One database per project. `anon`/`authenticated`/`authenticator` exist, with default privileges in `public` (see the unverified note above). Suggested settings: `requestRole` map, `identity: "supabase"`, `policyTarget: "requestRole"`. |
| Neon | the project owner, member of `neon_superuser` | Roles belong to a branch, and every database on a branch shares them. Two Rebase databases in one Neon project share `rebase_user`, so set `requestRole` per database. |
| AWS RDS / Aurora | master user, member of `rds_superuser` | CREATEROLE, not a superuser, so the PG 16 `SET` trap applies. Instances are often shared between apps. |
| Google Cloud SQL | `postgres`, member of `cloudsqlsuperuser` | As RDS. |
| Azure Flexible Server | admin, member of `azure_pg_admin` | As RDS. |
| InstaPods | `instapod`; superuser via `sudo -u postgres` | The repo guide already pre-creates the role (`deployment/instapods.md`). |
| Hostman | `gen_user`; CREATE ROLE granted from the panel | Not available on the smallest tier. The guide pre-creates the role with `WITH SET TRUE` (`deployment/hostman.md`). |

**Compatibility.** None. Read-only and additive.

---

## Phased plan

Each phase ships on its own. None of them changes behaviour for a project
that sets nothing, apart from the Phase 0 boot error for collections that
already read as empty.

| Phase | What | Rough size |
|---|---|---|
| **0. Bug fixes (built, unreleased)** | `validatePolicyPgRoles` checks `USAGE`, and its hint names `WITH INHERIT TRUE` (or says plainly that PG 15 and older cannot do it). Grants go by name, only on what the connection may grant on, so the step settles on a shared schema and can no longer fail the boot. Boot warning for a collection table the connection cannot grant on. | Small |
| **1. Detect and tell** | `rebase doctor --database`. `rebase db provision --print`. Boot warning for a request role other logins can become. Provider table and an "existing database" docs page. Re-check the Supabase default-privileges hypothesis on a live project. | Medium |
| **2. The `rls` block and the role name** | The `rls` config block, its env overrides, and the boot line listing non-default settings. `requestRole` as a string, `provisionRole`, `sharedRole`. Recording the name in `schema_meta`, with refusal on mismatch. Every hardcoded site reads the driver's resolved name. `rebase db request-role migrate`. Deprecate the `REBASE_USER_ROLE` export. rls-check `--request-role`. | Medium-large (~15 files plus CLI) |
| **3. Grants and policy hatches** | `grants: "managed" \| "none"`. `policyTarget: "requestRole"` with `rebase.is_request_role()`. Global `defaultPolicies`. | Medium |
| **4. Other models** | `inheritRoles`. `identity: "supabase"` and function form. `requestRole` as a map or function, with `requestRoles`. Studio policy import. Worth building against one real Supabase database as the acceptance test. | Medium |

Out of scope here, and covered by the separate fix task: the PG 16+ CREATEROLE
`SET` membership bug, redacting the setup SQL from logs, and adopting an
existing `rebase_user` without checking its attributes.

## Still open

These are small enough to settle while building:

1. **Naming.** `rls` for the block and `REBASE_RLS_*` for the variables, or
   something else?
2. **Function-valued settings.** `requestRole` and `identity` as functions
   make Rebase fit almost anything, but `rebase doctor` and rls-check cannot
   read a function. The proposal keeps both data forms and functions, and
   requires `requestRoles` alongside a function. Is that enough, or should
   functions wait until a real adopter needs one?

## As built (2026-11-09)

Phases 0–4 are on `main`, unreleased. Where the build departs from the text above:

- **Where the settings live.** The `rls` block is a `database({ rls })` option
  (added to the kind by amendment, never to its shipped literal), as well as a
  Postgres driver option. Precedence: declaration, then driver, then
  `REBASE_RLS_*`. `policyTarget` and `defaultPolicies` must come from the
  declaration or the environment. They change the SQL `rebase db generate`
  writes, and the CLI cannot see the driver's code, so a code-only value fails
  the boot with that explanation.
- **Recorded roles.** `rebase.schema_meta` key `request_roles`. Every internal
  revoke and `GRANT EXECUTE` in `@rebasepro/common` loops over it, with
  `rebase_user` as the fallback, so the stores need no role passed in. A fresh
  database takes a new role without a migration. Only a database where
  `rebase_user` already holds grants refuses a different one.
- **The request-role predicate** is `(SELECT rebase.is_request_role(current_user::text))`,
  a `SECURITY DEFINER` PL/pgSQL function created only for projects that opt
  in. `current_user` is an argument because inside the function it would be
  the owner.
- **`policyTarget: "requestRole"` needs the role switch.** A connection that
  is subject to RLS natively runs requests as itself, which is not a request
  role, so the boot refuses that combination.
- **`adminPolicies` (added 2026-11-09, after the phases above).** Not in the
  plan: a plan check in `data-plane-budget-e2e` found that the baseline's `TO
  public` ORs `(InitPlan)` into every signed-in user's read, which stops an
  owner-scoped list or count from using the owner index (78 ms against 2.8 ms
  at 1M rows). Policies whose every clause needs the server context or the
  `admin` role (`requiresServerOrAdmin` in `compileRulePolicies.ts`) are now
  written `TO rebase_admin`, a fixed, privilege-less NOLOGIN role, so the
  migration text stays the same in every deployment. Admin requests switch to
  `<request role>_admin` (`adminRequestRoleFor`), which inherits the request
  role and `rebase_admin`; the switch is decided from the same comma-joined
  `app.user_roles` the policies split. It is per request role, not the shared
  `rebase_admin`, for the reason in Issue 1. The connection inherits
  `rebase_admin` for the server context on tables it does not own.
  Restrictive policies and rules with their own `pgRoles` are never moved. A
  database where the role cannot be created (a connection without
  CREATEROLE, as on Rebase Cloud tenants today) keeps those policies `TO
  public` at boot and on `db push`, and admins stay on the request role;
  a migration file carries the `CREATE ROLE` itself and fails there with a
  hint naming `adminPolicies: "public"`. Rules that OR an owner test with a
  non-admin role still carry the arm.
- **Not done:** the Studio RLS editor still offers `rebase_user` as its
  fallback role option, and `REBASE_USER_ROLE` was not marked deprecated. It
  is still the correct name of the default.
