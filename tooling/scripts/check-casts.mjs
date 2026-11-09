#!/usr/bin/env node
/**
 * A ratchet over the casts that step around the type system.
 *
 * AGENTS.md: never convert to `any`, and never cast structurally around a type.
 * ESLint enforces `no-explicit-any` in three packages and nothing counts the
 * rest, so the rule held where it was enforced and drifted where it was not:
 * over September, in non-test source, `as never` went 60 → 74 and `as any`
 * 12 → 16, while `as unknown as` fell 218 → 53 in a cleanup nobody could bank.
 *
 * So the counts are pinned per group and per kind, in
 * tooling/scripts/casts-baseline.json. A count that grows fails: write the
 * type, or narrow (`isSQLAdmin` and friends), instead of casting. A count that
 * shrinks also fails, asking for the baseline to be banked, so the next cast
 * cannot quietly spend the room a cleanup made.
 *
 * Every TypeScript file in `packages/`, `app/` and `examples/` is counted,
 * declaration files aside, in one of these groups:
 *
 *   - `packages/<name>`          its source: `src/`, minus tests (`*.test.*`,
 *                                `*.spec.*`, `__tests__`, `test/`);
 *   - `packages/<name> (tests)`  everything else in the package — its tests,
 *                                and the configs, templates and scripts beside
 *                                them. Tests were left out at first, and held
 *                                ~5,300 casts to source's ~160: a fixture cast
 *                                into shape agrees with the code on a fiction;
 *   - `app/<name>`, `examples/<name>`  the whole of each.
 *
 * Counted per line of text, so a cast in a comment counts too — the cheap
 * direction to be wrong in. Reword the prose ("like any other").
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

/** Whether a repository path is package source — `packages/<name>/src`, tests aside. */
export function isCountedSource(file) {
    if (!/^packages\/[^/]+\/src\//.test(file)) return false;
    if (!/\.(ts|tsx|mts|cts)$/.test(file) || /\.d\.(ts|mts|cts)$/.test(file)) return false;
    if (/\.(test|spec)\.[cm]?tsx?$/.test(file)) return false;
    if (/(^|\/)(__tests__|test|tests)\//.test(file.slice(file.indexOf("/src/")))) return false;
    return true;
}

/**
 * The group a repository path is counted under, or `undefined` for a file this
 * ratchet does not read (not TypeScript, a declaration file, outside the three
 * trees).
 */
export function castGroup(file) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file) || /\.d\.(ts|mts|cts)$/.test(file)) return undefined;
    const [tree, name] = file.split("/");
    if (!name || !file.includes("/", tree.length + name.length + 1)) return undefined;
    if (tree === "app" || tree === "examples") return `${tree}/${name}`;
    if (tree !== "packages") return undefined;
    return isCountedSource(file) ? `packages/${name}` : `packages/${name} (tests)`;
}

/** `{ "<group>": { "<kind>": n } }` for the given files' contents, zero counts omitted. */
export function countCasts(files) {
    const counts = {};
    for (const { file, text } of files) {
        const pkg = castGroup(file);
        if (pkg === undefined) continue;
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
    const files = execFileSync("git", ["ls-files", "packages", "app", "examples"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter((file) => castGroup(file) !== undefined)
        .filter((file) => fs.existsSync(path.join(ROOT, file)))
        .map((file) => ({ file, text: fs.readFileSync(path.join(ROOT, file), "utf8") }));
    if (!files.some(({ file }) => isCountedSource(file)) || files.every(({ file }) => isCountedSource(file))) {
        console.error("✗ check:casts found no package source, or nothing but, to count — the file walk is broken.");
        process.exit(1);
    }
    const found = countCasts(files);

    if (process.argv.includes("--update")) {
        fs.writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
        console.log(`✓ Banked the cast counts of ${Object.keys(found).length} group(s).`);
        return;
    }
    if (!fs.existsSync(BASELINE)) {
        console.error(`✗ No baseline at ${path.relative(ROOT, BASELINE)}. Create it with: pnpm check:casts --update`);
        process.exit(1);
    }
    const { grown, shrunk } = compare(found, JSON.parse(fs.readFileSync(BASELINE, "utf8")));
    if (grown.length === 0 && shrunk.length === 0) {
        console.log(`✓ Casts unchanged from the baseline (${files.length} files).`);
        return;
    }
    for (const { pkg, kind, was, now } of grown) {
        console.error(`✗ ${pkg}: \`${kind}\` ${was} → ${now}`);
    }
    if (grown.length > 0) {
        console.error(`
  A cast that steps around the type system hides the drift the types exist to
  catch. Write the type, or narrow it (driver.admin with isSQLAdmin, an unknown
  with a type guard), instead. Run \`git diff -U0 | grep -E "as (any|never|unknown as)"\`
  to find the new one.`);
    }
    for (const { pkg, kind, was, now } of shrunk) {
        console.error(`✓ ${pkg}: \`${kind}\` ${was} → ${now}`);
    }
    if (shrunk.length > 0) {
        console.error("\n  Fewer casts — bank them so the room does not get spent again: pnpm check:casts --update");
    }
    process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
