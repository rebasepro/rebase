#!/usr/bin/env node
/**
 * The names a release removed, written down so history may keep using them.
 *
 * `history.mjs` lets a changelog section or an upgrade page for a version
 * before a release use the names that release removed, and nothing else. This
 * produces the list: the API-surface baseline at the last release before the
 * cut (`base`, a tag) diffed against the banked baseline now
 * (`contracts/server.api.txt`), with `classify` from `check-api-surface.mjs` —
 * the same diff the release gate reads, so "removed" means one thing.
 *
 *   - `generated.exports`: exports that are gone, by package.
 *   - `generated.members`: members gone from an export that is still there.
 *   - `reviewed`: removals the surface cannot see — a member of a type alias,
 *     an export of a package the surface does not track. Hand-written, each
 *     with its reason; kept across regeneration.
 *
 *     node tooling/scripts/docs-verify/removed-names.mjs           # fails when the generated part is stale
 *     node tooling/scripts/docs-verify/removed-names.mjs --write   # regenerate it, after banking the surface
 *
 * Regenerate after every banking of the surface on the release branch, and
 * review the diff: a name in it is a name the history pages may now use.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classify } from "../check-api-surface.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const REMOVED_FILE = path.join(import.meta.dirname, "removed-in-0-31.json");
const BASELINE = "contracts/server.api.txt";

/** `"@rebasepro/types: interface Foo"` → `["@rebasepro/types", "Foo"]`. */
function splitKey(key) {
    const at = key.indexOf(": ");
    const pkg = key.slice(0, at);
    const name = key.slice(at + 2).trim().split(/\s+/).pop();
    return [pkg, name];
}

const sortObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The removals between two rendered surfaces.
 *
 * @param {string} beforeText the baseline at the base release
 * @param {string} afterText the banked baseline now
 * @returns {{ exports: Record<string, string[]>, members: Record<string, Record<string, string[]>> }}
 */
export function removedBetween(beforeText, afterText) {
    const { removed, changed } = classify(beforeText, afterText);
    /** @type {Record<string, Set<string>>} */
    const exports = {};
    for (const key of removed) {
        const [pkg, name] = splitKey(key);
        (exports[pkg] ??= new Set()).add(name);
    }
    /** @type {Record<string, Record<string, string[]>>} */
    const members = {};
    for (const entry of changed) {
        const [key, lost] = entry.split(" — lost ");
        const [pkg, name] = splitKey(key);
        (members[pkg] ??= {})[name] = lost.split(",").map(s => s.trim()).filter(Boolean).sort();
    }
    return {
        exports: sortObject(Object.fromEntries(Object.entries(exports).map(([pkg, set]) => [pkg, [...set].sort()]))),
        members: sortObject(Object.fromEntries(Object.entries(members).map(([pkg, types]) => [pkg, sortObject(types)])))
    };
}

/** The generated part, from git at `base` and the working tree's baseline. */
export function generate(file = REMOVED_FILE, root = ROOT) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const before = execFileSync("git", ["show", `${data.base}:${BASELINE}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const after = readFileSync(path.join(root, BASELINE), "utf8");
    return { data, generated: removedBetween(before, after) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { data, generated } = generate();
    const stale = JSON.stringify(generated) !== JSON.stringify(data.generated);
    if (process.argv.includes("--write")) {
        writeFileSync(REMOVED_FILE, `${JSON.stringify({ ...data, generated }, null, 4)}\n`);
        const count = Object.values(generated.exports).flat().length;
        console.log(`wrote ${path.relative(ROOT, REMOVED_FILE)}: ${count} removed export(s), members gone from ${Object.values(generated.members).flatMap(Object.keys).length} export(s).`);
        process.exit(0);
    }
    if (stale) {
        console.error(`✗ ${path.relative(ROOT, REMOVED_FILE)} is stale against ${BASELINE} — run with --write and review the diff.`);
        process.exit(1);
    }
    console.log(`✓ ${path.relative(ROOT, REMOVED_FILE)} matches the banked surface diff from ${data.base}.`);
}
