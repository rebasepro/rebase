/**
 * The agent bundle's own manifests, against the packages they name.
 *
 * `tooling/rebase-agent-skills/` used to ship four launch configs — `.mcp.json`
 * for Cursor, `kiro/mcp.json`, `gemini-extension.json`, and two plugin
 * manifests. Three of them launched:
 *
 *     node node_modules/@rebasepro/mcp/dist/cli.js
 *
 * `@rebasepro/mcp` has never had a `cli.ts`, so it has never built a
 * `dist/cli.js`; `main` is `dist/index.js` and `bin` is `bin/rebase-mcp.js`.
 * Node exits `ERR_MODULE_NOT_FOUND` before the server says anything, and five
 * skills tell the agent to prefer MCP tools over writing API calls by hand — so
 * every agent that adopted the bundle got a dead server and a skill insisting it
 * use it.
 *
 * Nothing could have caught that: it is JSON, so no markdown glob sees it, and
 * the string it gets wrong is a *file path inside another package*. This check
 * resolves it. For a `node <path>` launch the path must exist in the workspace
 * package it names; for `npx`/`pnpm dlx` the package must exist and must expose
 * a bin to run.
 *
 * Those four manifests are gone — no installer ever looked where they sat, and
 * `files: ["skills/"]` kept them out of the tarball too — but the check stays,
 * because the next one added has to be right, and this is the shape of wrong it
 * would be.
 *
 * `checkToolNames` and `checkRepositoryUrls` are the other two halves, for the
 * same class in prose: a file here can name a *tool* or a *repository* that does
 * not exist. See their own docblocks.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";
import { loadMcpTools } from "./mcp-tools.mjs";

/** Launchers whose first non-flag argument is a package name, not a path. */
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx"]);

/** Workspace packages, by name. */
function loadWorkspacePackages(root) {
    const packages = new Map();
    for (const rel of globSync("packages/*/package.json", { cwd: root })) {
        try {
            const pkg = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
            if (pkg?.name) packages.set(pkg.name, { dir: path.dirname(rel), pkg });
        } catch { /* unreadable package.json is not this check's business */ }
    }
    return packages;
}

/** `node_modules/@rebasepro/mcp/dist/cli.js` → `["@rebasepro/mcp", "dist/cli.js"]`. */
function splitModulePath(arg) {
    const parts = arg.split("/");
    const at = parts.indexOf("node_modules");
    if (at === -1) return null;
    const rest = parts.slice(at + 1);
    if (!rest.length) return null;
    const name = rest[0].startsWith("@") ? rest.slice(0, 2).join("/") : rest.slice(0, 1).join("/");
    const inner = rest.slice(name.includes("/") ? 2 : 1).join("/");
    return [name, inner];
}

/** Files a package publishes as an entrypoint, for the "did you mean" hint. */
function entrypointsOf(pkg) {
    const out = [];
    if (pkg.main) out.push(pkg.main);
    if (typeof pkg.bin === "string") out.push(pkg.bin);
    else if (pkg.bin) out.push(...Object.values(pkg.bin));
    return out;
}

function checkServer(root, packages, rel, name, server, findings) {
    const where = `${rel} › mcpServers.${name}`;
    const command = server?.command;
    const args = Array.isArray(server?.args) ? server.args : [];
    if (typeof command !== "string") {
        findings.push({ file: rel, message: `${where}: no \`command\`` });
        return;
    }

    const positional = args.filter(a => typeof a === "string" && !a.startsWith("-"));

    if (PACKAGE_RUNNERS.has(command) || (command === "pnpm" && args[0] === "dlx")) {
        const target = command === "pnpm" ? positional[1] : positional[0];
        if (!target) {
            findings.push({ file: rel, message: `${where}: \`${command}\` with no package to run` });
            return;
        }
        if (!target.startsWith("@rebasepro/")) return;
        const found = packages.get(target);
        if (!found) {
            findings.push({ file: rel, message: `${where}: \`${target}\` is not a package in this workspace` });
            return;
        }
        if (!found.pkg.bin) {
            findings.push({
                file: rel,
                message: `${where}: \`${command}\` needs a bin, and \`${target}\` declares none`
            });
        }
        return;
    }

    if (command !== "node") return;

    const arg = positional[0];
    if (!arg) {
        findings.push({ file: rel, message: `${where}: \`node\` with nothing to run` });
        return;
    }
    const split = splitModulePath(arg);
    if (!split) return; // A project-relative script; not this check's business.

    const [pkgName, inner] = split;
    if (!pkgName.startsWith("@rebasepro/")) return;
    const found = packages.get(pkgName);
    if (!found) {
        findings.push({ file: rel, message: `${where}: \`${pkgName}\` is not a package in this workspace` });
        return;
    }
    // `dist/` is a build artifact, so the source that produces it is what has to
    // exist — otherwise the check passes on a machine that happened to build.
    const source = inner.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
    if (existsSync(path.join(root, found.dir, inner)) || existsSync(path.join(root, found.dir, source))) return;

    findings.push({
        file: rel,
        message:
            `${where}: \`${pkgName}\` has no \`${inner}\` — neither the built file nor \`${source}\` exists. ` +
            `It publishes: ${entrypointsOf(found.pkg).join(", ") || "(nothing)"}.`
    });
}

export function checkAgentBundle(root) {
    const packages = loadWorkspacePackages(root);
    const findings = [];
    let scanned = 0;

    const manifests = globSync(
        ["tooling/rebase-agent-skills/*.json", "tooling/rebase-agent-skills/.mcp.json", "tooling/rebase-agent-skills/*/*.json"],
        { cwd: root }
    );

    for (const rel of manifests) {
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
        } catch (err) {
            findings.push({ file: rel, message: `not valid JSON — ${err.message}` });
            continue;
        }
        if (!manifest?.mcpServers || typeof manifest.mcpServers !== "object") continue;
        scanned++;
        for (const [name, server] of Object.entries(manifest.mcpServers)) {
            checkServer(root, packages, rel, name, server, findings);
        }
    }

    checkToolNames(root, findings);
    checkRepositoryUrls(root, findings);

    return { findings, scanned };
}

/**
 * GitHub URLs that claim to be *this* project, against the repository its
 * package.json declares.
 *
 * `tooling/rebase-agent-skills/README.md` offered six ways to install, and five of them
 * routed through `github.com/rebaseco/agent-skills` — a standalone mirror that
 * does not exist. `npx skills add`, `gemini extensions install`, `claude plugin
 * marketplace add` and a `git clone` all resolved to a 404, and the two plugin
 * manifests advertised the same address as their `homepage` and `repository`.
 * The one path that worked, `rebase skills install`, was Option 1 and the only
 * one that needs no repository at all.
 *
 * Checking that a URL *resolves* would need the network, which a gate must not.
 * Checking that it names the repository this package declares needs nothing, and
 * is what actually went wrong.
 *
 * Only first-party-looking URLs are checked, and "first-party-looking" is the
 * whole design of this check: an owner one or two characters from ours
 * (`rebaseco` for `rebasepro`), or a repo literally named after this bundle. A
 * skill that links `github.com/nvm-sh/nvm` for installing nvm is documentation
 * doing its job, and a check that flagged it would be turned off within a week.
 *
 * `<!-- docs-verify: ignore -->` exempts the block that follows, which the one
 * paragraph that has to *name* the dead repository in order to warn about it
 * needs.
 */
function checkRepositoryUrls(root, findings) {
    let declared;
    try {
        const pkg = JSON.parse(readFileSync(path.join(root, "tooling/rebase-agent-skills/package.json"), "utf8"));
        const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
        declared = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:$|[/#?])/.exec(url ?? "")?.[1];
    } catch { /* no package.json is a different problem */ }
    if (!declared) return;

    const declaredOwner = declared.split("/")[0];

    /** Levenshtein, bounded — only used to answer "is this a typo of our org?". */
    const near = (a, b) => {
        if (a === b) return true;
        if (Math.abs(a.length - b.length) > 2) return false;
        let prev = [...Array(b.length + 1).keys()];
        for (let i = 1; i <= a.length; i++) {
            const row = [i];
            for (let j = 1; j <= b.length; j++) {
                row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = row;
        }
        return prev[b.length] <= 2;
    };

    for (const rel of globSync(["tooling/rebase-agent-skills/**/*.md", "tooling/rebase-agent-skills/**/*.json"], { cwd: root })) {
        if (rel.split(path.sep).some(part => part === "node_modules")) continue;
        const lines = readFileSync(path.join(root, rel), "utf8").split("\n");

        const skip = new Set();
        for (let i = 0; i < lines.length; i++) {
            if (!/<!--\s*docs-verify:\s*ignore\s*-->/.test(lines[i])) continue;
            skip.add(i + 1);
            let j = i + 1;
            while (j < lines.length && lines[j].trim() === "") j++;
            for (; j < lines.length && lines[j].trim() !== ""; j++) skip.add(j + 1);
        }

        const reported = new Set();
        lines.forEach((line, i) => {
            if (skip.has(i + 1)) return;
            for (const m of line.matchAll(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=$|[\s/#?)"'`])/g)) {
                const [owner, repo] = [m[1], m[2]];
                const named = `${owner}/${repo}`;
                if (named === declared || owner === "sponsors") continue;
                const firstParty = near(owner, declaredOwner) || repo === "agent-skills";
                if (!firstParty || reported.has(named)) continue;
                reported.add(named);
                findings.push({
                    file: `${rel}:${i + 1}`,
                    message:
                        `names \`github.com/${named}\`, but this bundle is published from ` +
                        `\`github.com/${declared}\` (its package.json says so). A repository that ` +
                        `does not exist answers 404 for every install command built on it.`
                });
            }
        });
    }
}

/**
 * `rebase_*` names written in the bundle, against the tools that exist.
 *
 * Kiro's POWER.md advertised "Generate collection schemas with AI" and "Export
 * collection data" as MCP capabilities. Neither is a tool, and neither has ever
 * been one — the file was written from a product pitch rather than from
 * `ALL_TOOLS`. That manifest is deleted now, but the failure mode is the skills'
 * too: five of them tell the agent to prefer MCP tools over hand-written API
 * calls, so a tool name in this bundle is an instruction, and an invented one is
 * an instruction that cannot be followed.
 *
 * Two sources of truth, both derived:
 *
 *   - `ALL_TOOLS` in `packages/mcp/src/index.ts`, for what the server registers.
 *   - every `rebase_…` identifier that appears anywhere in package source, for
 *     the ones that are not tools at all — `rebase_user` is a Postgres role and
 *     `rebase_entity_changes` is a NOTIFY channel, and both are correct to
 *     write. The rule is not "must be a tool", it is "must be a real thing".
 */
function knownRebaseIdentifiers(root) {
    const known = new Set();
    for (const rel of globSync("packages/*/src/**/*.ts", { cwd: root })) {
        if (rel.split(path.sep).some(part => part === "node_modules")) continue;
        let source;
        try {
            source = readFileSync(path.join(root, rel), "utf8");
        } catch {
            continue;
        }
        for (const m of source.matchAll(/\brebase_[a-z0-9_]+\b/g)) known.add(m[0]);
    }
    return known;
}

function checkToolNames(root, findings) {
    const tools = new Set(loadMcpTools(root).groups.flatMap(g => g.tools.map(t => t.name)));
    // A resolution failure would pass every file silently. Say so instead.
    if (!tools.size) {
        findings.push({
            file: "packages/mcp/src/index.ts",
            message: "ALL_TOOLS parsed to nothing — the tool-name check is not running."
        });
        return;
    }
    const known = knownRebaseIdentifiers(root);

    for (const rel of globSync(["tooling/rebase-agent-skills/**/*.md", "tooling/rebase-agent-skills/**/*.json"], { cwd: root })) {
        if (rel.split(path.sep).some(part => part === "node_modules")) continue;
        const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
        const reported = new Set();
        lines.forEach((line, i) => {
            for (const m of line.matchAll(/`(rebase_[a-z0-9_]+)`/g)) {
                const name = m[1];
                if (tools.has(name) || known.has(name) || reported.has(name)) continue;
                reported.add(name);
                findings.push({
                    file: `${rel}:${i + 1}`,
                    message:
                        `names \`${name}\`, which is neither a tool in ALL_TOOLS nor an identifier ` +
                        "anywhere in package source. Five skills tell the agent to prefer MCP tools " +
                        "over hand-written API calls, so a name here is an instruction."
                });
            }
        });
    }
}
