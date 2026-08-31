/**
 * The set of packages a release publishes — derived from the workspace, never
 * listed by hand.
 *
 * `publish.yml` used to name the set twice, as literal paths:
 *
 *     pnpm --filter './packages/…' --filter './rebase-agent-skills' -r exec …  # bump
 *     for pkg_dir in packages/…/ rebase-agent-skills/; do …                    # pack + validate
 *
 * On 2026-08-24 `rebase-agent-skills/` moved to `tooling/rebase-agent-skills/`.
 * The two shell loops were updated; the four `--filter` paths were not. **pnpm
 * treats a filter that matches nothing as a warning and exits 0** — it prints
 * `No projects matched the filters "…"`, then carries on and does the work for
 * the filters that did match. So the bump ran for `packages/*`, silently skipped
 * the skills package, and the step went green.
 *
 * Both halves of the release then broke, from that one stale string:
 *
 *  - `@rebasepro/agent-skills` was never version-bumped and never published. It
 *    sat at 0.16.0 on npm through 0.17.0, 0.17.1 and 0.17.2.
 *  - Worse, and less obvious: `packages/cli` depends on it as `workspace:*`, and
 *    pnpm resolves that at publish time to *whatever version that package's own
 *    package.json holds*. So the published CLI carried a hard
 *    `"@rebasepro/agent-skills": "0.16.0"` — a pin nobody wrote, pointing four
 *    versions back. Every skill written or edited since that date reached no
 *    user at all, and `rebase skills install` kept writing the old set.
 *
 * The lesson is not "fix the path". It is that **a release must not enumerate
 * its own contents**: any hand-written list drifts from the workspace the moment
 * a directory moves or a package is added, and the failure is silent by
 * construction. This module is the single derivation, used by the workflow, by
 * the release script, and by the gate that holds them to it.
 *
 * Usage:
 *   node tooling/scripts/publishable-packages.mjs             # one name per line
 *   node tooling/scripts/publishable-packages.mjs --json      # full records
 *   node tooling/scripts/publishable-packages.mjs --dirs      # one path per line
 *   node tooling/scripts/publishable-packages.mjs --set-version 1.2.3
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The `packages:` globs from `pnpm-workspace.yaml`.
 *
 * Parsed by hand rather than with a YAML library, because this runs in the
 * release workflow before anything guarantees `node_modules` exists, and a
 * dependency here would be one more way for the release to fail at the worst
 * moment. The block it reads is a flat list of scalars, which is the one YAML
 * shape a line parser cannot get wrong — and `assertWorkspaceShape` below
 * refuses anything more complicated rather than misreading it.
 */
export function workspaceGlobs(root = ROOT) {
    const file = path.join(root, "pnpm-workspace.yaml");
    const lines = fs.readFileSync(file, "utf8").split("\n");

    const start = lines.findIndex(line => /^packages:\s*$/.test(line));
    if (start === -1) {
        throw new Error("pnpm-workspace.yaml has no `packages:` block — cannot derive the publishable set.");
    }

    const globs = [];
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(#.*)?$/.test(line)) continue;          // blank or comment
        const item = /^\s+-\s+(?:['"]?)([^'"#]+?)(?:['"]?)\s*(?:#.*)?$/.exec(line);
        if (item) {
            globs.push(item[1].trim());
            continue;
        }
        if (/^\S/.test(line)) break;                      // next top-level key
        throw new Error(
            `pnpm-workspace.yaml:${i + 1} is inside \`packages:\` but is not a plain list item: ${line.trim()}`
        );
    }

    if (globs.length === 0) {
        throw new Error("pnpm-workspace.yaml declares no workspace packages.");
    }
    return globs;
}

/** Every workspace member, private ones included. */
export function workspacePackages(root = ROOT) {
    const seen = new Map();

    for (const glob of workspaceGlobs(root)) {
        // `globSync` matches directories for a bare pattern; append the manifest
        // so a glob can only ever select a real package.
        for (const match of fs.globSync(`${glob}/package.json`, { cwd: root })) {
            const dir = path.dirname(match);
            if (seen.has(dir)) continue;
            let pkg;
            try {
                pkg = JSON.parse(fs.readFileSync(path.join(root, match), "utf8"));
            } catch (err) {
                throw new Error(`${match} is not readable JSON: ${err.message}`);
            }
            if (!pkg?.name) continue;   // the root manifest of a nested repo, etc.
            seen.set(dir, {
                name: pkg.name,
                dir,
                version: pkg.version ?? null,
                private: pkg.private === true
            });
        }
    }

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a release publishes: every workspace member not marked `private`.
 *
 * `private: true` is npm's own switch and the one the pack loop already read, so
 * this asks the same question the registry does rather than inventing a second
 * notion of publishable that could disagree with it.
 */
export function publishablePackages(root = ROOT) {
    return workspacePackages(root).filter(p => !p.private);
}

/**
 * Rewrite every publishable package's version, in place.
 *
 * Done here rather than as a `pnpm -r exec` one-liner so that the set being
 * written is the same set the gate checks — the two cannot drift, because there
 * is only one of them.
 *
 * @returns the packages it changed.
 */
export function setVersion(version, root = ROOT) {
    if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
        throw new Error(`Not a version: ${version}`);
    }

    const changed = [];
    for (const pkg of publishablePackages(root)) {
        const file = path.join(root, pkg.dir, "package.json");
        const raw = fs.readFileSync(file, "utf8");
        const json = JSON.parse(raw);
        if (json.version === version) continue;
        json.version = version;
        // Two-space JSON with a trailing newline: what the previous inline
        // bump wrote, so this does not reformat every manifest on first run.
        fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
        changed.push({ ...pkg, from: pkg.version, to: version });
    }
    return changed;
}

/* ── CLI ──────────────────────────────────────────────────────────── */

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    const at = args.indexOf("--set-version");

    if (at !== -1) {
        const version = args[at + 1];
        if (!version) {
            console.error("--set-version needs a version");
            process.exit(2);
        }
        const changed = setVersion(version);
        for (const pkg of changed) console.log(`  ${pkg.name}  ${pkg.from} → ${pkg.to}`);
        console.log(`✓ ${publishablePackages().length} publishable package(s) at ${version} (${changed.length} changed)`);
    } else if (args.includes("--json")) {
        console.log(JSON.stringify(publishablePackages(), null, 2));
    } else if (args.includes("--dirs")) {
        for (const pkg of publishablePackages()) console.log(pkg.dir);
    } else {
        for (const pkg of publishablePackages()) console.log(pkg.name);
    }
}
