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
 * Seven invariants:
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
 *  6. **Every `exports` entry resolves for `require`** — a map with no
 *     `default` condition turns a supported call into a broken install.
 *  7. **A `server.json` agrees with its package** — the MCP Registry validates
 *     a publish against npm, so a manifest that disagrees fails the release at
 *     its last step, once npm can no longer be rewritten.
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

    /* ── 2b. One version derivation, shared by every release file ─── */

    /*  `release.sh` was fixed to walk back from HEAD and the two `publish.yml`
        steps were not, so the same repository answered "what is the last
        release" two different ways depending on which entry point you used.

        The difference is not academic. This history descends from a lineage
        that reached v3.x before versioning restarted at 0.x, and 436 of those
        tags survive in clones. Sorting the tag namespace by version answers
        v3.3.0; `git describe` can only return a tag HEAD descends from, and
        answers v0.17.3. One `git push --tags` from a developer's machine was
        all that stood between the workflow and publishing 3.4.0 to npm — a
        number that cannot be taken back.

        So: every variable a release file computes from git tags must be
        computed by the SAME expression, and that expression must walk the
        history rather than scan the namespace. */

    const derivations = new Map();
    const namespaceScans = [];

    for (const file of RELEASE_FILES) {
        const text = sources?.[file] ?? readRelease(root, file);
        for (const [, variable, command] of text.matchAll(
            /^\s*([A-Za-z_]\w*)=\$\(\s*(git\s+(?:tag|describe)[^)]*)\)/gm
        )) {
            const expression = command.trim().replace(/\s+/g, " ");
            if (!/^git describe --tags --abbrev=0 --match /.test(expression)) {
                namespaceScans.push(`${file}: ${variable}=$(${expression})`);
                continue;
            }
            if (!derivations.has(expression)) derivations.set(expression, []);
            derivations.get(expression).push(`${file} (${variable})`);
        }
    }

    if (namespaceScans.length > 0) {
        fail(
            `${namespaceScans.length} release step(s) read a version out of the tag namespace.`,
            namespaceScans.join("\n      ")
            + "\n\n      Sorting tags by version returns the highest number that exists anywhere,"
            + "\n      including the 436 pre-restart `v3.*` tags still in developer clones."
            + "\n      Use `git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*'`,"
            + "\n      which can only return a tag this commit descends from."
        );
    } else if (derivations.size === 0) {
        fail(
            "No release file derives a base version from git at all.",
            "One of them must, and `check:publishable-set` cannot tell whether the others agree."
        );
    } else if (derivations.size > 1) {
        fail(
            `${derivations.size} different version derivations across the release files.`,
            [...derivations].map(([expression, where]) =>
                `${expression}\n        ${where.join("\n        ")}`).join("\n      ")
            + "\n\n      `release.sh` and both `publish.yml` steps must compute the base version"
            + "\n      identically, or the release you run by hand and the release CI runs"
            + "\n      disagree about which version came last."
        );
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

        /* ── 7. An MCP Registry manifest agrees with its package ────── */

        // `mcpName` in package.json is not decoration: it is the ownership
        // proof the MCP Registry reads out of the published npm tarball. A
        // package that declares one and ships no `server.json` has claimed a
        // registry identity that nothing ever publishes — which is the state
        // `@rebasepro/mcp` sat in from the day the field was added.
        const registryFile = path.join(root, pkg.dir, "server.json");
        const hasRegistryFile = fs.existsSync(registryFile);

        if (manifest.mcpName && !hasRegistryFile) {
            fail(
                `${pkg.name} declares mcpName "${manifest.mcpName}" but has no server.json`,
                `${pkg.dir} — the name is published to npm and read by nothing.`
                + "\n      Add a server.json beside it, or drop the field."
            );
        }
        if (hasRegistryFile) {
            for (const finding of checkRegistryManifest(registryFile, manifest, pkg)) {
                fail(finding.message, finding.detail);
            }
        }
    }

    return findings;
}

/**
 * A `server.json` and the package.json beside it describe one release.
 *
 * The MCP Registry validates a publish against npm: it downloads the tarball at
 * the version the manifest names and looks for an `mcpName` matching the
 * manifest's `name`. Every disagreement below is therefore a publish that fails
 * at the very end of a release run — after `pnpm -r publish` has already put
 * the packages on npm, where a version cannot be taken back and reused. Cheaper
 * to fail on the PR.
 *
 * The registry's own limits are checked here too, for the same reason: a
 * description of 101 characters is a rejected publish, and finding that out
 * from a release job is finding it out too late.
 *
 * @param {string} file      path to the server.json
 * @param {object} manifest  the package.json beside it
 * @param {{ name: string, dir: string }} pkg
 * @returns {{ message: string, detail?: string }[]}
 */
export function checkRegistryManifest(file, manifest, pkg) {
    const findings = [];
    const fail = (message, detail) => findings.push({ message, detail });

    let server;
    try {
        server = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        return [{ message: `${pkg.dir}/server.json is not readable JSON`, detail: err.message }];
    }

    if (!manifest.mcpName) {
        fail(
            `${pkg.name} has a server.json but no mcpName in package.json`,
            `${pkg.dir} — the registry reads mcpName out of the published tarball to prove`
            + `\n      ownership of "${server.name}", and refuses the publish without it.`
        );
    } else if (manifest.mcpName !== server.name) {
        fail(
            `${pkg.name}: mcpName and server.json name disagree`,
            `package.json  ${manifest.mcpName}\n      server.json   ${server.name}`
            + "\n\n      The registry compares these two strings and rejects the publish."
        );
    }

    if (server.version !== manifest.version) {
        fail(
            `${pkg.dir}/server.json is at ${server.version}, the package at ${manifest.version}`,
            "The registry refuses a version that is not on npm — and would accept an OLDER"
            + "\n      one, re-registering a release that already shipped."
            + "\n      Bump through `publishable-packages.mjs --set-version`, which writes both."
        );
    }

    const npmEntries = (server.packages ?? []).filter(p => p.registryType === "npm");
    const own = npmEntries.find(p => p.identifier === manifest.name);
    if (!own) {
        fail(
            `${pkg.dir}/server.json lists no npm package for ${manifest.name}`,
            npmEntries.length
                ? `It points at: ${npmEntries.map(p => p.identifier).join(", ")}`
                : "It has no npm package entry at all, so the registry has nothing to install."
        );
    } else if (own.version !== manifest.version) {
        fail(
            `${pkg.dir}/server.json points at ${manifest.name}@${own.version}, not ${manifest.version}`,
            "The server version and the package entry's version are two copies of one"
            + "\n      number, and only one of them was moved."
        );
    }

    // Same class as `repository.directory`: a path restated by hand, which the
    // 2026-08-24 move left pointing at a directory that no longer existed.
    const subfolder = server.repository?.subfolder;
    if (subfolder && subfolder !== pkg.dir) {
        fail(
            `${pkg.dir}/server.json declares repository.subfolder "${subfolder}"`,
            `${pkg.dir} is where it actually lives.`
        );
    }

    // The registry's schema caps these, and rejects on length rather than
    // truncating. https://static.modelcontextprotocol.io/schemas/…/server.schema.json
    for (const [field, max] of [["description", 100], ["title", 100]]) {
        const value = server[field];
        if (typeof value === "string" && value.length > max) {
            fail(
                `${pkg.dir}/server.json ${field} is ${value.length} characters, over the registry's ${max}`,
                value
            );
        }
    }
    if (!server.description) {
        fail(`${pkg.dir}/server.json has no description`, "The registry requires one.");
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
