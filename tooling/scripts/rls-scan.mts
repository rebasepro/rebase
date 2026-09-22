/**
 * The CI gate around `packages/rls-check`.
 *
 * The checker itself has been in this repo, with a `rls-check` bin and fourteen
 * checks, and ran in no pipeline at all — so the one thing it exists to catch
 * (a generated policy that grants more than the collection asked for) could
 * only be caught by a human remembering to run it. This is the wrapper that
 * makes it a gate instead of a tool.
 *
 * Three things it adds over `npx rls-check <url>`:
 *
 *   1. A baseline. The reference app deliberately declares
 *      `{ operation: "select", access: "public" }`, so its generated SELECT
 *      policies really are `USING (true)` and rls-check really should say so.
 *      Those findings are listed, per table, with a reason. Anything NOT in the
 *      list fails the build — including the same check on a NEW table, which is
 *      exactly the "someone added a collection and did not think about access"
 *      case.
 *
 *   2. A vacuity guard. A gate that passes because the database was empty is
 *      worse than no gate: it reports safety it never established. `--min-tables`
 *      and `--min-policies` make "the schema was never applied" exit 2 (setup
 *      failure) rather than 0 (clean). This is why the CI step can safely use
 *      `if: always()` — if the push step before it failed, this fails loudly
 *      instead of passing on an empty database.
 *
 *   3. Exit codes a pipeline can read: 0 clean, 1 findings, 2 the scan did not
 *      happen — or happened only in part, because a catalogue read failed and
 *      the checks that depended on it saw nothing. Never conflated — a DNS
 *      failure must not read as a clean bill of health.
 *
 * The verdict itself is `rls-gate.mjs`, a pure function with its own tests.
 *
 * Usage:
 *
 *     pnpm rls:check                                   # $DATABASE_URL
 *     pnpm rls:check "postgres://user:pw@host/db"
 *     pnpm rls:check --baseline none --fail-on medium  # audit a database of your own
 *
 * It imports rls-check by PATH, not by package name: inside a git worktree
 * `@rebasepro/rls-check` resolves through node_modules into the primary
 * checkout, so a package-name import would scan with the wrong code. Same
 * reason `tooling/scripts/verify-selfhost.mts` does it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Types only, so erased at runtime: the by-path rule below is about which CODE runs.
import type { DbPolicy, Finding, ScanResult, Severity } from "../../packages/rls-check/src/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RLS_CHECK = path.join(ROOT, "packages", "rls-check", "src");

const { explainError, selectCheckIds } = await import(`${RLS_CHECK}/cli.ts`);
const { introspectWithDiagnostics } = await import(`${RLS_CHECK}/introspect.ts`);
const { runChecks } = await import(`${RLS_CHECK}/checks/index.ts`);
const { exceedsThreshold, formatTarget, renderReport } = await import(`${RLS_CHECK}/report.ts`);
const { formatEndpoint, parseConnectionString } = await import(`${RLS_CHECK}/redact.ts`);
const { findingKey, verdict } = await import("./rls-gate.mjs");

interface BaselineEntry {
    check: string;
    target: string;
    /** The policy's command, for a finding about a policy. See `findingKey` in rls-gate.mjs. */
    command?: string;
    reason: string;
}

const DEFAULT_BASELINE = path.join(ROOT, "tooling", "scripts", "rls-baseline.json");

const HELP = `rls:check — run packages/rls-check against a database and gate on the result.

Usage
  pnpm rls:check [connection-string] [options]

The connection string comes from the argument, then $RLS_CHECK_DATABASE_URL,
then $DATABASE_URL.

Options
  --baseline <path|none>  Accepted findings. Default: tooling/scripts/rls-baseline.json.
  --fail-on <severity>    info, low, medium, high, critical or none. Default: high.
  --schema <name>         Restrict to a schema. Repeatable or comma-separated.
  --min-tables <n>        Exit 2 if the scan saw fewer tables. Default: 1.
  --min-policies <n>      Exit 2 if the scan saw fewer policies. Default: 1.

Exit codes
  0  No finding at or above --fail-on that is not baselined.
  1  Findings that are not baselined.
  2  The scan did not happen, or the database was too empty to prove anything.
`;

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
let connectionArg: string | null = null;
let baselinePath: string | null = DEFAULT_BASELINE;
let failOn: Severity | "none" = "high";
let minTables = 1;
let minPolicies = 1;
const schemas: string[] = [];

for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const take = (): string => {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined) die(`${flag} needs a value.`);

        return value;
    };

    switch (flag) {
        case "--baseline": {
            const value = take();
            baselinePath = value === "none" ? null : path.resolve(process.cwd(), value);
            break;
        }
        case "--fail-on":
            failOn = take() as Severity | "none";
            break;
        case "--schema":
            schemas.push(...take().split(",").map((s) => s.trim()).filter(Boolean));
            break;
        case "--min-tables":
            minTables = Number(take());
            break;
        case "--min-policies":
            minPolicies = Number(take());
            break;
        case "-h":
        case "--help":
            console.log(HELP);
            process.exit(0);
            break;
        default:
            if (flag.startsWith("-")) die(`Unknown option: ${flag}. Run --help.`);
            connectionArg = arg;
    }
}

const connectionString = connectionArg ?? process.env.RLS_CHECK_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (connectionString.trim().length === 0) {
    die("No connection string. Pass one, or set $RLS_CHECK_DATABASE_URL or $DATABASE_URL.");
}
if (!Number.isFinite(minTables) || !Number.isFinite(minPolicies)) {
    die("--min-tables and --min-policies take a number.");
}

// ── Baseline ─────────────────────────────────────────────────────────────────

// How an entry matches a finding — check, object and, for a policy, its
// command — is `findingKey` in rls-gate.mjs.

let baseline: BaselineEntry[] = [];
if (baselinePath !== null) {
    if (!fs.existsSync(baselinePath)) {
        if (baselinePath !== DEFAULT_BASELINE) die(`No baseline file at ${baselinePath}.`);
    } else {
        let parsed: { accepted?: BaselineEntry[] };
        try {
            parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
        } catch (error) {
            die(`${baselinePath} is not valid JSON: ${(error as Error).message}`);
            throw error; // unreachable; narrows for TS
        }
        baseline = parsed.accepted ?? [];
        for (const entry of baseline) {
            if (!entry.check || !entry.target || !entry.reason) {
                die(`Every baseline entry needs "check", "target" and "reason". Offending entry: ${JSON.stringify(entry)}`);
            }
        }
    }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

const target = parseConnectionString(connectionString);
const endpoint = formatEndpoint(target);

// Not rls-check's `scan()`: its result drops the snapshot, and the baseline
// key needs each finding's policy command, which only the snapshot has. The
// rest is what `scan()` does — introspect with diagnostics, run every check,
// and assemble the result the report renders.
let result: ScanResult;
let policies: DbPolicy[];
try {
    const { snapshot, diagnostics } = await introspectWithDiagnostics({
        connectionString,
        schemas: schemas.length > 0 ? schemas : undefined,
        statementTimeoutMs: 15_000
    });
    const tables = snapshot.relations.filter(
        (relation: { kind: string }) => relation.kind === "table" || relation.kind === "partitioned_table"
    );
    policies = snapshot.policies;
    result = {
        scannedAt: new Date().toISOString(),
        database: { host: target?.host ?? "unknown", name: target?.database || "unknown" },
        serverVersion: snapshot.serverVersion,
        platform: snapshot.platform,
        scannerIsPrivileged: snapshot.scannerIsPrivileged,
        exposedRoles: snapshot.exposedRoles,
        stats: {
            schemas: snapshot.schemas.length,
            tables: tables.length,
            policies: snapshot.policies.length,
            tablesWithoutRls: tables.filter((relation: { rlsEnabled: boolean }) => !relation.rlsEnabled).length,
            checksRun: selectCheckIds({}).length
        },
        findings: runChecks(snapshot),
        diagnostics
    };
} catch (error) {
    const friendly = explainError(error, { endpoint, timeoutMs: 15_000, connectionString });
    console.error(`\nrls-check could not scan ${endpoint}.`);
    console.error(`  ${friendly.headline}`);
    if (friendly.hint) console.error(`  ${friendly.hint}`);
    if (friendly.detail) console.error(`  ${friendly.detail}`);
    process.exit(2);
}

console.log(`\nrls:check  ${endpoint}  ·  ${result.serverVersion}`);
console.log("─".repeat(88));
// `quiet` drops rls-check's own header and summary — including its "Exit code 1"
// line, which is about ITS threshold, not this gate's verdict, and reading a
// stale exit code in a CI log is how people learn to distrust one. The findings
// and the privilege caveat (which survives --quiet by design) are what matter
// here; the verdict is printed below, once.
console.log(
    renderReport(result, {
        color: false,
        quiet: true,
        failOn,
        width: 100,
        endpoint,
        version: "workspace"
    })
);

// ── Verdict ──────────────────────────────────────────────────────────────────

const outcome = verdict({
    stats: result.stats,
    findings: result.findings,
    diagnostics: result.diagnostics,
    policies,
    baseline,
    isGating: (finding: Finding) => exceedsThreshold([finding], failOn),
    minTables,
    minPolicies
});

// The vacuity guard, before any verdict. Exits 2, not 1: "nothing was there to
// check" is a broken pipeline, not a clean database, and the two must never
// render the same.
if (outcome.shortfall.length > 0) {
    console.error(`\n✗ Refusing to report a clean scan: ${endpoint} has ${outcome.shortfall.join(" and ")}.`);
    console.error("  A scan of a database whose schema was never applied proves nothing, so this is a");
    console.error("  setup failure (exit 2), not a pass. Check the step that pushes the schema.");
    process.exit(2);
}

// Same exit, same reason: a check whose catalogue read failed returns no
// findings, so "none unexpected" would be an answer to a question the scan
// never managed to ask. rls-check's own CLI exits 2 here too.
if (outcome.degraded.length > 0) {
    console.error(`\n✗ Refusing to report a clean scan: ${outcome.degraded.length} catalogue read(s) failed on ${endpoint}.`);
    for (const { what, error } of outcome.degraded) console.error(`  · ${what}: ${error}`);
    console.error("  The checks that depend on them saw nothing, which is not the same as finding nothing.");
    process.exit(2);
}

console.log("─".repeat(88));
console.log(
    `Gate  ${result.stats.checksRun} checks · ${result.stats.tables} tables · ${result.stats.policies} policies · ` +
    `${outcome.gating.length} finding(s) at or above "${failOn}" · ${baseline.length} baselined`
);

if (outcome.stale.length > 0) {
    // A warning, not a failure: a baseline entry that no longer matches means
    // the database got SAFER (or the table is gone). Failing the build for that
    // would make a security improvement look like a regression.
    console.log("\nStale baseline entries — nothing matches these any more, so delete them:");
    for (const entry of outcome.stale) {
        console.log(`  · ${entry.check} on ${entry.target}${entry.command ? ` (${entry.command})` : ""}`);
    }
}

if (outcome.code === 0) {
    console.log(`\n✓ No unexpected RLS findings at or above "${failOn}".`);
    process.exit(0);
}

console.error(`\n✗ ${outcome.unexpected.length} RLS finding(s) at or above "${failOn}" are not in the baseline:\n`);
for (const finding of outcome.unexpected) {
    console.error(`  [${finding.severity}] ${finding.id}  ${formatTarget(finding.target)}`);
    console.error(`      ${finding.title}`);
    console.error(`      baseline key: ${findingKey(finding, policies)}`);
}
console.error(`
  Each one is either a real defect in the generated policies or an access level
  the collections declare on purpose. If it is deliberate, add it to
  ${path.relative(ROOT, baselinePath ?? DEFAULT_BASELINE)} with a reason — the reason is the
  point of the file — and, for a policy, its "command". If it is not, fix the
  collection or the generator.
`);
process.exit(1);

// ── helpers ──────────────────────────────────────────────────────────────────

function die(message: string): never {
    console.error(`rls:check — ${message}`);
    process.exit(2);
}
