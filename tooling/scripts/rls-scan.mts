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
 *      happen. Never conflated — a DNS failure must not read as a clean bill of
 *      health.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RLS_CHECK = path.join(ROOT, "packages", "rls-check", "src");

const { explainError, scan } = await import(`${RLS_CHECK}/cli.ts`);
const { exceedsThreshold, formatTarget, renderReport } = await import(`${RLS_CHECK}/report.ts`);
const { formatEndpoint, parseConnectionString } = await import(`${RLS_CHECK}/redact.ts`);

type Severity = "info" | "low" | "medium" | "high" | "critical";

interface Finding {
    id: string;
    severity: Severity;
    title: string;
    target: { schema: string; table?: string; policy?: string; view?: string; routine?: string; column?: string };
    confidence: "certain" | "heuristic";
}

interface BaselineEntry {
    check: string;
    target: string;
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

/**
 * The key a baseline entry matches on: check id plus the object, WITHOUT the
 * policy name.
 *
 * Deliberate. A generated policy's name ends in a hash of the rule's own
 * semantics (`authors_select_841c287`), so keying on the name would invalidate
 * every entry the moment an unrelated rule was edited, and the fix for a broken
 * build would be "paste the new hash in" — which is how a baseline stops being
 * read. The intent being recorded lives at the table level: "this table is
 * public on purpose".
 */
function findingKey(finding: Finding): string {
    const t = finding.target;
    const object = t.table
        ? `${t.schema}.${t.table}`
        : t.view
            ? `${t.schema}.${t.view}`
            : t.routine
                ? `${t.schema}.${t.routine}`
                : t.schema;

    return `${finding.id} ${object}`;
}

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

const accepted = new Map(baseline.map((entry) => [`${entry.check} ${entry.target}`, entry]));

// ── Scan ─────────────────────────────────────────────────────────────────────

const target = parseConnectionString(connectionString);
const endpoint = formatEndpoint(target);

let result: {
    stats: { tables: number; policies: number; schemas: number; checksRun: number };
    findings: Finding[];
};
try {
    result = await scan({ connectionString, schemas });
} catch (error) {
    const friendly = explainError(error, { endpoint, timeoutMs: 15_000, connectionString });
    console.error(`\nrls-check could not scan ${endpoint}.`);
    console.error(`  ${friendly.headline}`);
    if (friendly.hint) console.error(`  ${friendly.hint}`);
    if (friendly.detail) console.error(`  ${friendly.detail}`);
    process.exit(2);
}

console.log(`\nrls:check  ${endpoint}  ·  ${(result as { serverVersion?: string }).serverVersion ?? "PostgreSQL"}`);
console.log("─".repeat(88));
// `quiet` drops rls-check's own header and summary — including its "Exit code 1"
// line, which is about ITS threshold, not this gate's verdict, and reading a
// stale exit code in a CI log is how people learn to distrust one. The findings
// and the privilege caveat (which survives --quiet by design) are what matter
// here; the verdict is printed below, once.
console.log(
    renderReport(result as never, {
        color: false,
        quiet: true,
        failOn,
        width: 100,
        endpoint,
        version: "workspace"
    })
);

// ── The vacuity guard, before any verdict ────────────────────────────────────
//
// Runs first and exits 2, not 1: "nothing was there to check" is a broken
// pipeline, not a clean database, and the two must never render the same.

const shortfall: string[] = [];
if (result.stats.tables < minTables) {
    shortfall.push(`${result.stats.tables} table(s), expected at least ${minTables}`);
}
if (result.stats.policies < minPolicies) {
    shortfall.push(`${result.stats.policies} policy/policies, expected at least ${minPolicies}`);
}
if (shortfall.length > 0) {
    console.error(`\n✗ Refusing to report a clean scan: ${endpoint} has ${shortfall.join(" and ")}.`);
    console.error("  A scan of a database whose schema was never applied proves nothing, so this is a");
    console.error("  setup failure (exit 2), not a pass. Check the step that pushes the schema.");
    process.exit(2);
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const gating = (result.findings as Finding[]).filter((finding) => exceedsThreshold([finding] as never, failOn));
const unexpected = gating.filter((finding) => !accepted.has(findingKey(finding)));
const matched = new Set(gating.map((finding) => findingKey(finding)));
const stale = baseline.filter((entry) => !matched.has(`${entry.check} ${entry.target}`));

console.log("─".repeat(88));
console.log(
    `Gate  ${result.stats.checksRun} checks · ${result.stats.tables} tables · ${result.stats.policies} policies · ` +
    `${gating.length} finding(s) at or above "${failOn}" · ${accepted.size} baselined`
);

if (stale.length > 0) {
    // A warning, not a failure: a baseline entry that no longer matches means
    // the database got SAFER (or the table is gone). Failing the build for that
    // would make a security improvement look like a regression.
    console.log("\nStale baseline entries — nothing matches these any more, so delete them:");
    for (const entry of stale) console.log(`  · ${entry.check} on ${entry.target}`);
}

if (unexpected.length === 0) {
    console.log(`\n✓ No unexpected RLS findings at or above "${failOn}".`);
    process.exit(0);
}

console.error(`\n✗ ${unexpected.length} RLS finding(s) at or above "${failOn}" are not in the baseline:\n`);
for (const finding of unexpected) {
    console.error(`  [${finding.severity}] ${finding.id}  ${formatTarget(finding.target)}`);
    console.error(`      ${finding.title}`);
}
console.error(`
  Each one is either a real defect in the generated policies or an access level
  the collections declare on purpose. If it is deliberate, add it to
  ${path.relative(ROOT, baselinePath ?? DEFAULT_BASELINE)} with a reason — the reason is the
  point of the file. If it is not, fix the collection or the generator.
`);
process.exit(1);

// ── helpers ──────────────────────────────────────────────────────────────────

function die(message: string): never {
    console.error(`rls:check — ${message}`);
    process.exit(2);
}
