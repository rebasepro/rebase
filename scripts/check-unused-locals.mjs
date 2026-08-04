#!/usr/bin/env node
/**
 * A ratchet for values that are computed and then thrown away.
 *
 * ## Why this is not covered already
 *
 * `@typescript-eslint/no-unused-vars` is configured, correct, and structurally
 * invisible: it reports at `warn`, and every package's `test:lint` runs eslint
 * with `--quiet`, which prints errors only. So the rule has been firing into
 * nothing. There are 3,642 suppressed warnings across the workspace, 785 of
 * them from this rule.
 *
 * ## Why only the "assigned" half
 *
 * The rule reports two different things under one name:
 *
 *   * *"'x' is defined but never used"* — an unused import or parameter. Noise.
 *     Nothing was computed; nothing is lost.
 *   * *"'x' is assigned a value but never used"* — work was done and the result
 *     discarded. That is where the bugs are, and it is the subset this gates.
 *
 * Two found in one sitting, both from this list:
 *
 *   * `useBoardDataController` read `searchStringRef.current` into
 *     `currentSearchString` in two places and used it in neither, so searching
 *     a kanban board re-subscribed every column and returned the same rows.
 *   * `CollectionViewBinding` computed `pluginErrorView` from the
 *     `collection.error` slot and rendered it nowhere, so a declared, documented
 *     plugin slot did nothing at all.
 *
 * Both look like working code. Neither is findable by reading, because the
 * missing part is an absence.
 *
 * ## Why a baseline and not a fix
 *
 * Most of the remaining 153 are superseded leftovers — a `useCallback` replaced
 * by a `Set`, a constant whose consumer moved — and deleting them is a large,
 * unrelated diff. The count was never the problem; 153 ambient findings make
 * the 154th invisible, which is exactly how the two above survived.
 *
 * Keyed on `file + variable name`, never the line number: line numbers move
 * whenever anything above them is edited, and a baseline that churns on
 * unrelated edits is one people regenerate blindly, which defeats it.
 *
 *     pnpm check:unused            # verify
 *     pnpm check:unused --update   # bank the current state
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "scripts", "unused-locals-baseline.json");
const RULE = "@typescript-eslint/no-unused-vars";
/** The half that means "work was discarded" rather than "an import is stale". */
const ASSIGNED = /is assigned a value but never used/;
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
        if (!ASSIGNED.test(message.message)) continue;
        const name = (message.message.match(/'([^']+)'/) ?? [])[1] ?? message.message;
        const key = `${rel}::${name}`;
        const entry = found.get(key) ?? { count: 0, lines: [] };
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
    console.error(dim("  Create it with: pnpm check:unused --update"));
    process.exit(1);
}

/** @type {Record<string, number>} */
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

const added = [];
const removed = [];

for (const [key, entry] of found) {
    const was = baseline[key] ?? 0;
    if (entry.count > was) added.push({ key, was, now: entry.count, lines: entry.lines });
}
for (const [key, was] of Object.entries(baseline)) {
    const now = found.get(key)?.count ?? 0;
    if (now < was) removed.push({ key, was, now });
}

if (added.length === 0 && removed.length === 0) {
    console.log(green(`✓ discarded values: ${total} finding(s), unchanged from the baseline.`));
    process.exit(0);
}

if (added.length > 0) {
    console.error(red(`\n✗ ${added.length} new discarded value(s).\n`));
    for (const a of added) {
        const [file, name] = a.key.split("::");
        console.error(`  ${bold(file)}:${a.lines.join(",")}`);
        console.error(`    '${name}' is assigned a value but never used`);
        if (a.was > 0) console.error(dim(`    (was ${a.was}, now ${a.now})`));
    }
    console.error(dim(
        "\n  Something was computed and dropped. Ask what it was for before\n" +
        "  deleting it: the two that prompted this gate were a search term and a\n" +
        "  plugin's error view, and in both cases the fix was to USE the value,\n" +
        "  not to remove it. If it really is dead, delete it rather than\n" +
        "  renaming it to `_`.\n"
    ));
}

if (removed.length > 0) {
    const fixed = removed.reduce((sum, r) => sum + (r.was - r.now), 0);
    console.error(green(`\n✓ ${fixed} finding(s) no longer occur — nice.`));
    for (const r of removed.slice(0, 10)) {
        console.error(dim(`  ${r.key.split("::")[0]}  (${r.was} → ${r.now})`));
    }
    if (removed.length > 10) console.error(dim(`  …and ${removed.length - 10} more`));
    console.error(dim("\n  Bank them so the ratchet tightens: pnpm check:unused --update\n"));
}

console.error(`${bold("Total")} ${total} (baseline ${baselineTotal})`);
process.exit(1);
