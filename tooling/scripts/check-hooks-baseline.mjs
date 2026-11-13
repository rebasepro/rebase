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
 * is one people regenerate blindly, which defeats it. One message class names
 * a line itself — "could make the dependencies of useMemo Hook (at line 305)
 * change" — so that reference is dropped from the key ({@link findingKey}): a
 * two-line edit above it read as one new finding and one fixed.
 *
 *     pnpm check:hooks            # verify
 *     pnpm check:hooks --update   # bank the current state
 *
 * ## Files that come and go
 *
 * A file deleted since the baseline was banked is reported as removed, with
 * its findings counted as fixed, and `--update` drops it. A file that vanishes
 * WHILE eslint walks the tree — a test's scratch project under
 * `packages/cli/.tmp-*`, deleted by the test that made it — used to crash the
 * whole run with ENOENT, which reported nothing about the codebase at all. It is
 * now skipped and named, and the lint is re-run without it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "tooling", "scripts", "hooks-baseline.json");
const RULE = "react-hooks/exhaustive-deps";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/**
 * `eslint.lintFiles(patterns)`, surviving files that disappear mid-walk.
 *
 * ESLint enumerates the files first and reads them later; a file deleted in
 * between rejects the whole call with ENOENT. The vanished path is added to
 * `ignorePatterns` of a fresh instance (made by `makeEslint(ignores)`) and the
 * lint re-run, up to `maxRetries` times.
 *
 * @returns {Promise<{ results: import("eslint").ESLint.LintResult[], vanished: string[] }>}
 */
export async function lintTolerantly(makeEslint, patterns, { root = ROOT, maxRetries = 20 } = {}) {
    const vanished = [];
    for (let attempt = 0; ; attempt++) {
        try {
            const results = await makeEslint(vanished).lintFiles(patterns);
            return { results, vanished };
        } catch (error) {
            const missing = error && error.code === "ENOENT" && typeof error.path === "string" ? error.path : null;
            if (!missing || attempt >= maxRetries) throw error;
            vanished.push(path.relative(root, missing).split(path.sep).join("/"));
        }
    }
}

/**
 * The baseline key of a finding: its file and its message, without the
 * "(at line N)" some messages carry, so the key never holds a line number.
 *
 * @param {string} file the file, relative to the repository root
 * @param {string} message eslint's message
 */
export function findingKey(file, message) {
    return `${file}::${message.replace(/ \(at line \d+\)/g, "")}`;
}

/**
 * Compare current findings with the banked baseline.
 *
 * `fileExists(file)` decides whether a removed site's file is gone altogether,
 * so the report can say "file deleted" instead of implying a fix in place.
 *
 * @param {Map<string, {count: number, lines: number[]}>} found
 * @param {Record<string, number>} baseline
 * @param {(file: string) => boolean} fileExists
 */
export function compareToBaseline(found, baseline, fileExists) {
    const added = [];
    const removed = [];
    for (const [key, entry] of found) {
        const was = baseline[key] ?? 0;
        if (entry.count > was) added.push({ key, was, now: entry.count, lines: entry.lines });
    }
    for (const [key, was] of Object.entries(baseline)) {
        const now = found.get(key)?.count ?? 0;
        if (now < was) removed.push({ key, was, now, deleted: !fileExists(key.split("::")[0]) });
    }
    return { added, removed };
}

/** The baseline's on-disk form for `found`: sorted keys, counts only. */
export function bankable(found) {
    return Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.count]));
}

async function main() {
    const update = process.argv.includes("--update");

    const { results, vanished } = await lintTolerantly(
        (ignores) => new ESLint({ cwd: ROOT, ignorePatterns: ignores }),
        ["."],
    );
    if (vanished.length > 0) {
        console.error(dim(`  ${vanished.length} file(s) vanished while eslint walked the tree, skipped: ${vanished.join(", ")}`));
    }
    /** @type {Map<string, {count: number, lines: number[]}>} */
    const found = new Map();
    for (const result of results) {
        const rel = path.relative(ROOT, result.filePath);
        for (const message of result.messages) {
            if (message.ruleId !== RULE) continue;
            const key = findingKey(rel, message.message);
            const entry = found.get(key) ?? { count: 0,
    lines: [] };
            entry.count += 1;
            entry.lines.push(message.line);
            found.set(key, entry);
        }
    }

    /**
     * A suppression is a finding too, unless it says why.
     *
     * The advice below is "if the narrow array is correct, say so with an
     * eslint-disable comment that gives the reason". Nothing held anyone to the
     * second half: a bare `// eslint-disable-next-line react-hooks/exhaustive-deps`
     * took a finding out of this count with no record of whether anyone decided
     * anything, and 16 of 17 had no reason. A disable carrying ESLint's own
     * description syntax (`… exhaustive-deps -- why the array is narrow`) is a
     * decision and leaves the count; one without stays in it, keyed like any other.
     */
    const UNEXPLAINED = `eslint-disable of ${RULE} with no reason (add " -- <why the array is narrow>")`;
    // A directive, not prose that mentions one: not inside a JSDoc line, and not
    // quoted in backticks.
    const DISABLE = /^(?!\s*\*)(?:.*[^`\w])?(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\s[^\n`]*react-hooks\/exhaustive-deps/;
    for (const result of results) {
        let source;
        try {
            source = fs.readFileSync(result.filePath, "utf8");
        } catch {
            continue;
        }
        if (!source.includes("exhaustive-deps")) continue;
        const rel = path.relative(ROOT, result.filePath);
        source.split("\n").forEach((text, index) => {
            if (!DISABLE.test(text) || / -- \S/.test(text)) return;
            const key = `${rel}::${UNEXPLAINED}`;
            const entry = found.get(key) ?? { count: 0, lines: [] };
            entry.count += 1;
            entry.lines.push(index + 1);
            found.set(key, entry);
        });
    }

    const total = [...found.values()].reduce((sum, e) => sum + e.count, 0);

    if (update) {
        const out = bankable(found);
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

    const { added, removed } = compareToBaseline(found, baseline, (file) => fs.existsSync(path.join(ROOT, file)));

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
            console.error(dim(`  ${r.key.split("::")[0]}  (${r.was} → ${r.now})${r.deleted ? "  — file removed" : ""}`));
        }
        if (removed.length > 10) console.error(dim(`  …and ${removed.length - 10} more`));
        console.error(dim("\n  Bank them so the ratchet tightens: pnpm check:hooks --update\n"));
    }

    console.error(`${bold("Total")} ${total} (baseline ${baselineTotal})`);
    process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
