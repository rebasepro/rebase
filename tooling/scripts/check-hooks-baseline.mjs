#!/usr/bin/env node
/**
 * A ratchet for `react-hooks/exhaustive-deps`.
 *
 * ## Why a baseline and not a fix
 *
 * There are 183 of these. Each is a *candidate* stale-closure bug and none can
 * be resolved mechanically — adding the missing dependency is as likely to be
 * the bug as the fix. Two real examples from this repo:
 *
 *   * `VirtualTableInput` syncs `internalValue` from `value` and reads
 *     `internalValue` inside an effect keyed only on `value`. Adding the
 *     dependency makes the effect re-run on every keystroke and breaks the
 *     debounced write. The narrow array is correct.
 *   * `useDataTableController` omits `collection`, which is only ever stale if
 *     a collection's *config* changes without its path changing — reachable
 *     from the schema editor, invisible otherwise.
 *
 * So the count is not the problem. The problem is that 183 ambient warnings
 * make the 184th invisible: nobody reads a list that long, so a genuinely new
 * stale closure arrives silently. That is the same failure this repo has hit
 * repeatedly — a gate whose output is too noisy to act on reports nothing.
 *
 * This makes the number a ratchet. New findings fail. Fixed findings also fail,
 * asking you to bank them, which is what stops the baseline from quietly
 * describing a codebase that no longer exists.
 *
 * ## Keys
 *
 * Keyed on `file + message`, never the line number. The message names the
 * dependencies, so it identifies the finding; line numbers move whenever
 * anything above them is edited, and a baseline that churns on unrelated edits
 * is one people regenerate blindly, which defeats it.
 *
 *     pnpm check:hooks            # verify
 *     pnpm check:hooks --update   # bank the current state
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "tooling", "scripts", "hooks-baseline.json");
const RULE = "react-hooks/exhaustive-deps";
const update = process.argv.includes("--update");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const eslint = new ESLint({ cwd: ROOT });
const results = await eslint.lintFiles(["."]);

/** @type {Map<string, {count: number, lines: number[]}>} */
const found = new Map();
for (const result of results) {
    const rel = path.relative(ROOT, result.filePath);
    for (const message of result.messages) {
        if (message.ruleId !== RULE) continue;
        const key = `${rel}::${message.message}`;
        const entry = found.get(key) ?? { count: 0,
lines: [] };
        entry.count += 1;
        entry.lines.push(message.line);
        found.set(key, entry);
    }
}

const total = [...found.values()].reduce((sum, e) => sum + e.count, 0);

if (update) {
    const out = Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, v.count]));
    fs.writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(green(`✓ Baseline updated: ${total} finding(s) across ${found.size} site(s).`));
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error(red(`No baseline at ${path.relative(ROOT, BASELINE)}.`));
    console.error(dim("  Create it with: pnpm check:hooks --update"));
    process.exit(1);
}

/** @type {Record<string, number>} */
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

const added = [];
const removed = [];

for (const [key, entry] of found) {
    const was = baseline[key] ?? 0;
    if (entry.count > was) added.push({ key,
was,
now: entry.count,
lines: entry.lines });
}
for (const [key, was] of Object.entries(baseline)) {
    const now = found.get(key)?.count ?? 0;
    if (now < was) removed.push({ key,
was,
now });
}

if (added.length === 0 && removed.length === 0) {
    console.log(green(`✓ ${RULE}: ${total} finding(s), unchanged from the baseline.`));
    process.exit(0);
}

if (added.length > 0) {
    console.error(red(`\n✗ ${added.length} new ${RULE} finding(s).\n`));
    for (const a of added) {
        const [file, message] = a.key.split("::");
        console.error(`  ${bold(file)}:${a.lines.join(",")}`);
        console.error(`    ${message}`);
        if (a.was > 0) console.error(dim(`    (was ${a.was}, now ${a.now})`));
    }
    console.error(dim(
        "\n  Each of these is a candidate stale closure. Adding the dependency is\n" +
        "  not automatically the fix — decide, and if the narrow array is correct,\n" +
        "  say so with an eslint-disable comment that gives the reason.\n"
    ));
}

if (removed.length > 0) {
    const fixed = removed.reduce((sum, r) => sum + (r.was - r.now), 0);
    console.error(green(`\n✓ ${fixed} finding(s) no longer occur — nice.`));
    for (const r of removed.slice(0, 10)) {
        console.error(dim(`  ${r.key.split("::")[0]}  (${r.was} → ${r.now})`));
    }
    if (removed.length > 10) console.error(dim(`  …and ${removed.length - 10} more`));
    console.error(dim("\n  Bank them so the ratchet tightens: pnpm check:hooks --update\n"));
}

console.error(`${bold("Total")} ${total} (baseline ${baselineTotal})`);
process.exit(1);
