/**
 * Guard the exports that change underneath already-deployed bundles.
 *
 * See `api-surface.mjs` for why only `@rebasepro/server` is tracked. The short
 * version: it is the one package `docker/entrypoint.mjs` symlinks over a
 * bundle's own copy, so its exports move under tenant code that is already
 * built, during a fleet rollout nobody asked for.
 *
 * The diff is classified rather than just reported, because the three kinds of
 * change are not equally serious:
 *
 *   * REMOVED  — a contract break. A deployed bundle importing this symbol
 *                throws at boot. Bump the runtime contract major, or put the
 *                export back.
 *   * CHANGED  — a member disappeared from a class/interface. Same failure mode
 *                one level down, and just as invisible to a build that already
 *                happened.
 *   * ADDED    — safe. Regenerate the baseline and commit it.
 *
 * A run that only adds still fails, so the baseline cannot drift silently — but
 * it fails with "regenerate", not with "you broke the contract".
 *
 *     pnpm check:api-surface
 *     node scripts/api-surface.mjs --write   # after an intentional change
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAll, BASELINE } from "./api-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = p => path.relative(ROOT, p);

/** `kind Name { a, b }` → key `kind Name`, members [a, b]. Comments and blanks drop out. */
function parse(text) {
    const entries = new Map();
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("##")) continue;
        const withMembers = trimmed.match(/^(.*?)\s*\{\s*(.*?)\s*\}$/);
        if (withMembers) {
            entries.set(withMembers[1], withMembers[2].split(",").map(s => s.trim()).filter(Boolean));
        } else {
            entries.set(trimmed, []);
        }
    }
    return entries;
}

if (!fs.existsSync(BASELINE)) {
    console.error(
        `No API surface baseline at ${rel(BASELINE)}.\n` +
        "Create it with: node scripts/api-surface.mjs --write"
    );
    process.exit(1);
}

let current;
try {
    current = renderAll();
} catch (err) {
    console.error(`Could not read the API surface: ${err.message}`);
    process.exit(1);
}

const before = parse(fs.readFileSync(BASELINE, "utf8"));
const after = parse(current);

const removed = [];
const changed = [];
const added = [];

for (const [key, members] of before) {
    if (!after.has(key)) {
        removed.push(key);
        continue;
    }
    const now = new Set(after.get(key));
    const goneMembers = members.filter(m => !now.has(m));
    if (goneMembers.length) changed.push(`${key} — lost ${goneMembers.join(", ")}`);
}
for (const key of after.keys()) {
    if (!before.has(key)) added.push(key);
}

if (!removed.length && !changed.length && !added.length) {
    console.log("✓ API surface unchanged.");
    process.exit(0);
}

const breaking = removed.length || changed.length;

if (removed.length) {
    console.error(`\n✗ ${removed.length} export(s) REMOVED from @rebasepro/server:\n`);
    for (const key of removed) console.error(`    ${key}`);
}
if (changed.length) {
    console.error(`\n✗ ${changed.length} export(s) lost public members:\n`);
    for (const key of changed) console.error(`    ${key}`);
}
if (added.length) {
    console.log(`\n${breaking ? "" : "✗ "}${added.length} export(s) added:\n`);
    for (const key of added) console.log(`    ${key}`);
}

if (breaking) {
    console.error(
        "\nThis package is symlinked over every deployed bundle's copy by\n" +
        "docker/entrypoint.mjs, and the managed tier moves projects onto new images\n" +
        "without anyone rebuilding. A bundle that imports one of the symbols above\n" +
        "is ALREADY BUILT — it will not fail to compile, it will fail to boot, in a\n" +
        "wave, across the fleet.\n\n" +
        "If this is deliberate, it is a runtime contract change: bump the contract\n" +
        "major so old bundles resolve onto the old image instead of this one, then\n" +
        "regenerate with `node scripts/api-surface.mjs --write`.\n"
    );
} else {
    console.log(
        "\nAdditions only — no contract break. Regenerate the baseline and commit it:\n" +
        "    node scripts/api-surface.mjs --write\n"
    );
}
process.exit(1);
