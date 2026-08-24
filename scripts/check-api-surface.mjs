/**
 * Guard the exports that change underneath already-deployed bundles.
 *
 * See `api-surface.mjs` for why only `@rebasepro/server` is tracked. The short
 * version: it is the one package `infra/docker/entrypoint.mjs` symlinks over a
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
 *   * ADDED    — safe. Regenerate the baseline and commit it. Counts a gained
 *                member as well as a gained export: for a while it counted only
 *                the latter, and the baseline drifted a member at a time.
 *
 * A run that only adds still fails, so the baseline cannot drift silently — but
 * it fails with "regenerate", not with "you broke the contract".
 *
 *     pnpm check:api-surface
 *     pnpm write:api-surface   # after an intentional change
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAll, BASELINE, TRACKED } from "./api-surface.mjs";

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

/**
 * Diff two rendered surfaces. Exported because the release gate
 * (`check-release-bump.mjs`) asks the same question of two *committed* baselines
 * — "did this release remove anything?" — and a second implementation of that
 * question is a second answer waiting to disagree with this one.
 */
export function classify(beforeText, afterText) {
    const before = parse(beforeText);
    const after = parse(afterText);

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

        // A gained member is additive and safe, but it still has to reach the
        // baseline: an unreported addition is a baseline that drifts one member
        // at a time, and `CollectionSubscriptionConfig` really did gain
        // `searchExplain` with this gate reporting "API surface unchanged". Same
        // rule as a gained export — fail with "regenerate", not with "you broke
        // the contract".
        const known = new Set(members);
        const newMembers = after.get(key).filter(m => !known.has(m));
        if (newMembers.length) added.push(`${key} — gained ${newMembers.join(", ")}`);
    }
    for (const key of after.keys()) {
        if (!before.has(key)) added.push(key);
    }

    return { removed, changed, added };
}

/**
 * Run the gate. Returns the exit code rather than calling `process.exit`, so the
 * gate's own tests can drive it over a fixture surface — see
 * `scripts/test/api-surface.test.mjs`. `baseline` and `targets` are parameters
 * for the same reason; the defaults are the real ones.
 */
export function checkApiSurface({ baseline = BASELINE, targets } = {}) {
    if (!fs.existsSync(baseline)) {
        console.error(
            `No API surface baseline at ${rel(baseline)}.\n` +
            "Create it with: pnpm write:api-surface"
        );
        return 1;
    }

    let current;
    try {
        current = renderAll(targets);
    } catch (err) {
        console.error(`Could not read the API surface: ${err.message}`);
        return 1;
    }

    const { removed, changed, added } = classify(fs.readFileSync(baseline, "utf8"), current);

    if (!removed.length && !changed.length && !added.length) {
        console.log("✓ API surface unchanged.");
        return 0;
    }

    const breaking = removed.length || changed.length;
    const where = (targets ?? TRACKED).map(t => t.pkg).join(", ");

    if (removed.length) {
        console.error(`\n✗ ${removed.length} export(s) REMOVED from ${where}:\n`);
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
            "infra/docker/entrypoint.mjs, and the managed tier moves projects onto new images\n" +
            "without anyone rebuilding. A bundle that imports one of the symbols above\n" +
            "is ALREADY BUILT — it will not fail to compile, it will fail to boot, in a\n" +
            "wave, across the fleet.\n\n" +
            "If this is deliberate, it is a runtime contract change: bump the contract\n" +
            "major so old bundles resolve onto the old image instead of this one, then\n" +
            "regenerate with `pnpm write:api-surface`.\n"
        );
    } else {
        console.log(
            "\nAdditions only — no contract break. Regenerate the baseline and commit it:\n" +
            "    pnpm write:api-surface\n"
        );
    }
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(checkApiSurface());
}
