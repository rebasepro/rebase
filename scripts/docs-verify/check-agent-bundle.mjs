/**
 * The agent bundle's own manifests, against the packages they name.
 *
 * `rebase-agent-skills/` ships four launch configs — `.mcp.json` for Cursor,
 * `kiro/mcp.json`, `gemini-extension.json`, and the plugin manifests. Three of
 * them launched:
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
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";

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
        ["rebase-agent-skills/*.json", "rebase-agent-skills/.mcp.json", "rebase-agent-skills/*/*.json"],
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

    return { findings, scanned };
}
