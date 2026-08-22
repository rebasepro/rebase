---
slug: docs/rls-check
title: rls-check
description: Audit row-level security on any PostgreSQL database — Supabase, Neon, RDS, or your own server. Read-only, no signup, no Rebase required.
---

# rls-check

`rls-check` reads a PostgreSQL database's catalog and reports what is actually exposed:
tables served with row-level security switched off, policies that evaluate to true for
everyone, views that read straight past the RLS on their base tables, and join tables
that were forgotten while both of their endpoints were locked down.

It works on **any** Postgres — Supabase, Neon, RDS, Cloud SQL, or a server you run
yourself. It does not require Rebase, and it is useful whether or not you ever adopt it.

```bash
npx @rebasepro/rls-check $DATABASE_URL
```

It is read-only by construction: it opens a read-only transaction and issues catalog
queries. It writes nothing, and it sends nothing anywhere — there is no telemetry and no
network call other than the one to your database.

## Running it

```bash
# Explicit connection string
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"

# Or from the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check
```

If your password contains `@`, `:`, `/`, `?` or `#`, percent-encode it. That is by far the
most common cause of an authentication failure here, and `rls-check` will say so rather
than letting you guess.

### Options

| Option | Meaning |
| --- | --- |
| `--json` | Machine-readable output on stdout, and nothing else on stdout |
| `--schema <name>` | Restrict the scan to a schema. Repeatable, or comma-separated |
| `--fail-on <severity>` | Exit 1 at or above this severity. Default `high`; `none` never fails |
| `--only <id>` | Run only these checks. Repeatable, or comma-separated |
| `--skip <id>` | Skip these checks. Repeatable, or comma-separated |
| `--list-checks` | Print the catalog and exit |
| `--timeout <ms>` | Statement timeout, default 15000 |
| `--quiet` | Findings only — no banner, no summary |
| `--no-color` | Disable ANSI colour (also honours `NO_COLOR` and a non-TTY stdout) |

An unknown id passed to `--only` or `--skip` is an error rather than a silent no-op, because
a typo there quietly weakens the scan.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No findings at or above the `--fail-on` threshold |
| `1` | At least one finding at or above the threshold |
| `2` | The scan could not run — bad arguments, connection refused, auth failure, timeout |

`1` and `2` are deliberately distinct: a broken connection must never look like a clean
database.

### In CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check "$DATABASE_URL" --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### JSON output

`--json` emits a stable object: `scannedAt`, `database` (host and name only — never
credentials), `serverVersion`, `platform`, `scannerIsPrivileged`, `stats`, and `findings`.
Each finding carries `id`, `severity`, `title`, `target`, `detail`, `impact`, `fix`,
`docs` and `confidence`.

## Running it on a schedule

A check you have to remember to run is a check that reports a clean database
right up until the day it matters. The backend can run this one for you and
serve the result to the admin panel:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // the default
    warnAtSeverity: "high"            // the default
};
```

Pass that as `rlsAudit` in the object you hand `initializeRebaseBackend`.

The result is served at `GET /api/admin/rls-audit`, admin-gated like every other
admin surface, and each run logs one line — at `warn` when a finding reaches
`warnAtSeverity`, at `info` otherwise:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit.
```

### Why you pass `scan` in

`@rebasepro/server` has no database driver — that is what keeps it usable with
Postgres, Mongo and Firebase alike. `@rebasepro/rls-check` carries `pg`, because
it connects to Postgres. Importing it inside the server package would put a
Postgres driver in every install, for a feature only some of them can use, so
you hand the function in instead.

### In a split deployment

The audit is an *owned* singleton, like the cron scheduler. Every process that
owns it runs its own scan, which is read-only and harmless but redundant — give
it to one process:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

A process that serves the admin surface without owning the scan answers the
endpoint honestly, saying the scan does not run there.

### It is a safety net, not a monitor

The default interval is a day, because the thing being watched is a schema:
it changes on deploys, not on traffic. A failed scan is logged and recorded in
the status — never thrown. Turning a security check into a new way for the
server to fall over would be a bad trade in both directions.

## How to read the report

**Confirmed findings come first; heuristic ones are in a separate "worth checking"
section.** A heuristic check cannot see intent — a junction table you deliberately left
open is not a bug — so those are phrased as questions and never mixed in with the
certainties.

**Watch for the privilege note.** If the scan connects as a superuser, a table owner, or a
role with `BYPASSRLS`, it says so. That role sees the true catalog, which is what makes the
audit possible, but it also means nothing in the report describes what *that* connection
experiences. The findings are about what other roles get.

## The checks

Severities below are the defaults; several checks adjust their own severity based on what
they find, and the report always states the reason.

### rls-disabled

**Table exposed without row-level security.** Critical.

The table has RLS disabled *and* grants `SELECT`/`INSERT`/`UPDATE`/`DELETE` to a role an
untrusted caller can reach (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres applies
no per-row filter at all, so policies — if any exist — are never consulted.

A table with RLS off but no grant to an exposed role is *not* reported. It is not reachable,
and flagging it would be noise.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Enabling RLS with no policies denies every row to everyone but the owner, so add the policy
you intend in the same migration — otherwise you have traded an exposure for a silent
outage. See [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**Policy grants unconditional access.** Critical.

A permissive policy whose `USING` or `WITH CHECK` expression is a constant truth — `true`,
`(true)`, `1 = 1`. Permissive policies are ORed together, so a single one of these satisfies
the table's row filter no matter how strict every other policy is.

If a `RESTRICTIVE` policy covers the same command, this is downgraded to medium and
reported as something to verify rather than a certainty, because restrictive policies AND
after the permissive ones OR.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

### policy-anonymous-tautology

**Policy only checks that a caller id exists.** Severity depends on the platform.

The expression is `rebase.uid() IS NOT NULL`-shaped (or `auth.uid()` on Supabase, and on a
Rebase database provisioned before 1.0): it separates signed-in from signed-out callers, but
scopes no rows. Every signed-in user reaches every row the policy covers.

The severity is platform-dependent, and this distinction matters:

- **On Supabase**, `auth.uid()` returns `NULL` for anonymous callers, so this is a working
  authenticated-only check. Reported as **low** — a data-scoping gap between signed-in
  users, not an anonymous-access hole.
- **On Rebase or PostgREST**, where a blank caller id is coerced to an `'anonymous'`
  sentinel, the expression is *true for signed-out callers too*. Reported as **critical**.
- **On an unrecognised platform**, reported as **medium**, since whether it is a hole
  depends on whether your stack uses such a sentinel.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

The suggested SQL is printed with the caller-id function your database actually has:
`rebase.uid()` on a Rebase database, `auth.uid()` on Supabase and PostgREST. Both
spellings are recognised when reading policies, so a Rebase database mid-migration from
the pre-1.0 `auth` schema is still checked.

### view-bypasses-rls

**View reads past its base table's RLS.** Critical.

A view granted to an untrusted role that selects from an RLS-protected table without
`security_invoker = true`. The view runs with its **owner's** privileges, so it reads the
base table as the owner and the caller's policies never apply. This is the most common way
a carefully locked-down table leaks.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

On PostgreSQL below 15 the option does not exist at all, so every such view behaves this
way. There the finding is reported as heuristic, and the fix is to move the logic into a
function or upgrade.

### matview-bypasses-rls

**Materialized view exposes RLS-protected data.** High.

Materialized views cannot have row-level security, and the data in them is a stored
snapshot taken by whoever refreshed it. If one is granted to an untrusted role and its
defining query reads an RLS-protected table, no policy can help — revoke the grant, or move
the matview into a schema that untrusted roles cannot reach.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Unauthenticated callers can write.** High.

A permissive `INSERT`/`UPDATE`/`DELETE`/`ALL` policy reachable without authentication whose
check expression accepts any row, backed by a matching grant.

The "accepts any row" condition is essential and deliberately narrow. Supabase grants `anon`
and `authenticated` full DML by default, so a policy targeting those roles is not by itself
a problem — a textbook `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` is correct
and is not reported.

### unqualified-column-in-subquery

**Unqualified column inside a policy subquery.** High, heuristic.

A bare column name inside an `EXISTS`/`IN` subquery that exists on *both* the inner relation
and the policy's own table. Postgres binds it to the **inner** table, so the correlation to
the outer row you meant to write silently disappears and the predicate becomes trivially
satisfiable — or trivially unsatisfiable, denying every row to everyone.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**An absence of this finding is not proof of safety.** `pg_policies.qual` is Postgres's own
re-rendering of the parse tree, and it usually re-qualifies column references — so the
original bare name is frequently no longer visible by the time the catalog is read. When
this check does fire it is strong evidence; when it does not, it has proved nothing.

### junction-table-unprotected

**Many-to-many join table without RLS.** High, heuristic.

A table that is essentially just the two endpoints of two foreign keys, both pointing at
tables that *do* have RLS, with no row-level security of its own. Both sides of the relation
are locked and the edge between them is open — which is enough to enumerate the relation
even when neither endpoint can be read.

Heuristic because a junction table is inferred from its shape. If yours is deliberately
public, `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS enabled but not forced for the table owner.** Medium, or high.

Without `FORCE`, the table's owner is exempt from its own policies. That is harmless when the
owner is a provisioning role nothing connects as, and serious when your application connects
as the owner — so this is **high** when the owning role can log in, and **medium** otherwise.

If the owner is a superuser or has `BYPASSRLS`, it stays medium and says so: `FORCE` cannot
constrain such a role, and implying otherwise would be misleading.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS enabled with no policies.** Medium.

Not a security hole — the opposite. RLS on with zero policies denies every row to everyone
but the owner. It is reported because it is an *invisible* failure: the API returns `[]`, and
an empty table is indistinguishable from a filtered one. This configuration has silently
served empty collections in production for weeks at a time.

### policy-role-unreachable

**Policies target roles nothing connects as.** Medium.

Every policy on the table names roles that do not exist, cannot log in, and that no login
role inherits transitively. The policies look correct and apply to nobody, so the table reads
as empty.

The classic case is policies written `TO authenticated` — a Supabase role name — on a database
whose requests actually arrive as some other role.

### grant-to-public

**Table privileges granted to PUBLIC.** Medium.

A DML privilege granted to `PUBLIC`. Even with RLS enabled this widens *who* policies get
evaluated for, and it is almost never deliberate.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**SECURITY DEFINER routine with a mutable search_path.** Medium.

The routine executes as its owner — often a superuser — while the caller controls how its
identifiers resolve. That is the standard privilege-escalation shape, and anything the
routine touches is read with the owner's rights, bypassing RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**Policy calls `current_setting()` without `missing_ok`.** Low, heuristic.

`current_setting('app.tenant_id')` with a single argument *raises* when the setting is unset,
rather than returning `NULL`. So instead of denying the row, the request errors — the caller
sees a 500 rather than an empty result, and middleware that retries 5xx will retry a request
that can never succeed.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## What this tool does not do

Being clear about the limits is the point — a security tool that overstates its coverage is
worse than none.

- **It is a static catalog audit.** It reads `pg_class`, `pg_policies`, `pg_depend` and
  friends. It does not connect as your `anon` role and try to read your data, so it cannot
  confirm that an exposure is reachable through your API.
- **It cannot prove a policy is correct.** It finds shapes that are known to be wrong. A
  policy that passes every check here can still express the wrong business rule.
- **A clean report is not a security certification.** In particular, see the note on
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres rewrites policy
  expressions, so some bugs are no longer visible in the catalog at all.
- **It does not check application-level authorization**, API keys, network exposure,
  secrets handling, or anything outside the database.

## Related

- [Security Rules (RLS)](/docs/collections/security-rules) — defining row-level security in
  Rebase collections, which compiles to the policies this tool audits.
