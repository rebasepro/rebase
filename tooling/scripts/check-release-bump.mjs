/**
 * The bump level a release ships under must follow from what the release did.
 *
 * `publish.yml` takes the bump as a free-text `workflow_dispatch` input
 * defaulting to `"patch"`, and nothing correlates that input with the diff. So a
 * release that removed an export from `@rebasepro/server` ships as 0.13.1, and
 * the number tells every reader it is safe to take.
 *
 * That number is the only signal there is. `rebase init` writes EXACT pins —
 * `"@rebasepro/server": "0.17.3"`, one version for all ten packages, since the
 * lockstep set has to move together — so nothing auto-installs and nothing
 * warns: a project upgrades when a person edits the version, and what that
 * person has to go on is the digit that changed and the changelog entry behind
 * it. A patch that removed an export is a lie told at exactly the moment
 * somebody is deciding whether to trust it. (This file used to argue from
 * `^0.13.0` auto-resolving on the next install, which stopped being true when
 * `init` moved to exact pins; the conclusion did not change, only the reason.)
 *
 * Under 0.x the *minor* is the breaking position, and until this file nothing
 * enforced that a breaking change reached it.
 *
 * The three axes with a committed artifact can answer for themselves, so they do:
 *
 *   * `contracts/server.api.txt`     — a REMOVED export, or an export that lost a
 *                                      member, in any of its six sections.
 *                                      Additions are not breaking.
 *   * `contracts/derived-names.txt`  — a name that DISAPPEARED, or one whose
 *                                      producers changed. Additions are not
 *                                      breaking. Frozen means frozen, not
 *                                      "frozen until the next major", but what
 *                                      is frozen is a name a release already
 *                                      emitted — see below.
 *   * BUNDLE_FORMAT_VERSION,         — either constant moving is a coordinated
 *     RUNTIME_CONTRACT_VERSION         release by definition.
 *
 * A fourth axis has no committed artifact behind it and is diffed from the
 * manifests directly:
 *
 *   * `engines.node` in every         — a floor that MOVED. Nothing generates
 *     publishable package               this field and nothing diffed it, so it
 *                                       went `>=20` → `>=22.22.0` across 21
 *                                       packages with no release note at all,
 *                                       and `pnpm install` answers a mismatch
 *                                       with a warning rather than a failure.
 *
 * A fifth axis asks a different question — not "what did this release break"
 * but "is this release self-consistent". `rebase init` pins every `@rebasepro`
 * dependency, and the scaffold's compose image tag, to the CLI's own version, so
 * a release that ships a template naming something it does not publish produces
 * projects that cannot boot. `check-template-pins.mjs` holds it; unlike the
 * four above there is no deliberate version of it, so it refuses outright
 * rather than asking for a minor and a note.
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
 *     node tooling/scripts/check-release-bump.mjs 0.13.1
 *     node tooling/scripts/check-release-bump.mjs 0.14.0 --from v0.13.0
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { classify } from "./check-api-surface.mjs";
import { checkTemplatePins } from "./check-template-pins.mjs";
import { publishablePackages } from "./publishable-packages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

/**
 * Split a derived-names diff into names that vanished, changed producers, or
 * are simply new.
 *
 * The distinction the earlier version of this axis did not draw. It compared the
 * two files byte-for-byte and called any difference a break, which reads as the
 * cautious choice and is not: a purely additive release then has to be cut as a
 * minor *and* carry a `### Breaking` section describing a break that does not
 * exist. Guards that demand an untrue note are how notes stop being read.
 *
 * What is frozen is a name a release already emitted, because a database in the
 * field carries it and no release can reach in and rename it. A name that has
 * never been emitted cannot be carried by anybody, so adding one disagrees with
 * nothing. `contracts/derived-names.txt` says exactly this in its own header —
 * "A line that CHANGES or DISAPPEARS is a break" — and `docs/compatibility.md`
 * contract 6 says "a name a release emitted is never re-derived".
 *
 * Re-derivation is still caught, and caught as a REMOVAL: changing how a name is
 * built (`products_created_at_ix_2af5183` → `..._ix_9c11f04`) drops the old line
 * and adds a new one, so the old name shows up here as gone. That is the case
 * this axis exists for and it still fails the release.
 *
 * The key is the identifier; the value is the `[boot,push]` tag naming which
 * producers write it. A name that stays but changes producers is a change, not
 * an addition: it means a database provisioned by one path no longer matches one
 * provisioned by the other.
 */
export function classifyDerivedNames(before, after) {
    const parse = text => {
        const entries = new Map();
        for (const line of (text ?? "").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            // `<kind> <name> [<producers>]` — the tag is always last, and a name
            // never contains a space, so the split is unambiguous.
            const match = /^(.*?)\s*(\[[^\]]*\])$/.exec(trimmed);
            if (match) entries.set(match[1], match[2]);
            else entries.set(trimmed, "");
        }
        return entries;
    };

    const from = parse(before);
    const to = parse(after);
    const removed = [...from.keys()].filter(k => !to.has(k));
    const changed = [...from.keys()].filter(k => to.has(k) && to.get(k) !== from.get(k));
    const added = [...to.keys()].filter(k => !from.has(k));
    return { removed, changed, added };
}

/** File content at a rev, or null when the file did not exist there yet. */
function gitShow(rev, file) {
    try {
        return git(["show", `${rev}:${file}`]);
    } catch {
        return null;
    }
}

/**
 * The last release this commit descends from.
 *
 * Not the highest version in the tag namespace: this repository descends from a
 * lineage that reached v3.x before versioning restarted at 0.x, and a clone can
 * carry those tags locally. Sorting by version picked v3.3.0, where none of the
 * contract artifacts below existed yet — so every axis reported "unguarded" and
 * the check passed anything, which is the failure it exists to prevent. Walking
 * back from HEAD can only return a tag this commit actually descends from.
 */
export function latestTag() {
    try {
        const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"]).trim();
        return tag || null;
    } catch {
        return null;
    }
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

/** `engines.node` as a manifest declares it, or null when it declares none. */
export function enginesNode(text) {
    if (text === null || text === undefined) return null;
    try {
        return JSON.parse(text)?.engines?.node ?? null;
    } catch {
        return null;
    }
}

/**
 * Does the `[Unreleased]` section say the Node floor moved?
 *
 * The floor went from `>=20` to `>=22.22.0` on 21 published packages between
 * 0.17.3 and this commit, and `grep -ciE "engines|Node 22|22\.22"` over the
 * whole section returned 0. `pnpm install` only *warns* on an engines mismatch
 * (`[WARN] Unsupported engine`), so the failure lands later, somewhere else,
 * and the release note is the only place it could have been named.
 *
 * "Mentions `engines`" or "quotes the new floor" — either is enough. Asking for
 * a particular wording would be asking for a sentence that gets pasted rather
 * than written.
 */
export function mentionsEngines(section, floor) {
    if (!section) return false;
    if (/\bengines\b/i.test(section)) return true;
    if (/\bnode\s*(?:>=|≥)?\s*\d+/i.test(section)) return true;
    if (floor && section.includes(floor)) return true;
    return false;
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
    allowUnguarded = false,
    readAtTag = file => gitShow(from, file),
    readNow = file => {
        const abs = path.join(ROOT, file);
        return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    },
    templatePins = v => checkTemplatePins({ releasedAs: v }),
    manifests = () => publishablePackages(ROOT).map(p => `${p.dir}/package.json`)
} = {}) {
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
        console.error("usage: node tooling/scripts/check-release-bump.mjs <version> [--from <tag>] [--allow-unguarded]");
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
    } else {
        const { removed, changed } = classifyDerivedNames(namesBefore, readNow(DERIVED_NAMES));
        for (const name of removed) {
            breaks.push(
                `${DERIVED_NAMES}: GONE ${name}. These identifiers are frozen — every aged database ` +
                "in the field carries this name and no release can reach in and rename it. A name " +
                "re-derived rather than dropped shows up here too, as the old spelling going missing."
            );
        }
        for (const name of changed) {
            breaks.push(
                `${DERIVED_NAMES}: ${name} changed producers. A database provisioned by one path no ` +
                "longer matches one provisioned by the other."
            );
        }
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

    // ── Axis 4: the Node floor the published tarballs declare ───
    //
    // `engines.node` is the one breaking change with no committed contract
    // behind it: nothing generates it, nothing diffs it, and `pnpm install`
    // answers a mismatch with `[WARN] Unsupported engine` and carries on. So the
    // floor moved from `>=20` to `>=22.22.0` across 21 published packages in one
    // commit, the release notes said nothing, and the first person to find out
    // would have been a user on Node 20 whose build failed somewhere with no
    // mention of Node in it.
    //
    // A package that did not exist at the tag is skipped: a first release cannot
    // raise a floor nobody was on.
    const engineChanges = [];
    for (const file of manifests()) {
        const before = readAtTag(file);
        if (before === null) continue;
        const now = readNow(file);
        if (now === null) continue;              // deleted; axis 1 owns that
        const was = enginesNode(before);
        const is = enginesNode(now);
        if (was !== is) engineChanges.push({ file, was, is });
    }
    if (engineChanges.length) {
        const { was, is } = engineChanges[0];
        const also = engineChanges.length > 1 ? ` (and ${engineChanges.length - 1} more)` : "";
        breaks.push(
            `engines.node: ${was ?? "(unset)"} → ${is ?? "(unset)"} in ${engineChanges.length} `
            + `publishable package(s) — ${engineChanges[0].file}${also}. An install on the old floor `
            + "stops working, and pnpm only warns."
        );
    }

    // ── Axis 5: what the scaffold this release ships can import ─
    //
    // Not a diff between two baselines like the three above — a consistency
    // question about the release itself. `rebase init` pins every `@rebasepro/*`
    // dependency, and the compose file's image tag, to the CLI's own version. So
    // a release must publish everything its own templates name, or every project
    // scaffolded from it fails at `rebase dev` and at `docker compose up`, with
    // a green build behind it. 0.17.3 is the release that proved it: the
    // template's `docker-compose.yml` `:?`-requires `REBASE_ADMIN_EMAIL` and
    // `REBASE_ADMIN_PASSWORD`, and the image at that tag has never heard of
    // either — with `DISABLE_SELF_REGISTRATION` defaulting to `true` beside
    // them, a self-host boots with no admin and no way to make one.
    //
    // `version` rather than the manifests: this step runs before "Bump
    // versions", so the manifests still name the release being replaced.
    //
    // This one is not a `break` — a break is a thing you may ship deliberately
    // as a minor with a `### Breaking` note. There is no deliberate version of
    // publishing a scaffold that cannot boot, so it refuses outright.
    console.log(`\n${bold(`Release ${previous} → ${version}`)} (${level}), against ${from}\n`);
    if (templatePins(version) !== 0) {
        console.error(red(
            "\n✗ The templates this release ships name something it does not publish.\n" +
            "\n    `rebase init` pins every @rebasepro dependency, and the compose file's image tag, to\n" +
            `    the CLI's own version — ${version} after this release. Every project scaffolded from it\n` +
            "    would fail at `rebase dev` or at `docker compose up`, with a green build behind it.\n" +
            "\n    Fix the template, or add what it names to this release.\n"
        ));
        return 1;
    }
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
            console.error(red("✗ The changelog declares a breaking change and the bump is a PATCH.\n"));
            console.error(red(
                `  ✗ ${CHANGELOG}'s [Unreleased] section has a "### Breaking" heading, so this release\n` +
                `    breaks something. \`rebase init\` writes exact pins ("${previous}"), so nobody takes\n` +
                `    ${version} by accident — they take it by reading the number, and a patch says it is\n` +
                "    safe. Under 0.x the minor is the breaking position: release this as a minor.\n"
            ));
            return 1;
        }
        // An unguarded axis checked NOTHING, so "nothing breaking" is not a
        // thing this run is entitled to say. Reporting it and passing anyway was
        // the previous behaviour and it demonstrably does not work: for 0.17.0
        // `server.api.txt` had moved `api-surface/` → `contracts/`, the axis
        // reported unguarded, the run printed a clean bill of health, and the
        // release did remove two members of `RebaseBackendConfig` — found only
        // by diffing the two paths by hand afterwards.
        //
        // So a blind axis stops the release until somebody says they looked.
        // `--allow-unguarded` is that sentence, and it is deliberately a flag
        // rather than a heuristic: an artifact that genuinely did not exist yet
        // is a real and legitimate case, and the only thing that can tell it
        // apart from a moved file is a person.
        if (unguarded.length && !allowUnguarded) {
            console.error(red("\n✗ An axis could not be measured, so this release is not cleared.\n"));
            for (const file of unguarded) {
                console.error(red(`  ✗ ${file} did not exist at ${from} — nothing was compared.`));
            }
            console.error(red(
                "\n    Check it by hand before releasing. An artifact that MOVED reads exactly like\n" +
                "    one that did not exist yet, and the moved case is the one that hides a break:\n" +
                `      git show ${from}:<old-path>   vs   git show HEAD:<new-path>\n` +
                "      classify() from tooling/scripts/check-api-surface.mjs compares two surfaces.\n" +
                "\n    Then re-run with --allow-unguarded to say the axis was checked another way.\n"
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
        problems.push(
            `The bump is a PATCH. \`rebase init\` writes exact pins ("${previous}"), so the version\n` +
            `    number is the whole signal: somebody deciding whether to move to ${version} reads the\n` +
            "    digit that changed. Under 0.x the minor is the breaking position: release this as a\n" +
            "    minor."
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
    if (engineChanges.length && !mentionsEngines(section, engineChanges[0].is)) {
        problems.push(
            `${CHANGELOG}'s [Unreleased] section never mentions \`engines\` or a Node version, and this\n` +
            `    release moves the floor to ${engineChanges[0].is ?? "(unset)"} in ${engineChanges.length} publishable package(s).\n` +
            "    `pnpm install` answers an engines mismatch with a warning and keeps going, so the\n" +
            "    failure lands later and elsewhere. Name the floor and where it comes from (`.nvmrc`)\n" +
            "    in a `### Breaking` bullet."
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
        from: fromIndex === -1 ? latestTag() : args[fromIndex + 1],
        allowUnguarded: args.includes("--allow-unguarded")
    }));
}
