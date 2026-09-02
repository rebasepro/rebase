# @rebasepro/rls-check

Audit Row-Level Security on any PostgreSQL database. One command, no configuration, no account, nothing to install.

```sh
npx @rebasepro/rls-check
```

Run it in your project directory and it finds the database itself: `DATABASE_URL`, then `POSTGRES_URL`, then a `.env` beside you. Point it somewhere else with `DATABASE_URL="postgresql://user:password@host:5432/database" npx @rebasepro/rls-check`.

It also takes the connection string as an argument, but prefer not to: npm echoes the command line before the program starts and your shell records it, so the password lands in two places `rls-check` cannot redact. Writing `$DATABASE_URL` there does not help — the shell expands it before npm sees it.

It works against Supabase, Neon, RDS, Cloud SQL, Postgres in a container on your laptop, or anything else that speaks the wire protocol. It knows nothing about your framework and asks nothing of your codebase.

**It is read-only.** It issues `SELECT`s against the system catalogs — `pg_class`, `pg_policies`, `pg_proc`, `information_schema` — and nothing else. It writes nothing, changes no setting, and sends nothing anywhere. There is no telemetry, no upload, and no network access beyond the connection you give it.

---

## What it finds

The failures that make a Postgres database leak in practice, rather than the ones that are easy to check for:

- tables served to an anonymous role with RLS switched off, so the policies on them never run;
- policies that look like access control but evaluate to `true` for every row;
- `auth.uid() IS NOT NULL`-shaped policies, which separate signed-in from signed-out callers and scope nothing;
- views and materialized views that read past the RLS on their base tables because they run as their owner;
- a bare column inside an `EXISTS` subquery that Postgres silently binds to the *inner* table, turning a tenant filter into a tautology;
- many-to-many join tables left unprotected between two protected endpoints — the whole edge list, readable;
- `SECURITY DEFINER` routines with an unpinned `search_path`;
- `GRANT`s to `PUBLIC`, and policies pointed at roles nothing can connect as.

## Example

A scan of a Supabase project, `--no-color`:

```
rls-check 0.10.0  ·  read-only Row-Level Security audit
────────────────────────────────────────────────────────────────────────────

Database  db.hjklqwertyuiop.supabase.co:5432/postgres
Server    PostgreSQL 15.8 on aarch64-unknown-linux-gnu
Platform  Supabase
Scanned   1 schema · 23 tables · 31 policies · 14 checks

Note  This scan connected as a role that row-level security cannot constrain — a
      superuser, a table owner, or a role with BYPASSRLS. That is why it can read
      the true catalog, and it is also why nothing below describes what this
      connection experiences. The findings are about what OTHER roles get.

CRITICAL  ·  2 findings
────────────────────────────────────────────────────────────────────────────

  [critical] rls-disabled  public.profiles
      public.profiles is exposed to anon without row-level security

      Row-level security is disabled on this table, and anon holds SELECT, INSERT,
      UPDATE and DELETE on it. With RLS off, policies are not consulted at all — a
      policy defined on this table would have no effect.
      Impact  Anyone with the project's anon key, which ships in your client bundle,
              can read and modify every row.
      Fix
          ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

          -- Then add at least one policy, or the table denies everything:
          CREATE POLICY profiles_select_own ON public.profiles
              FOR SELECT TO authenticated USING (id = auth.uid());
      Docs    https://rebase.pro/docs/rls-check#rls-disabled

  [critical] view-bypasses-rls  public.user_stats
      public.user_stats reads past the row-level security on public.profiles

      The view is granted to anon and does not set security_invoker, so it executes
      with the privileges of its owner (postgres) rather than the caller's. The
      policies on public.profiles never run.
      Impact  An anon caller selecting from the view receives every row of
              public.profiles, whatever its policies say.
      Fix
          ALTER VIEW public.user_stats SET (security_invoker = true);
      Docs    https://rebase.pro/docs/rls-check#view-bypasses-rls

HIGH  ·  1 finding
────────────────────────────────────────────────────────────────────────────

  [high] anonymous-write-allowed  public.contact_messages · policy "anyone can write"
      public.contact_messages accepts inserts from anon under policy "anyone can
      write"

      The policy is PERMISSIVE, applies to INSERT, names anon in its TO clause, and
      its WITH CHECK expression is `true`, so every proposed row passes.
      Impact  Anyone holding the anon key can insert unlimited rows. There is no
              rate limit at the database layer.
      Fix
          ALTER POLICY "anyone can write" ON public.contact_messages
              WITH CHECK (created_by = auth.uid() AND length(body) < 4000);
      Docs    https://rebase.pro/docs/rls-check#anonymous-write-allowed

MEDIUM  ·  2 findings
────────────────────────────────────────────────────────────────────────────

  [medium] grant-to-public  public.feature_flags
      public.feature_flags grants SELECT to PUBLIC

      PUBLIC is every role in the cluster, including roles created after this grant.
      The grant survives changes to anon and authenticated.
      Impact  Any role that can connect can read this table, whether or not you
              intended it to be reachable.
      Fix
          REVOKE SELECT ON public.feature_flags FROM PUBLIC;
          GRANT SELECT ON public.feature_flags TO authenticated;
      Docs    https://rebase.pro/docs/rls-check#grant-to-public

  [medium] rls-enabled-not-forced  public.orders
      public.orders does not force row-level security for its owner

      RLS is enabled but not FORCEd, so the table's owner (postgres) is exempt from
      its own policies. Any SECURITY DEFINER function owned by that role reads the
      table unfiltered.
      Impact  A trigger, a scheduled job, or an RPC running as the owner sees every
              tenant's rows even though the policies say otherwise.
      Fix
          ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
      Docs    https://rebase.pro/docs/rls-check#rls-enabled-not-forced

WORTH CHECKING
  These are heuristics, not proofs. They match a shape that is usually a mistake,
  but each one may be deliberate in your schema — read them and decide. They are
  listed separately so nothing above needs a second opinion.

  [high] junction-table-unprotected  public.project_members
      public.project_members looks like a join table between two protected tables
      and has no RLS

      The table is two foreign keys and a primary key over both, pointing at
      public.projects and public.profiles — both of which have row-level security.
      This one does not.
      Impact  If this table is exposed over an API, the full membership graph is
              readable: who belongs to which project, for every project.
      Fix
          ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.project_members FORCE ROW LEVEL SECURITY;

          CREATE POLICY project_members_follows_project ON public.project_members
              FOR SELECT TO authenticated USING (EXISTS (
                  SELECT 1 FROM public.projects p
                  WHERE p.id = project_members.project_id AND p.owner_id = auth.uid()
              ));
      Docs    https://rebase.pro/docs/rls-check#junction-table-unprotected

────────────────────────────────────────────────────────────────────────────
Summary

  critical 2   high 2   medium 2   low 1   info 0
  5 confirmed · 2 worth checking · 14 checks run against 23 tables in 1 schema
  3 of 23 tables have row-level security disabled

  Exit code 1 — at least one finding is "high" or worse (--fail-on high).
  Scanned 2026-07-26T09:14:02.881Z · read-only, and nothing left this machine.

rls-check is free and maintained by the team behind Rebase — https://rebase.pro
```

Heuristic findings are always kept in their own section, after the confident ones. Mixing "this table is public" with "this might be a join table" is how a scanner teaches people to ignore it.

## The checks

Run `npx @rebasepro/rls-check --list-checks` for the catalog on your installed version.

| id | typical severity | confidence | what it looks for |
| --- | --- | --- | --- |
| `rls-disabled` | critical | certain | A table with RLS off that grants SELECT/INSERT/UPDATE/DELETE to a role an untrusted caller can reach. |
| `policy-always-true` | critical | certain | A permissive policy whose `USING` or `WITH CHECK` expression is always true. Downgraded to medium, and to heuristic, when the policy sits behind an authentication gate. |
| `view-bypasses-rls` | critical | certain | A view granted to an untrusted role that selects from an RLS-protected table and runs with its owner's privileges. Heuristic on servers before PG15, where `security_invoker` does not exist. |
| `policy-anonymous-tautology` | varies | heuristic | An `auth.uid() IS NOT NULL`-shaped policy: it separates signed-in from signed-out callers and scopes no rows. Critical on Supabase-shaped databases, lower elsewhere. |
| `anonymous-write-allowed` | high | certain | A permissive INSERT/UPDATE/DELETE policy reachable without authentication whose check expression accepts any row, backed by a matching grant. |
| `matview-bypasses-rls` | high | certain | A materialized view granted to an untrusted role whose defining query reads an RLS-protected table. Materialized views have no `security_invoker`. |
| `unqualified-column-in-subquery` | high | heuristic | A bare column name in an `EXISTS`/`IN` subquery that exists on both the inner relation and the policy's own table, so Postgres binds it to the inner one. |
| `junction-table-unprotected` | high | heuristic | A table that is essentially two foreign keys pointing at RLS-protected tables, with no row-level security of its own. |
| `grant-to-public` | medium | certain | A table privilege granted to `PUBLIC`, which includes roles that do not exist yet. |
| `rls-enabled-no-policies` | medium | certain | RLS enabled and not a single policy defined, so the table denies everything. |
| `rls-enabled-not-forced` | medium | certain | RLS enabled without `FORCE`, so the owning role is exempt from its own policies. |
| `policy-role-unreachable` | medium | certain | Every policy on a table names roles that do not exist, cannot log in, and that no login role inherits. |
| `security-definer-mutable-search-path` | medium | certain | A `SECURITY DEFINER` routine that does not pin `search_path`, so the caller controls how its identifiers resolve. |
| `current-setting-throws` | low | heuristic | A policy calling `current_setting('x')` with one argument, which raises instead of returning `NULL` when the setting is unset. |

Ids are stable. They go into `--skip` lists and CI baselines, so a rename is treated as a breaking change.

## Usage

```
DATABASE_URL="postgresql://..." npx @rebasepro/rls-check [options]
npx @rebasepro/rls-check [connection-string] [options]

  --json                 Machine-readable ScanResult on stdout, and nothing else.
  --schema <name>        Restrict the scan to a schema. Repeatable or comma-separated.
  --role <name>          Treat this role as one an untrusted caller arrives as, in
                         addition to anon, authenticated, web_anon and rebase_user.
                         Repeatable or comma-separated.
  --fail-on <severity>   Exit 1 at or above this severity: info, low, medium, high,
                         critical, or none to never fail. Default: high.
  --only <id>            Run only these checks. Repeatable or comma-separated.
  --skip <id>            Skip these checks. Repeatable or comma-separated.
  --list-checks          Print the check catalog and exit.
  --timeout <ms>         Statement timeout for each catalog query. Default: 15000.
  --quiet                Findings only: no banner, no summary.
  --no-color             Disable ANSI colour. NO_COLOR and a non-TTY stdout are
                         honoured automatically; --color forces it back on.
  -h, --help             Show the help text.
  -v, --version          Print the version.
```

The connection string is taken from, in order:

1. the positional argument;
2. `$DATABASE_URL`;
3. `$POSTGRES_URL`;
4. `DATABASE_URL` (then `POSTGRES_URL`) in a `.env` file in the current directory.

The connection string never appears in the output — not in the report, not in an error, not in a log line. Host, port and database name are shown; the user and password are replaced with `***`.

If your password contains `@`, `:`, `/`, `?` or `#`, percent-encode it. An unencoded one makes the URL ambiguous, and `rls-check` refuses to guess rather than risk connecting somewhere unintended.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Clean, or nothing at or above `--fail-on`. |
| `1` | Findings at or above `--fail-on`. |
| `2` | The scan did not run: bad arguments, connection refused, authentication failed, timeout. |

`1` and `2` are never conflated. A pipeline that reads a DNS failure as a clean bill of health is worse than no tool at all.

## In CI

```yaml
name: rls
on: [push, pull_request]

jobs:
  rls-check:
    runs-on: ubuntu-latest
    steps:
      - name: Audit row-level security
        run: npx --yes @rebasepro/rls-check --fail-on high --no-color
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Tighten the gate as you clean up (`--fail-on medium`, then `low`), or hold a line while you work through a backlog:

```yaml
        run: npx --yes @rebasepro/rls-check --fail-on high --skip rls-enabled-not-forced
```

To keep the machine-readable result as an artifact:

```yaml
        run: npx --yes @rebasepro/rls-check --json > rls-report.json
```

## JSON output

`--json` writes a single `ScanResult` object to stdout and nothing else. Errors still go to stderr.

```json
{
  "scannedAt": "2026-07-26T09:14:02.881Z",
  "database": { "host": "db.hjklqwertyuiop.supabase.co", "name": "postgres" },
  "serverVersion": "PostgreSQL 15.8 on aarch64-unknown-linux-gnu",
  "platform": "supabase",
  "scannerIsPrivileged": true,
  "stats": {
    "schemas": 1,
    "tables": 23,
    "policies": 31,
    "tablesWithoutRls": 3,
    "checksRun": 14
  },
  "findings": [
    {
      "id": "rls-disabled",
      "severity": "critical",
      "title": "public.profiles is exposed to anon without row-level security",
      "target": { "schema": "public", "table": "profiles" },
      "detail": "…",
      "impact": "…",
      "fix": "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;",
      "docs": "https://rebase.pro/docs/rls-check#rls-disabled",
      "confidence": "certain"
    }
  ]
}
```

Findings are sorted worst-first and then by schema, object and id, so two scans of an unchanged database produce an identical file.

## What this tool does not do

Being clear about this is the point of the tool. It is a **static audit of the catalog**, not a penetration test.

- **It does not execute queries as other roles.** It never connects as `anon`, never sets a JWT claim, and never tries to read a row it should not be able to read. Everything it reports is inferred from what the catalogs say, not observed.
- **It cannot prove a policy is correct.** Deciding whether `owner_id = auth.uid()` is the right rule for your application requires knowing your application. `rls-check` can only tell you that certain *shapes* are wrong — a policy that is always true, a view that runs as its owner, a table with RLS switched off.
- **A clean report is not a security certification.** It means these fourteen checks found nothing. It does not mean your authorization model is sound, your API layer enforces what it should, or your data is safe.
- **It recognises app roles by name, and yours may not be one of them.** Every check reports a table as exposed only when a role an untrusted caller can arrive as holds privileges on it. Out of the box that means `PUBLIC`, Supabase's `anon` and `authenticated`, PostgREST's `web_anon`, and Rebase's `rebase_user`. If your application connects as `app_user`, `api` or anything else, name it — `--role app_user` — or the checks have nothing to gate on. A scan that finds a write-holding role it cannot account for says so in a `Note` rather than printing a clean report.
- **It does not model your API layer.** Whether a table is actually reachable depends on PostgREST, your server, or your gateway. Findings say "if this table is exposed over an API" when reachability depends on something outside the database — believe that qualifier.
- **It does not see what your connection sees.** Almost every connection string handed to a tool like this belongs to a superuser or a table owner, which RLS cannot constrain. That is what lets it read the true catalog; it also means the findings describe what *other* roles get. The report says so, prominently, every time it applies.
- **Heuristic checks produce false positives by design.** Junction-table inference and unqualified-column detection match a shape, not a proof. They are reported in a separate section for exactly that reason.
- **It does not change anything.** No `ALTER`, no `SET`, no temporary objects, no `pg_stat_statements` reset. The `fix` blocks are text for you to read, review and run yourself.

## Programmatic use

```ts
import { scan, exceedsThreshold } from "@rebasepro/rls-check";

const result = await scan({
    connectionString: process.env.DATABASE_URL!,
    schemas: ["public"],
    skip: ["rls-enabled-not-forced"]
});

if (exceedsThreshold(result.findings, "high")) {
    throw new Error(`${result.findings.length} RLS findings`);
}
```

`introspect()`, `runChecks()`, `renderReport()` and `renderJson()` are exported too, if you would rather assemble the pipeline yourself. The checks are pure functions of a `DbSnapshot`, so they are straightforward to test against a schema you construct by hand.

## Requirements

Node 20 or newer, and a PostgreSQL server the machine can reach. The only runtime dependency is [`pg`](https://www.npmjs.com/package/pg) — deliberately, because this package gets pointed at production databases by people who have never heard of us, and the install should be small enough to read in full before running it.

Tested against PostgreSQL 12 through 18. On servers older than 15 the `security_invoker` view option does not exist, and `view-bypasses-rls` reports as a heuristic rather than a certainty.

---

MIT licensed. Built and maintained by the team behind [Rebase](https://rebase.pro), a Postgres-backed application backend — it is free, it is not a trial, and it does not need Rebase to be useful. Issues and check suggestions: [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase).
