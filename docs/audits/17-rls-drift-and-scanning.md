# Audit 17 — RLS drift detection and scanning

Scope: `packages/server-postgres/src/security/policy-drift.ts`,
`packages/rls-check` (whole package), `tooling/scripts/rls-scan.mts`,
`tooling/scripts/rls-baseline.json`, and the CI step that drives them
(`.github/workflows/verify.yml:521-525`).

Read-only. Nothing in the repository was modified.

Lens: bug-classes **4** (safety nets that swallow their own failures) and **36 /
21** (a mechanism nothing enforces, a declared thing nothing reads). The
question is not "does the scanner work" but "what does it report when it is
broken, and what can never reach it at all".

---

## Verdict

The subsystem is unusually well built. `rls-check`'s fourteen checks are honest
about confidence, gate on reachability rather than shape, resolve role
membership transitively, read `relacl` rather than `information_schema`, and are
each unit-tested against a hand-written snapshot plus a Docker fixture that
asserts both halves (the `vuln_*` objects fire, the `secure_*` objects stay
silent). `tooling/scripts/rls-scan.mts` has the vacuity floor and the 0/1/2 exit-code
discipline that most gates in this repo learned the hard way.

It is nevertheless **not a gate you can trust to fail**, for three independent
reasons that compose:

1. **Every catalogue read failure is silently downgraded to "no findings".** The
   introspector records each one in an `IntrospectDiagnostics` struct — and
   `introspect()` throws that struct away before `scan()` ever sees it. Nothing
   in the CLI, the report, the JSON contract or the CI wrapper reads
   `degraded`, `tlsVerificationDisabled` or `excludedSchemas`. A failed `grants`
   read alone silently disables four checks, including two of the three
   criticals, and the run exits 0 with `✓ No unexpected RLS findings`.
2. **The CI baseline key drops both the policy name and the SQL command**, so
   the ten `policy-always-true` entries recording "this table is public-read on
   purpose" also accept *public write* on those tables — and the check that
   exists to catch anonymous writes (`anonymous-write-allowed`) is structurally
   incapable of firing on a Rebase-generated schema. Those two compose into a
   complete, silent hole (F2 + F4 below).
3. **`checkPolicyDrift` does not look at `relrowsecurity` at all.** A table with
   `ALTER TABLE … DISABLE ROW LEVEL SECURITY` and all its policies intact
   reports **zero drift**, and `rebase doctor --policies` prints
   `✓ RLS policies match your collections`.

`pnpm rls:check` does exit non-zero on findings, and it *is* wired into
`verify.yml`, which `ci.yml` calls on every pull request and every push to main.
That part of the claim holds. But it runs at the default `--fail-on high`, and
five of the fourteen checks — including `policy-role-unreachable` and
`rls-enabled-no-policies`, which are the two incidents the whole subsystem was
built to prevent — top out at `medium` and therefore can never fail a build.

`rls-baseline.json` is not a silently-regenerable ratchet: there is no
regeneration script, every entry needs a hand-written `reason`, a missing
baseline file fails *closed* (more findings gate, not fewer), and stale entries
are reported. The weakness is the key granularity, not the process.

---

## Findings

### H1 — Every catalogue read failure is reported as a clean scan

`packages/rls-check/src/introspect.ts:113-115`, `:249-269`;
`packages/rls-check/src/cli.ts:69-73`; `packages/rls-check/src/types.ts:210-226`

`reader()` wraps every catalogue query in a `try/catch` that pushes
`{ what, error }` onto `diagnostics.degraded`, rolls back, re-opens the read-only
transaction, and **returns `[]`**:

```ts
} catch (error) {
    diagnostics.degraded.push({ what, error: … });
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("BEGIN READ ONLY").catch(() => undefined);
    return [];
}
```

The intent is right — one unreadable catalogue should degrade one fact, not the
scan. The defect is the other half: **the diagnostics are never delivered to
anyone.** `introspect()` is

```ts
export async function introspect(opts: ConnectOptions): Promise<DbSnapshot> {
    return (await introspectWithDiagnostics(opts)).snapshot;   // :114
}
```

and `scan()` calls `introspect`, not `introspectWithDiagnostics`
(`cli.ts:69`). `ScanResult` (`types.ts:210-226`) has no field for them.
`grep -rn "degraded\|tlsVerificationDisabled" packages/rls-check/src` returns
only the definition site and one unit test of `selectSchemas`. `report.ts` never
mentions them. `tooling/scripts/rls-scan.mts` never mentions them.

Three separate promises in the docblocks are therefore false:

- *"a server that lacks a catalog degrades that one fact, not the whole scan"* —
  true, but the reader is never told which fact was lost;
- *"Common with managed Postgres behind a pooler — and never done silently"*
  (`introspect.ts:55-58`, on the TLS-verification downgrade) — it is done
  silently, in every code path that exists;
- *"we skipped 11 schemas is the difference between a clean result and a
  misleading one"* (`introspect.ts:48-51`) — the excluded-schema list is
  likewise dropped.

**Which failures the vacuity guard does *not* cover.** `tooling/scripts/rls-scan.mts`
floors `stats.tables` and `stats.policies` only (`:242-254`). Those two floors
catch a failed `relations` read and a failed `policies` read. Everything else
fails open:

| catalogue that failed | what goes silent |
|---|---|
| `table privileges` (`introspect.ts:543`) | `grants = []` → `exposedGrantees()` returns `[]` for every relation → **`rls-disabled` (critical), `view-bypasses-rls` (critical), `matview-bypasses-rls` (high), `anonymous-write-allowed` (high) and `grant-to-public` all report nothing** |
| `roles` (`:373`) | `exposedRoles` collapses to `["PUBLIC"]`, `detectPlatform` → `unknown`, so `policy-anonymous-tautology` drops from **critical to medium** — under the CI threshold — and `policy-role-unreachable` / `rls-enabled-not-forced` misjudge every owner |
| `views` (`:580`) / `view dependencies` (`:629`) | the two view checks find nothing |
| `foreign keys` (`:692`) / `columns` (`:465`) | `junction-table-unprotected` finds nothing |
| `routines` (`:740`) | `security-definer-mutable-search-path` finds nothing |
| `server version and current role` (`:278`) | `serverVersionNum = 0` → every view is treated as pre-PG15, `scannerIsPrivileged` computed from a `currentRole` of `"unknown"` → **the privilege caveat is suppressed** on a scan run as a superuser |

**Failure scenario.** A CI runner's scan role loses `SELECT` on `pg_class` for
one query — a provider revokes a default grant, a pooler kills the session
mid-transaction and the `BEGIN READ ONLY` retry lands on a different backend, a
`statement_timeout` fires on the grants query on a large catalogue (57014, the
only one `explainError` even has a message for). `readGrants` returns `[]`.
`stats.tables` and `stats.policies` are unaffected, so the vacuity guard passes.
The report prints `Scanned 1 schema · 11 tables · 88 policies · 14 checks` and
`✓ No unexpected RLS findings at or above "high"`. Exit 0. A table with RLS off
and `GRANT ALL … TO rebase_user` ships.

**Fix direction.** Put the diagnostics in `ScanResult` (`degraded`,
`tlsVerificationDisabled`, `excludedSchemas`), have `scan()` call
`introspectWithDiagnostics`, print them in `renderReport` above the findings
(they survive `--quiet`, like the privilege caveat), and make
`tooling/scripts/rls-scan.mts` **exit 2 when `degraded` is non-empty** — a partially-read
catalogue is "the scan did not happen", not "the database is clean". Pin it with
a test that injects a failing query for each catalogue in turn and asserts a
non-zero exit; the tell that the current design cannot be tested is that there is
no such test today.

---

### H2 — The CI baseline accepts a *write* policy where it recorded a *read* one

`tooling/scripts/rls-scan.mts:163-174`; `tooling/scripts/rls-baseline.json:22-33`

```ts
function findingKey(finding: Finding): string {
    const t = finding.target;
    const object = t.table ? `${t.schema}.${t.table}` : …;
    return `${finding.id} ${object}`;          // :173
}
```

Dropping the policy *name* is correct and the file explains why (the name
carries a semantics hash, so name-keyed entries go stale on every unrelated
edit). But the finding's **command** is dropped with it, and the command is not
in the name — it is the thing the baseline's own reasons are about. Every entry
reads *"Reference app: public read by default"*, and each one accepts any
`policy-always-true` finding on that table, for any command.

**Failure scenario, end to end.** Someone adds
`{ operation: "update", access: "public" }` to `posts` in the reference app
(`app/config/collections/index.ts`) — a plausible mistake, since `access:
"public"` is already the file's idiom for `select`.
`securityRuleToConditions` maps `access: "public"` to `policy.true()`
(`packages/common/src/util/policy/securityRuleToConditions.ts:37`), so
`generateSinglePolicyStatements` emits

```sql
CREATE POLICY "posts_update_…" ON "public"."posts" AS PERMISSIVE FOR UPDATE
    TO "public" USING (true) WITH CHECK (true);
```

Now walk the fourteen checks:

- `policy-always-true` fires, **critical** — and its key is
  `policy-always-true public.posts`, which is baselined. Accepted silently.
- `anonymous-write-allowed` cannot fire — see **H4**.
- `grant-to-public` cannot fire: Rebase grants DML to `rebase_user`, never to
  PUBLIC (`packages/server-postgres/src/security/rls-enforcement.ts:245-247`).
- `rls-disabled` cannot fire: RLS is enabled.
- Nothing else looks at write policies.

`pnpm rls:check` exits 0. Anonymous UPDATE of every row of `posts` ships, gated
by a file whose stated purpose is to make exactly this visible.

**Fix direction.** Put the command in the key — `policy-always-true
public.posts SELECT` — and add `command` to the `BaselineEntry` shape (an entry
without one can keep matching any command during a migration window, but new
entries should require it). The existing "stale entry" warning then does the
migration for you: the ten current entries go stale, get a `SELECT`, and the
UPDATE case fails the build. Consider also keying on `target.policy`'s
*operation prefix* (`posts_update_`), which is stable across hash changes.

---

### H3 — `checkPolicyDrift` never reads whether RLS is on

`packages/server-postgres/src/security/policy-drift.ts:123-150`, `:190-252`

`readLivePolicies` reads `pg_policies` and nothing else. The comparison
(`:224-249`) covers name, roles, command, and clause *presence*. It never reads
`pg_class.relrowsecurity`, never reads `relforcerowsecurity`, and never reads
`pg_policies.permissive`.

Three consequences, in order of severity:

**(a) RLS disabled on a table is invisible.** `ALTER TABLE posts DISABLE ROW
LEVEL SECURITY` leaves every policy row in `pg_policies` untouched, so every
expected policy matches on every field this compares. `hasDrift()` is false and
`rebase doctor --policies` prints `✓ RLS policies match your collections
(N collection(s) checked)` (`schema/doctor-policy-checks.ts:93`) on a table
Postgres is applying no filter to at all. Requests run as `rebase_user`, which
holds full DML, so the table is wide open.

Nothing else on the declared-collections path covers this either. The only
reader of `relrowsecurity` in the driver is `readRlsStatus`
(`schema/introspect-runtime.ts:58`), used exclusively by the BaaS
*introspection* branch of `PostgresBootstrapper` (`:186-227`) — i.e. only when
there are **no** declared collections. `ensureCollectionPolicies` re-runs
`ENABLE ROW LEVEL SECURITY` idempotently, but only in the managed-runtime boot
path (its own docblock, `schema/ensure-collection-policies.ts:1-33`). A
self-hosted project's next `db push` would re-enable it; until then, `doctor`
certifies the database.

**(b) PERMISSIVE ↔ RESTRICTIVE is invisible.** `mode: "permissive" |
"restrictive"` is a public `SecurityRule` field
(`packages/types/src/types/security_rules.ts:123`) and the generator emits
`AS ${mode}` (`schema/generate-postgres-ddl-logic.ts:127`). The DDL parser
*captures* that group and then discards it:

```ts
const [, name, schema, table, , command, rolesRaw, clause] = m;   // :105
```

— the empty slot is `AS (\w+)`. And `readLivePolicies` does not select
`permissive` even though `pg_policies` exposes it and `rls-check`'s own
introspector reads it (`packages/rls-check/src/introspect.ts:528`). A rule
declared `mode: "restrictive"` whose live policy is PERMISSIVE (a database
pushed before the mode was set, then never re-pushed) reports clean — and the
gate that was supposed to be ANDed in is now ORed in, which is the maximally
permissive failure.

**(c) Answering the two questions in the brief directly.**
*Does it compare semantics or text?* Neither, deliberately: it compares four
exact scalar fields plus clause presence, and the docblock (`:174-188`) records
why text is excluded (Postgres rewrites `qual`, so a text diff cries wolf).
*Will a semantically identical policy formatted differently report drift?* No —
that is the point of the design, and `policy-drift.test.ts:112-124` pins it.
*Will a semantically different policy with matching text pass?* **Yes, and worse
— a semantically different policy with entirely different text passes.** Replace
`USING (user_id = rebase.uid())` with `USING (true)` under the same policy name
and the drift checker reports nothing. The only expression text it reads is one
hard-coded shape, `auth.uid() IS NOT NULL` (`:160-168`) — a single known
historical bug, not a class.

**Fix direction.** Add `relrowsecurity` / `relforcerowsecurity` and
`pg_policies.permissive` to `readLivePolicies`, and add two categories to
`PolicyDrift`: `rlsDisabled` (a table the collections describe with RLS off) and
a `mode` difference in `diverged`. The tautology scan already proves the
mechanism for "one thing the text diff cannot express" — this is two more, and
both are exact catalogue booleans with no false-positive risk, exactly the
argument `:180-188` already makes for clause presence. Then have doctor call
`rls-check`'s `policy-always-true` (or port `isUnconditionalTrue`) so that a
hand-widened expression is a first-class drift category rather than a hole.

---

### H4 — `anonymous-write-allowed` cannot fire on any Rebase-generated schema

`packages/rls-check/src/checks/util.ts:22`;
`packages/rls-check/src/checks/anonymous-write-allowed.ts:130-140`, `:71-78`;
`packages/rls-check/src/introspect.ts:111`

Two role lists exist and they disagree:

```ts
// introspect.ts:111 — roles an untrusted request plausibly arrives as
const CANDIDATE_EXPOSED_ROLES = ["anon", "authenticated", "web_anon", "rebase_user"];

// checks/util.ts:22 — roles a caller reaches without ever authenticating
export const ANONYMOUS_ROLES = ["public", "anon", "web_anon"];
```

For Supabase the split is exactly right: `authenticated` is exposed but not
anonymous. For Rebase it is wrong. `rebase_user` is the role **both** signed-in
and signed-out requests arrive as — the server `SET LOCAL ROLE rebase_user`s for
every request and coerces a missing caller id to the `'anonymous'` sentinel
(which is the whole premise of `policy-anonymous-tautology`'s `rebase` branch,
`policy-anonymous-tautology.ts:105-116`). `rebase_user` is missing from
`ANONYMOUS_ROLES`.

Trace the check on the H2 policy (`FOR UPDATE TO "public" WITH CHECK (true)`):

- `anonymousIdentities(snapshot, ["public"])` → `named = ["public"]`; `public`
  is a public role, so it appends every *present* role in `ANONYMOUS_ROLES` —
  and on a Rebase database `anon` and `web_anon` do not exist. Returns
  `["public"]`.
- `effectivePrivileges(snapshot, …, "public")` → `rolesUsableBy` is `{"public"}`
  (there is no `public` row in `pg_roles` to inherit from), so only grants whose
  grantee is literally `PUBLIC` count. Rebase grants to `rebase_user`
  (`rls-enforcement.ts:245-247`). `granted.size === 0` → `continue`.

No finding. The check is dead on the platform it ships with — and doubly dead if
the rule sets `pgRoles: ["rebase_user"]`, since `named` is then empty and the
loop `continue`s at `:64`.

The e2e fixture does not catch this because it builds a Supabase-shaped
database (`test/e2e/scan.e2e.test.ts:122-124` asserts
`platform === "supabase"`), where the grants really are to `anon`. The
`rls-scan.mts` gate does not catch it because the acceptance database has no
public write rule to trip it.

**Fix direction.** Make the anonymous-role set platform-aware rather than a
constant: on `platform === "rebase"`, `rebase_user` is an anonymous identity
(the sentinel-id branch of `policy-anonymous-tautology` already encodes exactly
this fact — it is a second implementation of one predicate, bug class 2).
Then add a `vuln_*` object to the fixture on a `rebase`-shaped snapshot, or a
unit test with `platform: "rebase"` and a `rebase_user` grant, so the two role
lists cannot drift apart again.

---

### H5 — The CI gate runs above the severity of the incidents that created it

`tooling/scripts/rls-scan.mts:97` (`let failOn: Severity | "none" = "high"`);
`.github/workflows/verify.yml:521-525` (no `--fail-on` passed)

Maximum severity each check can emit:

| check | max severity | gates at `high`? |
|---|---|---|
| `rls-disabled` | critical | ✅ |
| `policy-always-true` | critical (**medium** if any RESTRICTIVE policy exists — see M4) | ✅ |
| `policy-anonymous-tautology` | critical on `rebase`/`postgrest`, medium on `unknown`, low on `supabase` | ✅ (platform-dependent) |
| `view-bypasses-rls` | critical | ✅ |
| `matview-bypasses-rls` | high | ✅ |
| `anonymous-write-allowed` | high | ✅ (but see H4) |
| `unqualified-column-in-subquery` | high | ✅ |
| `junction-table-unprotected` | high | ✅ |
| `rls-enabled-not-forced` | high **only** when the owner can log in and is neither superuser nor BYPASSRLS; medium otherwise | ⚠️ conditional |
| `rls-enabled-no-policies` | medium | ❌ never |
| `policy-role-unreachable` | medium | ❌ never |
| `grant-to-public` | medium | ❌ never |
| `security-definer-mutable-search-path` | medium | ❌ never |
| `current-setting-throws` | low | ❌ never |

The two that matter most here are the two the subsystem exists because of:

- `policy-role-unreachable` — *"This project's own demo database sat in exactly
  this state for weeks"* (`policy-role-unreachable.ts:20`), the incident
  `policy-drift.ts`'s docblock opens with. **medium. Cannot fail the build.**
- `rls-enabled-no-policies` — *"a production database was found with a SELECT
  policy whose `qual` was NULL … denying 100% of reads"*
  (`policy-drift.ts:184-187`). **medium. Cannot fail the build.**

Both are correctness rather than exposure findings, which is presumably the
reasoning behind `medium` — but the gate's whole justification in `verify.yml`
is *"A policy that grants more than the collection asked for fails the build
here"*, and a database that silently serves nothing is the failure mode this
repo has actually shipped, twice.

**Fix direction.** Pass `--fail-on medium` in `verify.yml` and baseline what the
acceptance database legitimately produces at that level (see L3 — it already
produces a standing set of mediums nobody can record). If some of them are
genuinely not gate-worthy, `--skip` them by id with a comment, which is at least
a decision someone made in writing. Leaving the threshold at the default means
five of fourteen checks are documentation.

---

### M1 — A check that crashes is silent, and is still counted as run

`packages/rls-check/src/checks/index.ts:59-78`;
`packages/rls-check/src/cli.ts:84-100`

```ts
try {
    findings.push(...check.run(snapshot));
} catch {
    // Deliberately silent: report.ts owns what the user sees, and a
    // check that failed produced no findings, which is what the caller
    // is told by its absence.                                     // :70-74
}
```

The comment is the bug: absence is precisely what the caller *cannot*
distinguish from a clean database. And the count that would give it away is
recomputed rather than reported:

```ts
export function selectCheckIds(options) {          // cli.ts:93
    return CHECKS.filter(check => (only === null || only.has(check.id)) && !skip.has(check.id))
                 .map(check => check.id);
}
// stats.checksRun = selectCheckIds(options).length              // cli.ts:79
```

So `checksRun` is the number of checks *selected*, never the number that
completed. If all fourteen threw, the report reads
`Scanned 1 schema · 11 tables · 88 policies · 14 checks` /
`No findings. Every table, view and policy in scope passed all checks.` and
`rls-scan.mts` exits 0 — the vacuity floors are satisfied, because they count
tables and policies, not checks that ran.

The design decision is deliberate and even tested
(`checks/index.test.ts:91-109`, *"degrades an exploding check to a skipped
one"*), which is the tell: the test asserts silence rather than an outcome.

**Fix direction.** Have `runChecks` return `{ findings, failed: {id, error}[] }`,
carry `failed` into `ScanResult`, render it, and make `rls-scan.mts` exit 2 when
it is non-empty. Keep the resilience — thirteen findings beat a crash — but
report the loss. Same fix shape as H1, and they should land together.

---

### M2 — `rebase db push` discards the insecure-tautology category entirely

`packages/server-postgres/src/cli.ts:528-532`

```ts
const remaining = { ...drift, orphaned: kept };
if (hasDrift(remaining) && (remaining.missing.length > 0 || remaining.diverged.length > 0)) {
    logger.warn(chalk.yellow("  ⚠️  RLS policies do not match your collections:"));
    logger.warn(formatPolicyDrift({ ...remaining, orphaned: [] }));
}
```

`hasDrift` is true when *any* of the four categories is non-empty, but the
second conjunct requires `missing` or `diverged`. So when the only drift is
`insecure` — a live `auth.uid() IS NOT NULL` policy — the condition is false and
nothing is printed at all. `formatPolicyDrift` has a whole section for it
(`policy-drift.ts:335-341`) that this call site can never reach.

That is the one category `policy-drift.ts:50-61` describes as *"the one drift
that hides from every other check here"*, and its remediation text is literally
*"re-run `rebase db push` to tighten it"* — the command the user just ran.

**Failure scenario.** A project upgrades past the `policy.authenticated()` fix
and runs `rebase db push`. The regenerated policies replace the tautology, so
after the push there is nothing to report — fine. But `reconcilePolicies` runs
*after* `applyPolicies` on the same connection: if a policy failed to apply, or
if the tautology lives under a hand-written name on a managed table, the
`insecure` entry is the only signal, and it is dropped. Push exits 0.

**Fix direction.** Drop the second conjunct and let `formatPolicyDrift` decide
what to print (it already returns `""` when there is nothing). Add a
`policy-drift` test that asserts an `insecure`-only drift produces non-empty
output through the push path, not just through `formatPolicyDrift` directly.

---

### M3 — `reconcilePolicies` swallows everything and has no zero-collections guard

`packages/server-postgres/src/cli.ts:495-538`

The entire body — `loadCollections`, `connect`, `checkPolicyDrift`,
`dropOrphanedPolicies` — is inside one `try`, and the `catch` (`:536-538`) logs
`⚠️ Could not reconcile RLS policies: …` and returns. `db push` then exits 0.

This is the same shape audit 14 (H2) found in `runPolicyChecks` and which has
since been fixed there (`schema/doctor-policy-checks.ts:95-100` now returns
`"unchecked"`). The push path did not get the same treatment, and it also lacks
the zero-collections guard doctor now has (`doctor-policy-checks.ts:63-67`):
`loadCollections` returns `[]` for a path that does not resolve (it warns, it
does not throw), `checkPolicyDrift` early-returns an empty drift
(`policy-drift.ts:196-198`), `dropOrphanedPolicies` finds nothing to drop, and
push reports success.

The work being skipped is not cosmetic. Orphan cleanup is the fix for the
documented failure in the same docblock: *"editing a rule writes a new policy
and abandons the old one. Postgres ORs PERMISSIVE policies together, which makes
an abandoned grant outrank every tightening that replaced it"*. A push that
tightens a rule and silently fails to reconcile leaves the loose policy live,
and reports success.

**Fix direction.** Refuse rather than warn when `collections.length === 0`
(a `db push` that just wrote DDL from collections cannot then find zero of
them — that state is a bug, not a configuration). Narrow the `catch` so a
failure to *reconcile* after a successful *apply* is a non-zero exit, or at
minimum a distinct, loud "policies applied but NOT reconciled — superseded
policies may still be granting access" message rather than a generic warning.

---

### M4 — One RESTRICTIVE policy downgrades every `USING (true)` on the table below the gate

`packages/rls-check/src/checks/policy-always-true.ts:44-47`, `:89-98`

```ts
function restrictiveGate(snapshot, policy): string | null {
    const overlapping = snapshot.policies.find(
        p => !p.permissive && p.schema === policy.schema && p.table === policy.table &&
             (p.command === "ALL" || policy.command === "ALL" || p.command === policy.command));
    return overlapping?.name ?? null;
}
```

The match ignores the restrictive policy's **roles** and its expression. A
RESTRICTIVE policy `TO "admin_role" USING (true)` — which constrains nobody,
since it does not apply to `rebase_user` or `anon` at all — is enough to flip
every `policy-always-true` finding on that table from `critical` /`certain` to
`medium` /`heuristic`. `medium` is under the CI gate's `high` threshold, so the
finding is printed and does not fail the build.

The reasoning behind the degrade is sound ("permissive default, restrictive
gate" is a real pattern, and disappearing the finding would be worse), but a
RESTRICTIVE policy that does not apply to any exposed role cannot gate anything.

**Fix direction.** Require the restrictive policy to target at least one of the
roles the permissive one exposes — reuse `policyTargetsExposedRole` and
intersect. When it does not, keep `critical`. Add a unit test with a restrictive
policy `TO ["admin"]` asserting the finding stays critical; the current
`policy-always-true.test.ts` has no such case.

---

### M5 — A collection table owned by `rebase_user` is a total RLS bypass, reported as `medium`

`packages/rls-check/src/checks/rls-enabled-not-forced.ts:56-79`;
`packages/server-postgres/src/security/rls-enforcement.ts:180`, `:210`

`rebase_user` is created `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`
(`rls-enforcement.ts:210`) and the connection role is granted membership so it
can `SET ROLE`. So if a collection table is *owned* by `rebase_user` and FORCE
is not set — and Rebase never emits `FORCE ROW LEVEL SECURITY` for collection
tables; every `ENABLE ROW LEVEL SECURITY` site in
`generate-postgres-ddl-logic.ts` is a plain ENABLE — then **every request
bypasses every policy on that table**, because ownership exempts the session
role from non-FORCE RLS.

`rls-enabled-not-forced` lands that case in its *lowest* branch:

```ts
} else {   // owner cannot log in
    severity = "medium";
    impact = `No caller bypasses policies through ownership right now. If ${rel.owner}
              is ever granted LOGIN, or a role that can SET ROLE to it is used by an
              application, every policy on this table stops applying …`;   // :74-77
}
```

"or a role that can SET ROLE to it is used by an application" is not a
hypothetical on Rebase — it is the architecture, on every request. The check
reasons about LOGIN as the proxy for reachability and never consults
`memberOf`, which `readRoles` already computes transitively
(`introspect.ts:395-424`) and `policy-role-unreachable.isReachable` already uses
correctly (`policy-role-unreachable.ts:85-95`) — a second implementation of one
predicate, disagreeing (bug class 2).

Reachability of the state itself is **UNCONFIRMED** — I found no code path that
makes `rebase_user` a table owner; a `pg_restore` with a remapped owner or a
platform that pre-creates tables is the plausible route. The detection gap is
confirmed regardless: this is the single most catastrophic ownership arrangement
on this platform and the scanner grades it below its own CI threshold.

**Fix direction.** In the `!canLogin` branch, check whether any LOGIN role is a
member of the owner (`isReachable`, extracted and shared with
`policy-role-unreachable`) and, if so, treat it as the `canLogin` case:
`high`, with the impact naming SET ROLE. Better, extract the predicate once so
the two checks cannot disagree.

---

### M6 — Grants are read from `relacl` only: column grants and routine EXECUTE are invisible

`packages/rls-check/src/introspect.ts:543-578`, `:740-765`

`readGrants` explodes `pg_class.relacl` (and correctly falls back to
`acldefault`). It never reads `pg_attribute.attacl`. A **column-level** grant —
`GRANT SELECT (email, ssn) ON users TO anon` — leaves `relacl` empty, so
`exposedGrantees()` returns `[]`, so `rls-disabled` skips the table entirely and
reports nothing. This is not exotic: column grants are the standard way people
narrow an over-broad grant, and doing so currently makes the table *disappear*
from the scanner rather than shrink.

`readRoutines` reads `prosecdef` and `proconfig` and nothing else — no
`proacl`, no `prosrc`. So the brief's last case, *"a revoked grant that a
SECURITY DEFINER function undoes"*, is only half-covered: a SECURITY DEFINER
function whose `search_path` **is** pinned, which does
`SELECT * FROM secrets`, and which is `GRANT EXECUTE … TO PUBLIC`, produces
no finding from any of the fourteen checks. The catalogue that would show it
(`proacl`) is never read.

**Fix direction.** Union `aclexplode(a.attacl)` into `readGrants` (a
column-level privilege is a privilege on the relation for reachability
purposes; carry the column name for the finding's `target.column`, which the
`FindingTarget` type already has and nothing currently sets). Add `proacl` to
`readRoutines` and raise `security-definer-mutable-search-path` to `high` when
EXECUTE is held by an exposed role — the pinned-search_path case is then at
least visible as its own check.

---

### L1 — Foreign tables are read and checked by nothing

`packages/rls-check/src/introspect.ts:100-108`; `src/checks/util.ts:108-110`;
`src/cli.ts:42`

`SCANNED_RELKINDS` includes `'f'`, so foreign tables land in
`snapshot.relations` — but `TABLE_KINDS` is `["table", "partitioned_table"]` in
both `util.ts:108` and `cli.ts:42`, so `scannedTables()` filters them out of
every check and `stats.tables` does not count them. A `postgres_fdw` foreign
table cannot have RLS at all; granted to `anon` it is an unfiltered window onto
a remote database, and it is silently outside the scan. Either check them
(they belong in `rls-disabled`, with wording that says RLS is not available) or
exclude them from `SCANNED_RELKINDS` so the data is not collected under a
pretence.

### L2 — The e2e "one defect, one finding" contract is a hand-maintained list of 13

`packages/rls-check/test/e2e/scan.e2e.test.ts:59-73`, `:158-163`;
`.github/workflows/verify.yml:474-477`

`EXPECTED` has thirteen entries; `CHECKS` has fourteen
(`unqualified-column-in-subquery` is deliberately un-provokable, and the test at
`:224-236` documents why, well). The workflow comment claims *"its fixture
asserts that each of the fourteen checks fires on the object built to trip
it"* — an overclaim, and the kind that rots. More importantly the vacuity floor
is `expect(full.stats.checksRun).toBeGreaterThan(EXPECTED.length)`, which is
satisfied by 15 > 13 too: **a fifteenth check can be added with no fixture and
no test failure.** Derive the required set from `CHECKS` minus a named,
commented exclusion list (the same both-directions shape
`slot-render-sites.test.ts` uses), so a new check fails until it is either
covered or explicitly excused.

### L3 — The gate prints a permanent set of mediums the baseline cannot record

`tooling/scripts/rls-scan.mts:258-261`; `report.ts:224-275`

`renderReport` prints every finding; the baseline only filters `gating`
(findings at or above `--fail-on`). On the acceptance database the tables are
owned by the superuser `rebase`, so `rls-enabled-not-forced` emits a `medium`
for every table with RLS on — roughly eleven findings, every run, forever, with
no way to mark them accepted. That is exactly the ambient-noise condition
bug-class 20 describes: N ungated findings make the N+1th invisible. Either
raise `--fail-on` to `medium` and baseline them (see H5), or let the baseline
suppress non-gating findings from the rendered output too.

### L4 — "Stale baseline entry" is also printed when the finding merely dropped below the threshold

`tooling/scripts/rls-scan.mts:260-275`

`matched` is built from `gating` only. If a baselined `policy-always-true`
finding degrades to `medium` (M4's restrictive-gate path), it stops being in
`gating`, so its baseline entry is reported as *"nothing matches these any more,
so delete them"*. Deleting it removes the record of intent for a finding that is
still present. Build `matched` from `result.findings`, not `gating`.

### L5 — Tautologies outside the two recognised shapes are invisible

`packages/rls-check/src/checks/sql.ts:245-268`;
`packages/server-postgres/src/security/policy-drift.ts:160-168`

`isUnconditionalTrue` recognises `true` and `<const> = <same const>` — correctly
structural, and correctly refusing to substring-match. It does not recognise
`NOT false`, `x = x` where `x` is a column or function call (`auth.uid() =
auth.uid()`), `col IS NOT NULL` on a `NOT NULL` column, `1 > 0`, or
`true OR <anything>`. `matchTautology` recognises exactly
`<caller-id-call> IS NOT NULL` as the *entire* expression, and
`isPermissiveAuthTautology` (the drift checker's copy) is a looser
substring-plus-guard variant of the same idea — two implementations of one
predicate, in two packages, with different strictness.

These are reasonable limits for a tool that must not cry wolf, and worth
recording rather than fixing blind. The `x = x` case is the one worth adding:
it is structural, unambiguous, and it is what an unqualified-column bug
collapses to after Postgres re-qualifies it (`scan.e2e.test.ts:234` asserts
`memberships.org_id = memberships.org_id` is exactly what comes back out of
`pg_policies` — a self-comparison that no check currently flags).

---

## Checked and clean

- **`pnpm rls:check` exits non-zero on findings, and it is in CI on pull
  requests.** `tooling/scripts/rls-scan.mts:293` (`process.exit(1)`),
  `verify.yml:521-525`, `ci.yml:3-6` (`pull_request` and `push` to `main`),
  and `verify.yml` is `workflow_call`ed from both `ci.yml` and `publish.yml`, so
  the release path cannot drift from it.
- **Exit codes are never conflated.** 0 clean / 1 findings / 2 the scan did not
  happen, in both `runCli` (`cli.ts:33-37`, `:810-825` — the outer catch returns
  2, never 1) and the wrapper (`rls-scan.mts:216`, `:253`, `:293`). A connection
  failure cannot read as a clean bill of health.
- **The vacuity floors work for the two facts they cover.** `--min-tables 8
  --min-policies 40` against a database whose schema was never applied exits 2
  with a message that says so, and the `if: always()` on the step is safe
  because of it (`rls-scan.mts:237-254`).
- **`--fail-on` cannot fail open through a typo.** `rls-scan.mts` does not
  validate the value, but `severityRank` returns `-1` for an unknown severity,
  so `>= -1` matches everything and a typo gates *harder*. Only the exact string
  `none` disables the gate (`report.ts:46-51`). The `rls-check` CLI validates it
  properly (`cli.ts:273-287`).
- **A missing baseline file fails closed.** Deleting `tooling/scripts/rls-baseline.json`
  leaves `baseline = []`, so every finding becomes unexpected
  (`rls-scan.mts:177-180`). A malformed one, or an entry missing `check` /
  `target` / `reason`, exits 2 (`:183-193`). There is no regeneration script, so
  there is no way to ratchet it down without a reviewable diff carrying a
  hand-written reason.
- **Baseline keys deliberately ignore the policy name**, for the right reason,
  documented in both the script (`:152-162`) and the JSON (`$comment`) — a
  name-keyed entry would go stale on every unrelated rule edit. (The command
  being dropped alongside it is H2; the name decision itself is correct.)
- **Unknown `--only` / `--skip` ids are an error, not a silent narrowing**
  (`cli.ts:724-739`), with a hint that says exactly why. This is the class of
  bug — "a typo here silently weakens the scan" — handled correctly.
- **Introspection is read-only by construction**: `SET
  default_transaction_read_only = on` then `BEGIN READ ONLY`, plus a
  `statement_timeout`, before any catalogue query (`introspect.ts:128-131`).
- **Privileges come from `pg_class.relacl` via `aclexplode`, not
  `information_schema`** (`introspect.ts:551-558`), with the reason recorded:
  the information_schema views only show grants involving roles the caller is a
  member of, so a non-superuser scan of Supabase would miss the grants to `anon`
  entirely.
- **Role membership is a transitive fixpoint** (`introspect.ts:395-416`) and
  every reachability question goes through `rolesUsableBy`, so a shop that
  grants to `app_reader` and makes `anon` a member of it is not reported clean.
- **The privileged-scanner caveat survives `--quiet`** (`report.ts:236-242`) and
  the e2e suite asserts it appears (`scan.e2e.test.ts:308-327`).
- **Credentials never reach an output stream.** `redact.ts` is hand-rolled
  rather than `new URL()` for documented reasons, refuses to print pieces when
  the split is ambiguous (`PLAUSIBLE_HOST` / `PLAUSIBLE_DATABASE`, `:163-170`),
  and `redactSecrets` has a generic `scheme://userinfo@` pass so forgetting to
  pass the connection string degrades redaction rather than disabling it. The
  e2e asserts the password appears in neither stream in three separate places.
  No finding field carries raw `qual` text, so `--json` cannot leak a policy
  body either.
- **`RLS_CHECK_REQUIRE_DOCKER=1` turns the e2e skip into a failure in CI**
  (`scan.e2e.test.ts:38-53`, `verify.yml:497`) — the class-4 escape hatch
  `docs/bug-classes.md:104-107` names, closed.
- **The `rebase` schema is deliberately *in* scope**, with
  `introspect-schema-scope.test.ts` pinning it so re-adding it to
  `PLATFORM_SCHEMAS` is a test failure rather than a one-line diff. That test is
  the reference shape for "a security decision, pinned".
- **`checkPolicyDrift` compares against the same DDL `db push` applies**
  (`parseExpectedPolicies(generatePostgresPoliciesDdl(collections))`), not a
  reimplementation, so the two cannot drift.
- **Clause-presence comparison is genuinely valuable and correctly justified.**
  `policy-drift.test.ts:97-110` reproduces the real production case (a SELECT
  policy with `qual = NULL` matching on every other field and denying 100% of
  reads), and `:112-124` proves a Postgres-rewritten expression is not mistaken
  for a missing one.
- **`isGeneratedPolicyName` is conservative in the safe direction** — a
  hand-written policy must collide with a 7-hex digest *and* the table name to
  be dropped; `dropOrphanedPolicies` additionally refuses tables the collections
  do not describe, and all four cases have tests
  (`policy-drift.test.ts:230-315`).
- **`policy-anonymous-tautology` weighs the platform rather than firing
  uniformly**, and `matchTautology` requires the caller-id test to be the
  *entire* expression, so `auth.uid() IS NOT NULL AND user_id = auth.uid()` — a
  correct policy — is not flagged. Both schema spellings (`auth.` and
  `rebase.`) are matched, with the reason recorded.
- **`junction-table-unprotected`'s inference is narrow** (exactly two FKs, two
  distinct RLS-protected endpoints, no payload columns) and marked `heuristic`,
  and the e2e asserts `secure_project_members` is not flagged.
- **The `name[]` → `text[]` cast in `readForeignKeys`** (`introspect.ts:709`,
  `:717`) carries a comment explaining that without it node-pg hands back the
  raw literal and `junction-table-unprotected` could never fire. Exactly the
  right shape of comment.
- **Every one of the fourteen checks has a unit test file**, and thirteen have a
  `vuln_*` object in the Docker fixture with a matching negative `secure_*`
  assertion.
- **`packages/rls-check/src` and `/test` are both in `tsconfig.tests.json`
  (`:86-91`) and `tsconfig.typecheck.json` (`:178-183`)**, with docblocks
  recording that the package was previously invisible from both directions.

---

## Open questions

1. **Was `--fail-on high` a decision or a default?** Nothing in `verify.yml` or
   the baseline mentions the threshold, and five checks are inert because of
   it. If it was deliberate, the reason belongs next to the step; if it was the
   default, H5 is a one-word fix plus a baseline pass.
2. **What does the acceptance scan actually print today?** I could not run it
   (no database). My reading says ~11 standing `rls-enabled-not-forced` mediums
   plus whatever `policy-role-unreachable` produces if `rebase_user` is not a
   member of a LOGIN role in that container. Worth capturing one real log and
   deciding which of those are permanent.
3. **Can `rebase_user` ever end up owning a collection table?** M5's detection
   gap is confirmed; the reachability is not. `pg_restore` with `--role`, a
   CNPG `postInitApplicationSQL` that creates tables, and the `search_path
   "$user"` collision already recorded in the project's memory are the three
   candidates worth checking.
4. **Should `rebase doctor --policies` run `rls-check` rather than only
   `checkPolicyDrift`?** They are complementary and non-overlapping: drift
   answers "does the database match the config", `rls-check` answers "is what
   the database has actually safe". A user running doctor today gets the first
   and is never told the second exists. `rls-check` has no workspace deps, so
   importing it from the driver would cost a dependency edge — but the driver
   could shell out to `npx @rebasepro/rls-check`, or the doctor output could
   simply name the command.
5. **Does `pg_policies` ever return `qual = NULL` for a policy that has one,
   for a role lacking privileges on the table?** `readLivePolicies` treats
   `NULL` as "no clause" and the docblock asserts *"Postgres does not invent or
   drop a clause"*. That is true for `pg_policies` as I read the view
   definition, but a low-privilege scan of a table the role cannot see would be
   worth confirming empirically — the whole clause-presence comparison rests on
   it, and a false "USING: expected an expression, database has none" is the one
   way this checker could start crying wolf.
6. **Is there any RLS scanning at all for the managed/cloud tenants?**
   `rls-scan.mts` gates the acceptance database in CI. Whether anything scans a
   live tenant's database after `ensureCollectionPolicies` runs at boot is
   outside this unit's files, but it is the place H3(a) would actually bite.
