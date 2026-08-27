#!/usr/bin/env node
/**
 * A ratchet for user-facing English that already has a translation.
 *
 * The admin ships seven non-English locales. `packages/app/src/locales/en.ts`
 * declares 818 keys, every one of them present in `de`, `es`, `fr`, `it`, `hi`
 * and `pt` — and 200-odd of those strings are *also* written out as English
 * literals in the admin's source, where no translation can reach them. A
 * German panel renders them in English.
 *
 * Found by looking at the running app: a product card whose image was missing
 * said "File not found", and `file_not_found` is translated seven ways.
 *
 * ## What counts
 *
 * A line that contains the exact English value of a declared key, and does not
 * itself call `t(`. The second half matters: `t("fix_errors") ?? "Fix errors"`
 * is a translated string with an English default, which is correct, and a
 * check that flagged it would be one nobody could act on.
 *
 * Comment lines are skipped — a comment quoting the string it is about is not a
 * rendered string, and this file's own docblock would otherwise be a finding.
 *
 * ## Why a baseline
 *
 * Two hundred call sites cannot be converted mechanically: `t` has to be in
 * scope, which for a hook is a code change and for a non-component module
 * (`form/validation.ts`) is a design decision about where the string belongs.
 * The count was never the problem — 209 ambient findings make the 210th
 * invisible, and the 210th arrives every time somebody types a message inline
 * instead of adding a key.
 *
 *     pnpm check:untranslated
 *     pnpm check:untranslated --update
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "tooling", "scripts", "untranslated-baseline.json");
const EN = path.join(ROOT, "packages/app/src/locales/en.ts");
const SCANNED = ["packages/cms/src"];
const update = process.argv.includes("--update");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/** Declared keys whose English value is long enough to be worth matching. */
function translatedStrings() {
    const source = fs.readFileSync(EN, "utf8");
    return [...source.matchAll(/^\s{4}([a-z0-9_]+):\s*"((?:[^"\\]|\\.){8,80})",?\s*$/gm)]
        .map(m => ({ key: m[1], value: m[2] }))
        // Interpolated strings are templates, not literals anyone types out.
        .filter(entry => !entry.value.includes("{"));
}

function sourceFiles(dir) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (!/node_modules|locales/.test(full)) walk(full);
            } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                out.push(full);
            }
        }
    };
    walk(abs);
    return out;
}

const strings = translatedStrings();
/** @type {Map<string, number>} keyed on `file::key`, never the line number. */
const found = new Map();

for (const file of SCANNED.flatMap(sourceFiles)) {
    const rel = path.relative(ROOT, file);
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        // Already translated on this line, `?? "English"` fallback included.
        if (line.includes("t(\"")) continue;
        for (const { key, value } of strings) {
            if (line.includes(`"${value}"`) || line.includes(`>${value}<`)) {
                const id = `${rel}::${key}`;
                found.set(id, (found.get(id) ?? 0) + 1);
                break;
            }
        }
    }
}

const total = [...found.values()].reduce((a, b) => a + b, 0);

if (update) {
    const out = Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(green(`✓ Baseline updated: ${total} untranslated string(s) across ${found.size} site(s).`));
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error(red(`No baseline at ${path.relative(ROOT, BASELINE)}.`));
    console.error(dim("  Create it with: pnpm check:untranslated --update"));
    process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const added = [];
const removed = [];
for (const [id, count] of found) {
    const was = baseline[id] ?? 0;
    if (count > was) added.push({ id, was, now: count });
}
for (const [id, was] of Object.entries(baseline)) {
    const now = found.get(id) ?? 0;
    if (now < was) removed.push({ id, was, now });
}

if (added.length === 0 && removed.length === 0) {
    console.log(green(`✓ untranslated strings: ${total}, unchanged from the baseline.`));
    process.exit(0);
}

if (added.length > 0) {
    console.error(red(`\n✗ ${added.length} new untranslated string(s) that already have a key.\n`));
    for (const a of added) {
        const [file, key] = a.id.split("::");
        console.error(`  ${bold(file)}`);
        console.error(`    the English value of \`${key}\` is written out here`);
    }
    console.error(dim(
        "\n  The key exists and is translated into seven locales, so this renders\n" +
        "  English in all of them. Use `t(\"<key>\")` — with `?? \"English\"` if a\n" +
        "  default is wanted, which this check accepts.\n"
    ));
}

if (removed.length > 0) {
    console.error(green(`\n✓ ${removed.reduce((s, r) => s + (r.was - r.now), 0)} no longer occur — nice.`));
    console.error(dim("\n  Bank them so the ratchet tightens: pnpm check:untranslated --update\n"));
}

console.error(`${bold("Total")} ${total}`);
process.exit(1);
