#!/usr/bin/env node
/**
 * A ratchet over the casts that step around the type system, in package source.
 *
 * AGENTS.md: never convert to `any`, and never cast structurally around a type.
 * ESLint enforces `no-explicit-any` in three packages and nothing counts the
 * rest, so the rule held where it was enforced and drifted where it was not:
 * over September, in non-test source, `as never` went 60 → 74 and `as any`
 * 12 → 16, while `as unknown as` fell 218 → 53 in a cleanup nobody could bank.
 *
 * So the counts are pinned per package and per kind, in
 * tooling/scripts/casts-baseline.json. A count that grows fails: write the
 * type, or narrow (`isSQLAdmin` and friends), instead of casting. A count that
 * shrinks also fails, asking for the baseline to be banked, so the next cast
 * cannot quietly spend the room a cleanup made.
 *
 * Source only: `packages/<name>/src`, minus tests (`*.test.*`, `*.spec.*`,
 * `__tests__`, `test/`) and declaration files. Counted per line of text, so a
 * cast in a comment counts too — the cheap direction to be wrong in.
 *
 *     pnpm check:casts            # verify
 *     pnpm check:casts --update   # bank the current counts
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "tooling", "scripts", "casts-baseline.json");

/** Each kind of cast, and the pattern that finds it. */
export const KINDS = {
    "as any": /\bas\s+any\b/g,
    "as never": /\bas\s+never\b/g,
    "as unknown as": /\bas\s+unknown\s+as\b/g
};

/** Whether a repository path is package source this ratchet counts. */
export function isCountedSource(file) {
    if (!/^packages\/[^/]+\/src\//.test(file)) return false;
    if (!/\.(ts|tsx|mts|cts)$/.test(file) || /\.d\.(ts|mts|cts)$/.test(file)) return false;
    if (/\.(test|spec)\.[cm]?tsx?$/.test(file)) return false;
    if (/(^|\/)(__tests__|test|tests)\//.test(file.slice(file.indexOf("/src/")))) return false;
    return true;
}

/** `{ "<package>": { "<kind>": n } }` for the given files' contents, zero counts omitted. */
export function countCasts(files) {
    const counts = {};
    for (const { file, text } of files) {
        const pkg = file.split("/")[1];
        for (const [kind, pattern] of Object.entries(KINDS)) {
            const n = text.match(pattern)?.length ?? 0;
            if (n === 0) continue;
            counts[pkg] ??= {};
            counts[pkg][kind] = (counts[pkg][kind] ?? 0) + n;
        }
    }
    return sortDeep(counts);
}

/** Every package/kind whose count differs from the baseline, as grown and shrunk. */
export function compare(found, baseline) {
    const grown = [];
    const shrunk = [];
    const packages = new Set([...Object.keys(found), ...Object.keys(baseline)]);
    for (const pkg of [...packages].sort()) {
        for (const kind of Object.keys(KINDS)) {
            const was = baseline[pkg]?.[kind] ?? 0;
            const now = found[pkg]?.[kind] ?? 0;
            if (now > was) grown.push({ pkg, kind, was, now });
            if (now < was) shrunk.push({ pkg, kind, was, now });
        }
    }
    return { grown, shrunk };
}

function sortDeep(counts) {
    return Object.fromEntries(Object.keys(counts).sort().map((pkg) => [
        pkg,
        Object.fromEntries(Object.keys(counts[pkg]).sort().map((kind) => [kind, counts[pkg][kind]]))
    ]));
}

function main() {
    const files = execFileSync("git", ["ls-files", "packages"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter(isCountedSource)
        .filter((file) => fs.existsSync(path.join(ROOT, file)))
        .map((file) => ({ file, text: fs.readFileSync(path.join(ROOT, file), "utf8") }));
    if (files.length === 0) {
        console.error("✗ check:casts found no package source to count — the file walk is broken.");
        process.exit(1);
    }
    const found = countCasts(files);

    if (process.argv.includes("--update")) {
        fs.writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
        console.log(`✓ Banked the cast counts of ${Object.keys(found).length} package(s).`);
        return;
    }
    if (!fs.existsSync(BASELINE)) {
        console.error(`✗ No baseline at ${path.relative(ROOT, BASELINE)}. Create it with: pnpm check:casts --update`);
        process.exit(1);
    }
    const { grown, shrunk } = compare(found, JSON.parse(fs.readFileSync(BASELINE, "utf8")));
    if (grown.length === 0 && shrunk.length === 0) {
        console.log(`✓ Casts in package source unchanged from the baseline (${files.length} files).`);
        return;
    }
    for (const { pkg, kind, was, now } of grown) {
        console.error(`✗ packages/${pkg}: \`${kind}\` ${was} → ${now}`);
    }
    if (grown.length > 0) {
        console.error(`
  A cast that steps around the type system hides the drift the types exist to
  catch. Write the type, or narrow it (driver.admin with isSQLAdmin, an unknown
  with a type guard), instead. Run \`git diff -U0 | grep -E "as (any|never|unknown as)"\`
  to find the new one.`);
    }
    for (const { pkg, kind, was, now } of shrunk) {
        console.error(`✓ packages/${pkg}: \`${kind}\` ${was} → ${now}`);
    }
    if (shrunk.length > 0) {
        console.error("\n  Fewer casts — bank them so the room does not get spent again: pnpm check:casts --update");
    }
    process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
