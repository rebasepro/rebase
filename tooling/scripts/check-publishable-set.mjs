/**
 * The release ships every package it should, and no package it should not.
 *
 * On 2026-08-24 `rebase-agent-skills/` moved under `tooling/`. `publish.yml`
 * named its publishable set twice as literal paths; the two shell loops were
 * updated and the four `pnpm --filter './rebase-agent-skills'` were not. pnpm
 * treats an unmatched filter as a **warning and exits 0** — it prints `No
 * projects matched the filters "…"`, then does the work for the filters that
 * did match. So the release went green while doing less than it said.
 *
 * Both halves broke from that one stale string:
 *
 *  - `@rebasepro/agent-skills` was never bumped and never published. It sat at
 *    0.16.0 on npm through 0.17.0, 0.17.1 and 0.17.2.
 *  - Worse, and less visible: `packages/cli` depends on it as `workspace:*`,
 *    which pnpm resolves at publish time against *that package's own manifest*.
 *    So three published CLIs carried a hard `"0.16.0"` pin nobody wrote, and
 *    every agent skill authored in that window reached no user at all.
 *
 * Nothing failed, and nothing could have: every check in the pipeline asked
 * whether the packages it *found* were correct, and none asked whether it had
 * found them all. This file asks that question, on every PR rather than at
 * release time — a release-time check is discovered during a release.
 *
 * Five invariants:
 *
 *  1. **Lockstep.** Every publishable package carries the same version. The one
 *     that would have caught this, on the first PR after the bump commit landed.
 *  2. **No hand-written enumeration** in `publish.yml` — it must derive the set
 *     from `publishable-packages.mjs`, or the mechanism regresses and invariant
 *     1 starts catching things a release late.
 *  3. **Nothing publishable outside the workspace.** A new `@rebasepro/*`
 *     package under a directory no workspace glob covers is invisible to the
 *     release, to `pnpm -r test`, and to every other check here.
 *  4. **A new package is publishable-shaped** — scoped, versioned, explicit
 *     `files`, so a first release cannot ship the whole working directory or an
 *     empty tarball.
 *  5. **`repository.directory` matches reality** — the same class as the
 *     filters, and the same move left it stale.
 *
 * Exit 1 on a finding, 2 if the check could not run.
 *
 *     node tooling/scripts/check-publishable-set.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, publishablePackages, workspacePackages } from "./publishable-packages.mjs";

/**
 * Every file that drives a release. Both had the same two `--filter` paths, and
 * `release.sh` even carried a comment asking them to "MUST match" each other —
 * which is the tell: an invariant a comment asks two call sites to hold is one
 * nothing holds.
 */
export const RELEASE_FILES = [
    ".github/workflows/publish.yml",
    "tooling/scripts/release.sh",
    "tooling/scripts/validate-no-workspace-protocol.sh"
];

/** Kept for the error text most readers will see first. */
export const WORKFLOW = RELEASE_FILES[0];

/**
 * Directories that legitimately hold a `package.json` that is not a workspace
 * member: dependency trees, build output, and the scaffold templates the CLI
 * copies — whose manifests describe a *user's* future project, not ours.
 */
const NOT_OURS = /(^|\/)(node_modules|dist|dist-bundle|build|coverage|templates|\.next|\.astro)(\/|$)/;

/**
 * @param {{ root?: string, sources?: Record<string, string> }} opts
 *   `sources` maps a release file to its text, injected so the tests can drive
 *   the shapes that broke without a repository shaped like a release.
 * @returns {{ message: string, detail?: string }[]}
 */
export function checkPublishableSet({ root = ROOT, sources } = {}) {
    const findings = [];
    const fail = (message, detail) => findings.push({ message, detail });

    /* ── 1. Lockstep ──────────────────────────────────────────────── */

    const publishable = publishablePackages(root);
    if (publishable.length === 0) {
        throw new Error("Derived an empty publishable set — the derivation is broken, not the repo.");
    }

    const byVersion = new Map();
    for (const pkg of publishable) {
        if (!pkg.version) {
            fail(`${pkg.name} has no version`, pkg.dir);
            continue;
        }
        if (!byVersion.has(pkg.version)) byVersion.set(pkg.version, []);
        byVersion.get(pkg.version).push(pkg);
    }

    if (byVersion.size > 1) {
        // The release version is the HIGHEST, not the most common. A package the
        // bump missed is by definition left *behind*, and majority is not a rule
        // — with two packages it is a coin toss, and the first draft of this
        // check reported the up-to-date package as the straggler, which sends
        // whoever reads CI to edit the one file that was right.
        const expected = [...byVersion.keys()].sort(compareVersions).at(-1);
        const inStep = byVersion.get(expected);
        const stragglers = [...byVersion.entries()]
            .filter(([version]) => version !== expected)
            .flatMap(([version, pkgs]) =>
                pkgs.map(p => `${p.name} is at ${version}, not ${expected}  (${p.dir})`));
        fail(
            `Publishable packages are not in lockstep — ${inStep.length} at ${expected}, ${stragglers.length} elsewhere.`,
            stragglers.join("\n      ")
            + "\n\n      A package left behind is not merely unpublished: every sibling that"
            + "\n      depends on it as `workspace:*` bakes the stale version into its own"
            + "\n      published manifest, pinning consumers to a release that no longer"
            + "\n      exists in the tree."
        );
    }

    /* ── 2. No hand-written enumeration in the release workflow ────── */

    for (const file of RELEASE_FILES) {
        const text = sources?.[file] ?? readRelease(root, file);

        // A `--filter` naming a PATH is the shape that broke: it silently
        // matches nothing when the path moves. A `--filter` by package name is
        // sturdier, but a release should not be naming either — so both go.
        const pathFilters = [...text.matchAll(/--filter\s+'([^']*\/[^']*)'/g)].map(m => m[1]);
        if (pathFilters.length > 0) {
            fail(
                `${file} selects packages by path (${pathFilters.length} filter(s)).`,
                [...new Set(pathFilters)].map(f => `--filter '${f}'`).join("\n      ")
                + "\n\n      pnpm exits 0 when a filter matches nothing, so a moved directory"
                + "\n      removes a package from the release without failing anything."
                + "\n      Publish with a bare `pnpm -r publish` (it already skips private"
                + "\n      packages) and bump through `publishable-packages.mjs --set-version`."
            );
        }

        // Any loop over a hand-written list of package paths, whatever the
        // loop variable is called. `publish.yml` used `pkg_dir` and the
        // workspace-protocol validator used `pkg_json`; the next one will pick
        // a third name, and matching only the first would let it through.
        for (const loop of text.matchAll(/for\s+(\w+)\s+in\s+([^\n;]*)/g)) {
            const [, variable, list] = loop;
            if (/publishable-packages/.test(list)) continue;
            if (!/packages\/|package\.json/.test(list)) continue;
            fail(
                `${file} iterates a hand-written list of packages.`,
                `for ${variable} in ${list.trim()}`
                + "\n\n      Read the set from `publishable-packages.mjs --dirs` instead."
            );
        }

        if (!/publishable-packages\.mjs/.test(text)) {
            fail(
                `${file} never consults publishable-packages.mjs.`,
                "A release must derive its contents from the workspace, not restate them."
            );
        }
    }

    /* ── 3. Nothing publishable outside the workspace ──────────────── */

    const members = new Set(workspacePackages(root).map(p => p.dir));
    const strays = [];
    for (const match of fs.globSync("**/package.json", { cwd: root, exclude: p => NOT_OURS.test(p) })) {
        const dir = path.dirname(match);
        if (dir === "." || members.has(dir)) continue;
        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(path.join(root, match), "utf8"));
        } catch {
            continue;   // other gates read these; a parse error is not this one's finding
        }
        if (pkg?.private === true) continue;
        if (typeof pkg?.name !== "string" || !pkg.name.startsWith("@rebasepro/")) continue;
        strays.push(`${pkg.name}  (${dir})`);
    }

    if (strays.length > 0) {
        fail(
            `${strays.length} publishable @rebasepro package(s) are not workspace members.`,
            strays.join("\n      ")
            + "\n\n      A package no `packages:` glob in pnpm-workspace.yaml covers is invisible"
            + "\n      to the release, to `pnpm -r test`, and to every gate here. Add it to the"
            + "\n      workspace, or mark it `\"private\": true` if it is not meant to ship."
        );
    }

    /* ── 4 + 5. A new package is publishable-shaped ────────────────── */

    for (const pkg of publishable) {
        if (!pkg.name.startsWith("@rebasepro/")) {
            fail(`${pkg.name} is publishable but unscoped`,
                `${pkg.dir} — an unscoped name publishes to a global npm name.`);
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(root, pkg.dir, "package.json"), "utf8"));
        if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
            fail(
                `${pkg.name} declares no \`files\``,
                `${pkg.dir} — without it npm packs the whole directory, so a new package's`
                + "\n      first release ships its sources and local state, or nothing at all."
                + "\n      See the driver package, whose `files` must include `src`."
            );
        }
        // The same class as the filters: a path restated by hand, which the
        // 2026-08-24 move left pointing at a directory that no longer existed.
        // npm renders it as the source link on the package page.
        const declared = manifest.repository?.directory;
        if (declared && declared !== pkg.dir) {
            fail(
                `${pkg.name} declares repository.directory "${declared}"`,
                `${pkg.dir} is where it actually lives — npm links the declared path from the package page.`
            );
        }

        /* ── 6. Every exports entry resolves for `require` ──────────── */

        // Node resolves an `exports` map against a condition set that, for
        // `require(...)`, is ["node", "require"] — never "import". A map whose
        // JS entry lists only `types`/`development`/`import` therefore matches
        // nothing and Node refuses with ERR_PACKAGE_PATH_NOT_EXPORTED *before*
        // it looks at the file. That is not the ESM-only error anyone expects:
        // Node 22.12+ can `require()` an ES module perfectly well, so the
        // package was turning a supported call into what reads as a broken
        // install, for every Jest suite, `ts-node` project and `.cjs` script.
        //
        // A trailing `default` costs nothing, is the last condition tried, and
        // makes `require` land on the same file `import` does.
        for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
            if (typeof target !== "object" || target === null) continue;   // a plain string already matches every condition
            if (typeof target.default === "string") continue;
            fail(
                `${pkg.name} exports "${subpath}" with no \`default\` condition`,
                `${pkg.dir} — conditions are [${Object.keys(target).join(", ")}].`
                + "\n      `require()` resolves against [\"node\", \"require\"], matches none of them,"
                + "\n      and fails with ERR_PACKAGE_PATH_NOT_EXPORTED on every Node version —"
                + "\n      including the ones that support require(esm). Add"
                + `\n      \`"default": ${JSON.stringify(target.import ?? "./dist/index.es.js")}\` as the LAST condition.`
            );
        }
    }

    return findings;
}

/**
 * Order two versions, release part only.
 *
 * Enough for "which of these is the release": the versions being compared were
 * all written by the same bump step, so they differ in the numeric fields or
 * not at all. A prerelease sorts by its release part, which is the correct
 * answer here — `0.18.0-canary.x` is the release a canary run is bumping to.
 */
export function compareVersions(a, b) {
    const parts = v => v.split(/[-+]/)[0].split(".").map(Number);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    }
    return 0;
}

function readRelease(root, rel) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
        throw new Error(`${rel} is missing — the release pipeline cannot be checked.`);
    }
    return fs.readFileSync(file, "utf8");
}

/* ── CLI ──────────────────────────────────────────────────────────── */

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const RED = "\x1b[0;31m";
    const GREEN = "\x1b[0;32m";
    const DIM = "\x1b[2m";
    const NC = "\x1b[0m";

    let findings;
    try {
        findings = checkPublishableSet();
    } catch (err) {
        console.error(`${RED}✗ ${err.message}${NC}`);
        process.exit(2);
    }

    if (findings.length === 0) {
        const set = publishablePackages();
        console.log(`${GREEN}✓${NC} ${set.length} publishable package(s), all at ${set[0].version}, all derived from the workspace.`);
        process.exit(0);
    }

    console.error("");
    console.error(`${RED}✗ ${findings.length} finding(s) in the publishable set:${NC}`);
    for (const { message, detail } of findings) {
        console.error("");
        console.error(`  ${RED}${message}${NC}`);
        if (detail) console.error(`      ${DIM}${detail}${NC}`);
    }
    console.error("");
    process.exit(1);
}
