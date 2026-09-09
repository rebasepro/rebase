#!/usr/bin/env node
/**
 * Is TypeScript 7 adoptable yet?
 *
 * Not a gate — it fails nothing and blocks nothing. It answers a question that
 * otherwise costs an afternoon, and that gets asked again every few months.
 *
 * The trap it exists for: **`pnpm typecheck` passes under TS 7 today.** It did
 * on 2026-07-29 and it still does on 2026-09-09, which makes TS 7 look adoptable
 * right up until you run the lint, the tests or the build. Judging readiness by
 * the typechecker alone is the mistake this script is here to stop somebody
 * making a third time.
 *
 * Four independent things have to be true, and the first three are other
 * people's release schedules:
 *
 *   1. `typescript-eslint` accepts TS 7   (tracking: typescript-eslint#10940,
 *      support targeted at TS >= 7.1)
 *   2. `ts-jest` accepts TS 7             (peer has been `>=4.3 <7`)
 *   3. `typedoc` accepts TS 7             (peer has capped at 6.0.x)
 *   4. The compiler-API consumers here are ported. TS 7 maps its stable entry
 *      `"."` to `./lib/version.cjs` — the version string, nothing else. The real
 *      API moved to `typescript/unstable/*`, a namespace the TS team marks
 *      unstable on purpose. Every `import ts from "typescript"` in this repo is
 *      a file that stops compiling the day we switch.
 *
 * Usage: `pnpm ts7:readiness`. Registry lookups need network; without it the
 * script says so per-check rather than guessing, because a guess here is the
 * whole problem.
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

/** One `npm view` call, or null when the registry cannot be reached. */
function npmView(spec, field) {
    try {
        const out = execFileSync("npm", ["view", spec, field, "--json"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 30_000
        }).trim();
        if (!out) return null;
        const parsed = JSON.parse(out);
        // `npm view <pkg> <field> --json` answers with a one-element ARRAY when
        // the package has more than one version matching the (implicit) range,
        // and with the bare value otherwise. Reading `.latest` off the array
        // gives `undefined`, which this script would then report as "registry
        // unreachable" — a wrong answer that looks like a network problem.
        return Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
    } catch {
        return null;
    }
}

/**
 * Does a semver range admit any 7.x?
 *
 * Deliberately a text test rather than a semver parse: these ranges are written
 * to *exclude* 7 (`<7`, `<6.1.0`, an explicit `x.y.x` list), so the question is
 * whether the author has opened the door, and a cheap check that errs toward
 * "still closed" is the right bias for a readiness report.
 */
function admitsSeven(range) {
    if (!range) return null;
    if (/<\s*7|<\s*6|<\s*5/.test(range)) return false;
    // A major 7, not a *minor* one. `5.0.x || … || 5.7.x || … || 6.0.x` is
    // typedoc's real range and contains the substring "7." twice — matching it
    // naively reported typedoc as TS 7-ready, which is the opposite of true.
    const majorSeven = /(?<![\d.])7\./;
    if (/\|\|/.test(range) && !majorSeven.test(range)) return false;
    return majorSeven.test(range) || /^\s*\*\s*$/.test(range);
}

const checks = [];
function record(name, ok, detail) {
    checks.push({ name, ok, detail });
    const mark = ok === true ? `${GREEN}✓${OFF}` : ok === false ? `${RED}✗${OFF}` : `${YELLOW}?${OFF}`;
    console.log(`  ${mark} ${name}`);
    if (detail) console.log(`      ${DIM}${detail}${OFF}`);
}

console.log(`\n${BOLD}TypeScript 7 readiness${OFF}\n`);

// ── what we are on, and what exists ──────────────────────────────────────
const rootPkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const declared = rootPkg.devDependencies?.typescript ?? "(none)";
const tags = npmView("typescript", "dist-tags");
const latest = tags?.latest ?? "(registry unreachable)";
const next = tags?.next ?? "";
console.log(`  ${DIM}this repo: ${declared}   npm latest: ${latest}${next ? `   next: ${next}` : ""}${OFF}\n`);

// The condition the previous investigation said to wait for.
const sevenOneShipped = tags ? /^7\.[1-9]/.test(String(tags.latest)) : null;
record(
    "TypeScript 7.1 released",
    sevenOneShipped,
    sevenOneShipped === false
        ? `latest is ${tags.latest}; typescript-eslint targets support at >= 7.1`
        : sevenOneShipped === null ? "registry unreachable" : ""
);

// ── the three consumers that gate the toolchain ──────────────────────────
for (const [pkg, field] of [
    ["typescript-eslint", "peerDependencies.typescript"],
    ["ts-jest", "peerDependencies.typescript"],
    ["typedoc", "peerDependencies.typescript"]
]) {
    const range = npmView(pkg, field);
    const ok = range === null ? null : admitsSeven(range);
    record(
        `${pkg} accepts TS 7`,
        ok,
        range === null ? "registry unreachable" : `peer typescript: ${range}`
    );
}

// ── the compiler API, which is ours to fix ───────────────────────────────
let consumers = [];
try {
    const out = execFileSync("git", [
        "grep", "-l", "-E",
        String.raw`(from ["']typescript["']|require\(["']typescript["']\))`,
        "--", "packages", "tooling"
    ], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    consumers = out.split("\n").filter(Boolean);
} catch {
    // `git grep` exits 1 when nothing matches, which is the good case.
}
const byKind = { src: [], test: [], tooling: [] };
for (const f of consumers) {
    if (/\.test\.|\/test\//.test(f)) byKind.test.push(f);
    else if (f.startsWith("tooling/")) byKind.tooling.push(f);
    else byKind.src.push(f);
}
record(
    "no direct compiler-API consumers",
    consumers.length === 0,
    consumers.length === 0
        ? ""
        : `${consumers.length} file(s) import "typescript" — ${byKind.src.length} src, `
          + `${byKind.test.length} test, ${byKind.tooling.length} tooling. `
          + `TS 7 serves only the version string from "."; these need typescript/unstable/*.`
);
if (byKind.src.length) {
    console.log(`      ${DIM}build-critical: ${byKind.src.join(", ")}${OFF}`);
}

// ── prep that is already done, and must stay done ────────────────────────
let withBaseUrl = [];
try {
    const out = execFileSync("git", ["grep", "-l", '"baseUrl"', "--", "*tsconfig*.json"], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    });
    withBaseUrl = out.split("\n").filter(Boolean);
} catch {
    // no matches
}
record(
    "no tsconfig declares baseUrl",
    withBaseUrl.length === 0,
    withBaseUrl.length === 0
        ? "already migrated to relative paths — backward-compatible, keep it that way"
        : `${withBaseUrl.length} file(s): ${withBaseUrl.slice(0, 3).join(", ")} — TS 7 refuses these (TS5102/TS5090)`
);

// ── verdict ──────────────────────────────────────────────────────────────
const blocked = checks.filter(c => c.ok === false);
const unknown = checks.filter(c => c.ok === null);
console.log();
if (blocked.length === 0 && unknown.length === 0) {
    console.log(`${GREEN}✓ Nothing known is blocking TS 7. Try it — and run the lint, the tests`);
    console.log(`  and a build, not just the typechecker.${OFF}\n`);
} else {
    console.log(`${RED}✗ TS 7 is not adoptable: ${blocked.length} blocker(s)${OFF}`
        + (unknown.length ? `${YELLOW}, ${unknown.length} unknown${OFF}` : ""));
    for (const c of blocked) console.log(`    ${RED}·${OFF} ${c.name}`);
    for (const c of unknown) console.log(`    ${YELLOW}·${OFF} ${c.name} (could not check)`);
    console.log(`\n  ${DIM}Note: \`pnpm typecheck\` passes under TS 7 regardless. That is not the test.${OFF}\n`);
}

// Informational: never fails a pipeline.
process.exit(0);
