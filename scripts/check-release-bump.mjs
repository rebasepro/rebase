/**
 * The bump level a release ships under must follow from what the release did.
 *
 * `publish.yml` takes the bump as a free-text `workflow_dispatch` input
 * defaulting to `"patch"`, and nothing correlates that input with the diff. So a
 * release that removed an export from `@rebasepro/server` ships as 0.13.1, and
 * every consumer pinned `"@rebasepro/server": "^0.13.0"` — the range `rebase init`
 * scaffolds — resolves it on their next install. `^0.13.0` is
 * `>=0.13.0 <0.14.0`: a breaking change auto-installs. Under 0.x the *minor* is
 * the breaking position, and until this file nothing enforced that a breaking
 * change reached it.
 *
 * The three axes with a committed artifact can answer for themselves, so they do:
 *
 *   * `api-surface/server.api.txt`   — a REMOVED export, or an export that lost a
 *                                      member. Additions are not breaking.
 *   * `contracts/derived-names.txt`  — any change at all. These identifiers are
 *                                      frozen, not "frozen until the next major"
 *                                      (docs/compatibility.md:117).
 *   * BUNDLE_FORMAT_VERSION,         — either constant moving is a coordinated
 *     RUNTIME_CONTRACT_VERSION         release by definition.
 *
 * Then two things must be true or the release stops: the bump is at least a
 * minor, and the section about to be promoted out of `[Unreleased]` says so under
 * a `### Breaking` heading. The second is not bureaucracy — the GitHub release
 * notes and the upgrade guide are built from that section, and a breaking release
 * whose notes do not mention the break is the version of this failure that
 * actually reaches users.
 *
 * Comparison is committed baseline against committed baseline at the previous
 * tag. It deliberately does not re-render the surface from `dist`:
 * `check:api-surface` already guarantees the committed baseline matches the build
 * on every PR, so this needs no build and cannot disagree with that gate.
 *
 * An axis whose artifact did not exist at the previous tag is reported as
 * unguarded rather than passed over, because a silent axis and a clean axis look
 * identical in a log and mean opposite things.
 *
 * Exit codes follow `check-derived-names.mts`: 2 means the check did not run, 1
 * means it ran and the release must not proceed.
 *
 *     node scripts/check-release-bump.mjs 0.13.1
 *     node scripts/check-release-bump.mjs 0.14.0 --from v0.13.0
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { classify } from "./check-api-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SURFACE = "contracts/server.api.txt";
export const DERIVED_NAMES = "contracts/derived-names.txt";
export const MANIFEST = "packages/types/src/types/project_manifest.ts";
export const CHANGELOG = "CHANGELOG.md";

const red = s => `\x1b[31m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

function git(args) {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** File content at a rev, or null when the file did not exist there yet. */
function gitShow(rev, file) {
    try {
        return git(["show", `${rev}:${file}`]);
    } catch {
        return null;
    }
}

export function latestTag() {
    const tags = git(["tag", "-l", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"]).trim().split("\n");
    return tags[0] || null;
}

/** patch | minor | major, from two x.y.z strings. */
export function bumpLevel(from, to) {
    const [fromMajor, fromMinor] = from.split(".").map(Number);
    const [toMajor, toMinor] = to.split(".").map(Number);
    if (toMajor !== fromMajor) return "major";
    if (toMinor !== fromMinor) return "minor";
    return "patch";
}

export function contractConstants(text) {
    if (!text) return null;
    const read = name => text.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`))?.[1] ?? null;
    return {
        BUNDLE_FORMAT_VERSION: read("BUNDLE_FORMAT_VERSION"),
        RUNTIME_CONTRACT_VERSION: read("RUNTIME_CONTRACT_VERSION")
    };
}

/** The `[Unreleased]` section, which is what a release promotes. */
export function unreleasedSection(text) {
    const start = text.indexOf("## [Unreleased]");
    if (start === -1) return null;
    const next = text.indexOf("\n## ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
}

/**
 * `readAtTag` and `readNow` are parameters so the gate's own tests can hand it a
 * release that removed an export without needing a repository shaped like one.
 * Returns the exit code; the caller decides what to do with it.
 */
export function checkReleaseBump({
    version,
    from,
    readAtTag = file => gitShow(from, file),
    readNow = file => {
        const abs = path.join(ROOT, file);
        return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    }
} = {}) {
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
        console.error("usage: node scripts/check-release-bump.mjs <version> [--from <tag>]");
        return 2;
    }
    if (!from) {
        console.error("No semver tag to compare against — cannot tell what this release changes.");
        return 2;
    }

    const previous = from.replace(/^v/, "");
    const level = bumpLevel(previous, version);
    const breaks = [];
    const unguarded = [];

    // ── Axis 1: the runtime-provided API surface ────────────────
    const surfaceBefore = readAtTag(SURFACE);
    if (surfaceBefore === null) {
        unguarded.push(SURFACE);
    } else {
        const { removed, changed } = classify(surfaceBefore, readNow(SURFACE) ?? "");
        for (const key of removed) breaks.push(`${SURFACE}: REMOVED ${key}`);
        for (const key of changed) breaks.push(`${SURFACE}: ${key}`);
    }

    // ── Axis 2: derived database identifiers ────────────────────
    const namesBefore = readAtTag(DERIVED_NAMES);
    if (namesBefore === null) {
        unguarded.push(DERIVED_NAMES);
    } else if (namesBefore !== readNow(DERIVED_NAMES)) {
        breaks.push(
            `${DERIVED_NAMES}: changed. These identifiers are frozen — every aged database in the ` +
            "field disagrees with the code the moment it upgrades."
        );
    }

    // ── Axis 3: the two contract constants ──────────────────────
    const constantsBefore = contractConstants(readAtTag(MANIFEST));
    const constantsNow = contractConstants(readNow(MANIFEST));
    if (!constantsBefore || !constantsNow) {
        unguarded.push(MANIFEST);
    } else {
        for (const name of Object.keys(constantsNow)) {
            if (constantsBefore[name] !== constantsNow[name]) {
                breaks.push(
                    `${name}: ${constantsBefore[name]} → ${constantsNow[name]} — a coordinated release ` +
                    "by definition, and the control plane ships first."
                );
            }
        }
    }

    console.log(`\n${bold(`Release ${previous} → ${version}`)} (${level}), against ${from}\n`);
    for (const file of unguarded) {
        console.log(`  · ${file} did not exist at ${from} — that axis is unguarded for this release.`);
    }

    if (!breaks.length) {
        // The tracked artifacts answer for themselves only where they existed at
        // the baseline. `api-surface/` and `contracts/` were both added during
        // 0.13, so for the 0.13 → 0.14 release every axis above reported
        // "unguarded" and this function was about to bless a PATCH for the
        // release that renamed every foreign key on the wire.
        //
        // A `### Breaking` heading is written by a human who knew, so it is the
        // one signal that survives an artifact not existing yet. It cannot
        // replace the checks above — it is a claim, not a diff, and its absence
        // proves nothing — but its *presence* is decisive on its own.
        const declared = readNow(CHANGELOG);
        const declaredSection = declared === null ? null : unreleasedSection(declared);
        if (level === "patch" && declaredSection !== null && /^###\s+Breaking\b/m.test(declaredSection)) {
            const range = `^${previous.split(".").slice(0, 2).join(".")}.0`;
            console.error(red("✗ The changelog declares a breaking change and the bump is a PATCH.\n"));
            console.error(red(
                `  ✗ ${CHANGELOG}'s [Unreleased] section has a "### Breaking" heading, so this release\n` +
                `    breaks something. Every consumer on "${range}" — the range \`rebase init\` scaffolds —\n` +
                `    installs ${version} on their next install. Under 0.x the minor is the breaking\n` +
                "    position: release this as a minor.\n"
            ));
            return 1;
        }
        console.log(green(`✓ Nothing breaking in the tracked contracts — ${level} is fine.`));
        return 0;
    }

    console.error(red(`✗ ${breaks.length} breaking change(s) in the tracked contracts:\n`));
    for (const b of breaks) console.error(`    ${b}`);

    const problems = [];
    if (level === "patch") {
        const range = `^${previous.split(".").slice(0, 2).join(".")}.0`;
        problems.push(
            `The bump is a PATCH. Every consumer on "${range}" — the range \`rebase init\` scaffolds —\n` +
            `    installs ${version} on their next install. Under 0.x the minor is the breaking\n` +
            "    position: release this as a minor."
        );
    }
    const changelog = readNow(CHANGELOG);
    const section = changelog === null ? null : unreleasedSection(changelog);
    if (section === null) {
        problems.push(`${CHANGELOG} has no [Unreleased] section to promote.`);
    } else if (!/^###\s+Breaking\b/m.test(section)) {
        problems.push(
            `${CHANGELOG}'s [Unreleased] section has no "### Breaking" heading. The release notes and\n` +
            "    the upgrade guide are built from it, and a breaking release whose notes do not say so\n" +
            "    is the version of this that reaches users."
        );
    }

    if (!problems.length) {
        console.log(green(`\n✓ Declared: a ${level} with a "### Breaking" section. Proceeding.`));
        return 0;
    }

    console.error("");
    for (const p of problems) console.error(red(`  ✗ ${p}`));
    console.error("");
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const fromIndex = args.indexOf("--from");
    process.exit(checkReleaseBump({
        version: args.find(a => /^\d+\.\d+\.\d+$/.test(a)),
        from: fromIndex === -1 ? latestTag() : args[fromIndex + 1]
    }));
}
