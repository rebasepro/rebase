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
rls-check 0.17.3  ·  read-only Row-Level Security audit
────────────────────────────────────────────────────────────────────────────────────────

Database  db.hjklqwertyuiop.supabase.co:5432/postgres
Server    PostgreSQL 15.8 on aarch64-unknown-linux-gnu
Platform  Supabase
Exposed   PUBLIC, anon, authenticated (add yours with --role)
Scanned   1 schema · 3 tables · 2 policies · 15 checks

Note  This scan connected as a role that row-level security cannot constrain — a
      superuser, a table owner, or a role with BYPASSRLS. That is why it can read the
      true catalog, and it is also why nothing below describes what this connection
      experiences. The findings are about what OTHER roles get.

CRITICAL  ·  3 findings
────────────────────────────────────────────────────────────────────────────────────────

  [critical] policy-always-true  public.contact_messages · policy "anyone can write"
      Policy "anyone can write" on public.contact_messages is WITH CHECK (true) for anon

      This permissive INSERT policy's WITH CHECK expression is a constant truth, so it
      matches every row for anon. Permissive policies are ORed together, so this one
      alone satisfies the table's row filter no matter how strict the others are.
      Impact  If this table is reachable over an API as anon, a caller can act on every
              row — the policy applies no scoping whatsoever.
      Fix
          -- Replace the constant with the scoping you intended, e.g.:
          ALTER POLICY "anyone can write" ON "public"."contact_messages"
              WITH CHECK (user_id = auth.uid());
          -- or, if unconditional access really is intended, drop the policy and say so
          -- with an explicit grant instead:
          -- DROP POLICY "anyone can write" ON "public"."contact_messages";
      Docs    https://rebase.pro/docs/rls-check#policy-always-true

  [critical] rls-disabled  public.profiles
      public.profiles has row-level security disabled and is granted to anon and
      authenticated

      Row-level security is not enabled on this table, so Postgres applies no per-row
      filter at all — policies, if any exist, are never consulted. anon and
      authenticated hold DELETE, INSERT, SELECT and UPDATE on it.
      Impact  If this table is reachable over an API that connects as anon and
              authenticated, a caller can read every row and delete, insert and update
              any row, with no tenant or owner scoping.
      Fix
          ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
          -- Enabling RLS with no policies denies every row to everyone but the owner,
          -- so add the policy you intend in the same migration, for example:
          -- CREATE POLICY "profiles_owner_select" ON "public"."profiles"
          --     FOR SELECT TO "anon" USING (user_id = auth.uid());
      Docs    https://rebase.pro/docs/rls-check#rls-disabled

  [critical] view-bypasses-rls  public.user_stats
      View public.user_stats reads public.orders without security_invoker and is
      readable by anon

      The view is owned by postgres and `security_invoker` is not set, so its query
      executes with postgres's privileges rather than the caller's. Row-level security
      on public.orders is evaluated for postgres, not for the role that selected from
      the view.
      Impact  If this view is reachable over an API as anon, a caller reads rows from
              public.orders that the policies on that table were written to withhold —
              the view is an unfiltered path around them.
      Fix
          ALTER VIEW "public"."user_stats" SET (security_invoker = true);
          -- Callers then need their own SELECT privilege on public.orders, and the
          -- policies there apply to them.
      Docs    https://rebase.pro/docs/rls-check#view-bypasses-rls

HIGH  ·  1 finding
────────────────────────────────────────────────────────────────────────────────────────

  [high] anonymous-write-allowed  public.contact_messages · policy "anyone can write"
      public.contact_messages accepts unauthenticated insert via policy "anyone can
      write"

      Policy "anyone can write" is a permissive INSERT policy for anon, and its check
      expression is a constant truth, so every row satisfies it. anon also holds INSERT
      on the table, so both the privilege check and the row check pass for a request
      that carries no credentials.
      Impact  An unauthenticated caller reaching this database over an API can insert
              rows in public.contact_messages at will — inserting records attributed to
              other users, or modifying rows they do not own.
      Fix
          -- Scope the write to the caller, or take the privilege away entirely:
          ALTER POLICY "anyone can write" ON "public"."contact_messages"
              WITH CHECK (user_id = auth.uid());
          -- and if anonymous writes are never intended:
          REVOKE INSERT ON "public"."contact_messages" FROM "anon";
      Docs    https://rebase.pro/docs/rls-check#anonymous-write-allowed

────────────────────────────────────────────────────────────────────────────────────────
Summary

  critical 3   high 1   medium 0   low 0   info 0
  4 confirmed · 0 worth checking · 15 checks run against 3 tables in 1 schema
  1 of 3 tables have row-level security disabled

  Exit code 1 — at least one finding is "high" or worse (--fail-on high).
  Scanned 2026-09-05T09:14:02.881Z · read-only, and nothing left this machine.

rls-check is free and maintained by the team behind Rebase — https://rebase.pro
```

That run found nothing heuristic. When it does, the heuristic findings go in a `WORTH CHECKING` section of their own, after the confident ones — mixing "this table is public" with "this might be a join table" is how a scanner teaches people to ignore it.

The `Exposed` line is worth reading before the findings: every check reports a table only when one of those roles can reach it, so if the role your application connects as is not listed, name it with `--role` and run again.

## The checks

Run `npx @rebasepro/rls-check --list-checks` for the catalog on your installed version.

| id | typical severity | confidence | what it looks for |
| --- | --- | --- | --- |
| `rls-disabled` | critical | certain | A table with RLS off that grants SELECT/INSERT/UPDATE/DELETE to a role an untrusted caller can reach. |
| `policy-always-true` | critical | certain | A permissive policy whose `USING` or `WITH CHECK` expression is always true. Downgraded to medium, and to heuristic, when the policy sits behind an authentication gate. |
| `view-bypasses-rls` | critical | certain | A view granted to an untrusted role that selects from an RLS-protected table and runs with its owner's privileges. Heuristic on servers before PG15, where `security_invoker` does not exist. |
| `policy-anonymous-tautology` | varies | heuristic | An `auth.uid() IS NOT NULL`-shaped policy: it separates signed-in from signed-out callers and scopes no rows. Critical on Supabase-shaped databases, lower elsewhere. |
| `policy-authenticated-tautology` | high | heuristic | The corrected form of the above — `auth.uid() IS NOT NULL AND auth.uid() <> 'anonymous'` — which excludes signed-out callers and still scopes no rows. Every account reads every row; with open registration that is everybody. |
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
  --html <path>          Also write a self-contained HTML report to <path>. One file,
                         no network requests, safe to attach to a ticket.
  --schema <name>        Restrict the scan to a schema. Repeatable or comma-separated.
  --role <name>          Treat this role as one an untrusted caller arrives as, in
                         addition to anon, authenticated, web_anon and rebase_user.
                         A name that is not in pg_roles is an error, not a no-op.
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

If your password contains `/`, `?` or `#`, percent-encode it. Those three end the URL's authority section, so the split lands inside the credential — and rather than print fragments of a password, `rls-check` refuses the string and says so.

`@` and `:` need no encoding here: the userinfo is split at the **last** `@` and the user at the **first** `:`, which is what `pg` does too, so `postgresql://user:pa@ss@host:5432/db` connects to `host` with the password `pa@ss`. Encoding them anyway is never wrong.

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
  "scannedAt": "2026-09-05T09:14:02.881Z",
  "database": {
    "host": "db.hjklqwertyuiop.supabase.co",
    "name": "postgres"
  },
  "serverVersion": "PostgreSQL 15.8 on aarch64-unknown-linux-gnu",
  "platform": "supabase",
  "scannerIsPrivileged": true,
  "exposedRoles": [
    "PUBLIC",
    "anon",
    "authenticated"
  ],
  "stats": {
    "schemas": 1,
    "tables": 1,
    "policies": 0,
    "tablesWithoutRls": 1,
    "checksRun": 15
  },
  "findings": [
    {
      "id": "rls-disabled",
      "severity": "critical",
      "confidence": "certain",
      "title": "public.profiles has row-level security disabled and is granted to anon",
      "target": {
        "schema": "public",
        "table": "profiles"
      },
      "detail": "Row-level security is not enabled on this table, so Postgres applies no per-row filter at all — policies, if any exist, are never consulted. anon holds DELETE, INSERT, SELECT and UPDATE on it.",
      "impact": "If this table is reachable over an API that connects as anon, a caller can read every row and delete, insert and update any row, with no tenant or owner scoping.",
      "fix": "ALTER TABLE \"public\".\"profiles\" ENABLE ROW LEVEL SECURITY;\n-- Enabling RLS with no policies denies every row to everyone but the owner,\n-- so add the policy you intend in the same migration, for example:\n-- CREATE POLICY \"profiles_owner_select\" ON \"public\".\"profiles\"\n--     FOR SELECT TO \"anon\" USING (user_id = auth.uid());",
      "docs": "https://rebase.pro/docs/rls-check#rls-disabled"
    }
  ],
  "diagnostics": {
    "tlsVerificationDisabled": false,
    "excludedSchemas": [
      {
        "schema": "auth",
        "reason": "platform"
      },
      {
        "schema": "information_schema",
        "reason": "system"
      },
      {
        "schema": "pg_catalog",
        "reason": "system"
      },
      {
        "schema": "pg_toast",
        "reason": "system"
      },
      {
        "schema": "storage",
        "reason": "platform"
      }
    ],
    "degraded": [],
    "unrecognizedGrantees": [],
    "scanningAsExposedRole": null
  }
}
```

Findings are sorted worst-first and then by schema, object and id, so two scans of an unchanged database produce an identical file.

`exposedRoles` and `diagnostics` are part of the contract, not decoration. Every check reports a table only when one of the exposed roles can reach it, and `diagnostics.degraded` is how a consumer tells "nothing was wrong" from "the scan could not look" — `findings: []` without both is half an answer.

## What this tool does not do

Being clear about this is the point of the tool. It is a **static audit of the catalog**, not a penetration test.

- **It does not execute queries as other roles.** It never connects as `anon`, never sets a JWT claim, and never tries to read a row it should not be able to read. Everything it reports is inferred from what the catalogs say, not observed.
- **It cannot prove a policy is correct.** Deciding whether `owner_id = auth.uid()` is the right rule for your application requires knowing your application. `rls-check` can only tell you that certain *shapes* are wrong — a policy that is always true, a view that runs as its owner, a table with RLS switched off.
- **A clean report is not a security certification.** It means these fifteen checks found nothing. It does not mean your authorization model is sound, your API layer enforces what it should, or your data is safe.
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
