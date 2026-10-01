/**
 * Guard the exports that change underneath already-deployed bundles.
 *
 * See `api-surface.mjs` for which packages are tracked and why. The short
 * version: these are the packages `infra/docker/entrypoint.mjs` symlinks over a
 * bundle's own copies — `@rebasepro/server`, `types`, `client`, `common` and
 * `utils`, plus the `@rebasepro/server/functions` entry point — so their exports
 * move under tenant code that is already built, during a fleet rollout nobody
 * asked for.
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
 *   * ADDED    — safe. Counts a gained member as well as a gained export: for
 *                a while it counted only the latter, and the baseline drifted a
 *                member at a time.
 *
 * A run that only adds PASSES, and banks the addition: the baseline file is
 * rewritten in place, so the working tree shows it beside the new export and
 * it goes into the same commit. It used to fail with "regenerate", which kept
 * main red for four pushes in September over exports that cannot break a
 * deployed bundle — and a gate that is red for a reason nobody needs to act on
 * teaches everyone to read red as noise. Under GitHub Actions the additions are
 * also a `::notice`, so a commit that forgot the file says so in the run.
 *
 * What still has to be true is that every export a RELEASE ships is in the
 * baseline committed at its tag: `check-release-bump.mjs` compares two committed
 * baselines, so an export released unbanked is one whose later removal nothing
 * can see. The stable release banks it (`write:api-surface` before the bump
 * check; the release commit carries the file), and the canary — which commits
 * nothing back — runs this with `--strict`, where an unbanked addition fails.
 *
 * A removal or a change is never written. Those still fail, with the same
 * rationale as before, and `pnpm write:api-surface` is still how a deliberate
 * one is banked.
 *
 *     pnpm check:api-surface              # banks additions, fails on a break
 *     pnpm check:api-surface --strict     # an unbanked addition fails too
 *     pnpm write:api-surface              # bank anything, after an intentional break
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAll, BASELINE, TRACKED, staleTargets, staleDistMessage } from "./api-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = p => path.relative(ROOT, p);

/**
 * `kind Name { a, b }` under `## @pkg` → key `@pkg: kind Name`, members [a, b].
 * Comments and blanks drop out.
 *
 * The package is part of the key. Without it, a name two tracked packages both
 * export was one entry, the later section's line overwrote the earlier's, and
 * removing `const rebase` from `@rebasepro/server/functions` — or a member from
 * either copy — diffed as "unchanged" for as long as the other package still
 * had it. The baseline has ~90 such names.
 */
function parse(text) {
    const entries = new Map();
    let section = null;
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        const header = trimmed.match(/^##\s+(\S+)/);
        if (header) {
            section = header[1];
            continue;
        }
        if (!trimmed || trimmed.startsWith("#")) continue;
        const withMembers = trimmed.match(/^(.*?)\s*\{\s*(.*?)\s*\}$/);
        const name = withMembers ? withMembers[1] : trimmed;
        const key = section ? `${section}: ${name}` : name;
        entries.set(key, withMembers ? withMembers[2].split(",").map(s => s.trim()).filter(Boolean) : []);
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
 * `tooling/scripts/test/api-surface.test.mjs`. `baseline` and `targets` are parameters
 * for the same reason; the defaults are the real ones.
 *
 * `strict` refuses an unbanked addition instead of banking it (the canary).
 */
export function checkApiSurface({ baseline = BASELINE, targets, strict = false } = {}) {
    if (!fs.existsSync(baseline)) {
        console.error(
            `No API surface baseline at ${rel(baseline)}.\n` +
            "Create it with: pnpm write:api-surface"
        );
        return 1;
    }

    // Before diffing anything: this reads `dist`, and an old `dist` reports the
    // baseline's newer exports as REMOVED — the one verdict here that reads as
    // an emergency. See `staleTargets` for the day it did exactly that.
    // Skipped when `targets` is supplied, which is the tests' fixture surface.
    if (!targets) {
        const stale = staleTargets();
        if (stale.length) {
            console.error(staleDistMessage(stale));
            return 1;
        }
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
        const mark = breaking ? "" : strict ? "✗ " : "+ ";
        console.log(`\n${mark}${added.length} export(s) added:\n`);
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
        return 1;
    }

    if (strict) {
        console.error(
            "\nAdditions only — no contract break, but not banked. Under --strict the\n" +
            "baseline has to name everything this build exports before it ships: the\n" +
            "release check compares committed baselines, and an export published\n" +
            "without being banked is one whose later removal nothing can see.\n\n" +
            "    pnpm write:api-surface      # then commit contracts/server.api.txt\n"
        );
        return 1;
    }

    fs.writeFileSync(baseline, current);
    console.log(
        `\nAdditions only — no contract break. Banked into ${rel(baseline)};\n` +
        "commit it with the change that added them.\n"
    );
    if (process.env.GITHUB_ACTIONS) {
        // One line: a workflow command ends at the newline.
        console.log(
            `::notice title=API surface::${added.length} addition(s) not in the committed ${rel(baseline)} ` +
            "(they pass, and the release banks them). Run `pnpm check:api-surface` locally and commit the file."
        );
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(checkApiSurface({ strict: process.argv.includes("--strict") }));
}
