/**
 * Setting a project up for the AI coding assistants a developer uses: the
 * Rebase skills, and the Rebase MCP server in each assistant's own config.
 *
 * `rebase init` used to end by *printing* `rebase skills install`, and nothing
 * ran it — so a generated project had pointer files telling every assistant to
 * read skills that were not there, and an MCP server only Claude Code knew
 * about. This asks once, while the project is being made, pre-ticking the
 * assistants installed on the machine.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import {
    AGENT_KEYS,
    AGENTS,
    type AgentKey,
    detectInstalledAgents,
    installSkills,
    type LoadedSkill,
    loadBundledSkills
} from "./skills";
import { detectPackageManager, type PackageManager } from "../utils/package-manager";
import { cliVersion } from "../utils/version";

/** The name the server is registered under, in every config. */
export const MCP_SERVER_NAME = "rebase";

/** The MCP server's package: a devDependency of the project, pinned with the rest. */
export const MCP_PACKAGE = "@rebasepro/mcp";

/** The bin {@link MCP_PACKAGE} declares. */
export const MCP_BIN = "rebase-mcp";

/** The command an assistant spawns, and its arguments. */
export interface McpLaunch {
    command: string;
    args: string[];
}

/**
 * How an assistant starts the Rebase MCP server: the project's own copy, through
 * the project's package manager.
 *
 * Not `npx -y @rebasepro/mcp`, which fetched the newest release on every first
 * start. The server drives the project's own CLI (`pnpm exec rebase …`) and calls
 * the project's own backend (`/api/admin/schema/plan`, …), whose versions the
 * lockfile pins — so a server from the registry ran ahead of both, at every
 * start, and downloaded before it could answer. `@rebasepro/mcp` is a
 * devDependency of the scaffold, pinned to the CLI's version like every other
 * `@rebasepro` package, and this runs that copy.
 *
 * `npx --no`, not `npx`: an assistant spawns the server with no TTY, and npx
 * then assumes "yes" and installs a missing package from the registry under the
 * name it was given. `--no` makes a missing install an error instead.
 */
export function mcpLaunch(pm: PackageManager): McpLaunch {
    return pm === "npm"
        ? { command: "npx", args: ["--no", MCP_BIN] }
        : { command: "pnpm", args: ["exec", MCP_BIN] };
}

/** What writing one MCP config did. */
export type McpWriteStatus =
    /** The file was created, or the server was added beside the ones in it. */
    | "added"
    /** A `rebase` server was already there. It is left exactly as it was. */
    | "present"
    /** The file exists but is not something this can edit without losing data. */
    | "unreadable";

export interface McpWriteResult {
    /** Project-relative path of the config file. */
    file: string;
    status: McpWriteStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Add the server to a JSON config under `key`, keeping everything else in it.
 *
 * A file that does not parse as plain JSON is left alone: VS Code and Gemini
 * both accept comments in these files, and rewriting one through
 * `JSON.stringify` would delete them. Refusing costs one line of hand-editing;
 * the alternative silently costs the developer theirs.
 */
function addJsonServer(filePath: string, key: string, entry: Record<string, unknown>): McpWriteStatus {
    let doc: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch {
            return "unreadable";
        }
        if (!isRecord(parsed)) return "unreadable";
        doc = parsed;
    }

    const servers = doc[key] ?? {};
    if (!isRecord(servers)) return "unreadable";
    if (MCP_SERVER_NAME in servers) return "present";

    doc[key] = { ...servers, [MCP_SERVER_NAME]: entry };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    return "added";
}

/**
 * The Codex block, as TOML. Appended rather than merged: there is no TOML
 * parser here, and an append keeps every byte already in the file.
 */
export function renderCodexServer(projectDir: string, launch: McpLaunch): string {
    // A JSON string literal is a valid TOML basic string for these values.
    const str = (v: string) => JSON.stringify(v);
    return [
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `command = ${str(launch.command)}`,
        `args = [${launch.args.map(str).join(", ")}]`,
        "",
        `[mcp_servers.${MCP_SERVER_NAME}.env]`,
        `REBASE_PROJECT_DIR = ${str(projectDir)}`,
        ""
    ].join("\n");
}

function addCodexServer(filePath: string, projectDir: string, launch: McpLaunch): McpWriteStatus {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    const table = new RegExp(`^\\s*\\[mcp_servers\\.(?:${MCP_SERVER_NAME}|"${MCP_SERVER_NAME}")\\]`, "m");
    if (table.test(existing)) return "present";

    const separator = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${existing}${separator}${renderCodexServer(projectDir, launch)}`, "utf-8");
    return "added";
}

/**
 * Register the Rebase MCP server in the agent's project-level config, started
 * through the project's package manager (see {@link mcpLaunch}).
 *
 * Returns null for an agent with no project-level config to write.
 */
export function writeMcpConfig(
    agentKey: AgentKey,
    projectDir: string,
    pm: PackageManager = detectPackageManager(projectDir)
): McpWriteResult | null {
    const mcp = AGENTS[agentKey].mcp;
    if (!mcp) return null;

    const filePath = path.join(projectDir, mcp.file);
    const env = { REBASE_PROJECT_DIR: mcp.projectDir };
    const { command, args } = mcpLaunch(pm);
    const write = (): McpWriteStatus => {
        switch (mcp.format) {
            case "mcpServers":
                return addJsonServer(filePath, "mcpServers", { command, args, env });
            case "vscode":
                // VS Code's own shape: `servers`, and an explicit transport.
                return addJsonServer(filePath, "servers", { type: "stdio", command, args, env });
            case "codexToml":
                return addCodexServer(filePath, mcp.projectDir, { command, args });
        }
    };
    return { file: mcp.file, status: write() };
}

/** What making sure the project depends on the MCP server did. */
export type McpDependencyStatus =
    /** Added to `devDependencies`, at this CLI's version: an install is due. */
    | "added"
    /** Already a dependency. Left at the version the project chose. */
    | "present"
    /** No `package.json`, or one that is not plain JSON: left alone. */
    | "unreadable";

/**
 * Make the project depend on {@link MCP_PACKAGE}, which the config written by
 * {@link writeMcpConfig} runs from the project's own install.
 *
 * Pinned to this CLI's version, as `rebase init` pins every `@rebasepro`
 * package; a project that already lists it keeps its own choice.
 */
export function ensureMcpDependency(projectDir: string): McpDependencyStatus {
    const manifestPath = path.join(projectDir, "package.json");
    if (!fs.existsSync(manifestPath)) return "unreadable";
    const text = fs.readFileSync(manifestPath, "utf-8");
    let manifest: unknown;
    try {
        manifest = JSON.parse(text);
    } catch {
        return "unreadable";
    }
    if (!isRecord(manifest)) return "unreadable";
    for (const field of ["dependencies", "devDependencies"] as const) {
        const deps = manifest[field];
        if (isRecord(deps) && MCP_PACKAGE in deps) return "present";
    }
    const devDependencies = isRecord(manifest.devDependencies) ? manifest.devDependencies : {};
    const version = cliVersion();
    manifest.devDependencies = { ...devDependencies, [MCP_PACKAGE]: version === "unknown" ? "latest" : version };
    // The file's own indentation, so the change is one line in a diff.
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, indent)}\n`, "utf-8");
    return "added";
}

/**
 * Point the scaffold's `.mcp.json` at the project's package manager.
 *
 * The template ships the pnpm spelling (`pnpm exec rebase-mcp`); an npm project
 * has no pnpm to run it with. Only the entry the template wrote is rewritten.
 */
export function retargetScaffoldMcpConfig(projectDir: string, pm: PackageManager): void {
    const filePath = path.join(projectDir, ".mcp.json");
    if (!fs.existsSync(filePath)) return;
    let doc: unknown;
    try {
        doc = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return;
    }
    const servers = isRecord(doc) ? doc.mcpServers : undefined;
    const entry = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
    const shipped = mcpLaunch("pnpm");
    if (!isRecord(doc) || !isRecord(servers) || !isRecord(entry)) return;
    if (entry.command !== shipped.command || JSON.stringify(entry.args) !== JSON.stringify(shipped.args)) return;
    const wanted = mcpLaunch(pm);
    if (wanted.command === shipped.command && JSON.stringify(wanted.args) === JSON.stringify(shipped.args)) return;
    servers[MCP_SERVER_NAME] = { ...entry, command: wanted.command, args: wanted.args };
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 4)}\n`, "utf-8");
}

/**
 * Whether the agent's project-level config already registers the Rebase
 * server: `null` for an agent that has no such config, `false` when the file
 * is missing or does not name it. Reads only — for the hint `rebase skills
 * install` prints when it was not asked to write one.
 */
export function mcpServerRegistered(agentKey: AgentKey, projectDir: string): boolean | null {
    const mcp = AGENTS[agentKey].mcp;
    if (!mcp) return null;
    const filePath = path.join(projectDir, mcp.file);
    if (!fs.existsSync(filePath)) return false;
    const text = fs.readFileSync(filePath, "utf-8");
    if (mcp.format === "codexToml") {
        return new RegExp(`^\\s*\\[mcp_servers\\.(?:${MCP_SERVER_NAME}|"${MCP_SERVER_NAME}")\\]`, "m").test(text);
    }
    try {
        const doc: unknown = JSON.parse(text);
        const servers = isRecord(doc) ? doc[mcp.format === "vscode" ? "servers" : "mcpServers"] : undefined;
        return isRecord(servers) && MCP_SERVER_NAME in servers;
    } catch {
        // Not plain JSON (comments): cannot tell, so do not nag.
        return null;
    }
}

/** What `configureAgents` did for one agent. */
export interface AgentSetupResult {
    agent: AgentKey;
    /** Skills written, or null when the bundle could not be loaded. */
    skills: number | null;
    /** An earlier agent in the same run that already wrote the skills directory. */
    sharedWith?: AgentKey;
    mcp: McpWriteResult | null;
}

/**
 * Install the skills and register the MCP server for each agent.
 *
 * Never throws for a missing skills bundle — the scaffold it runs inside must
 * not fail over its assistants — and reports it as `skills: null` instead.
 */
export function configureAgents(
    agents: readonly AgentKey[],
    projectDir: string,
    load: () => LoadedSkill[] = loadBundledSkills,
    pm: PackageManager = detectPackageManager(projectDir)
): { results: AgentSetupResult[]; skillsError?: string; mcpDependency?: McpDependencyStatus } {
    let skillsError: string | undefined;
    let installed: ReturnType<typeof installSkills> = [];
    try {
        installed = installSkills(agents, load(), projectDir);
    } catch (err) {
        skillsError = err instanceof Error ? err.message : String(err);
    }

    const results = agents.map((agent): AgentSetupResult => {
        const skills = installed.find(r => r.agent === agent);
        return {
            agent,
            skills: skills ? skills.skills : null,
            sharedWith: skills?.sharedWith,
            mcp: writeMcpConfig(agent, projectDir, pm)
        };
    });
    // A config that runs the project's copy of the server needs the project to
    // have one.
    const registered = results.some(r => r.mcp?.status === "added" || r.mcp?.status === "present");
    return { results, skillsError, ...(registered && { mcpDependency: ensureMcpDependency(projectDir) }) };
}

/** The line to print when {@link ensureMcpDependency} changed or could not change the manifest. */
export function mcpDependencyNote(status: McpDependencyStatus | undefined, pm: PackageManager): string | undefined {
    if (status === "added") {
        return `Added ${MCP_PACKAGE} to devDependencies — run \`${pm} install\` before your assistant starts it.`;
    }
    if (status === "unreadable") {
        return `Could not add ${MCP_PACKAGE} to package.json — add it to devDependencies by hand; the MCP config runs the project's own copy.`;
    }
    return undefined;
}

/** One line per agent, for the scaffold's output. */
export function printAgentSetup(
    { results, skillsError, mcpDependency }: ReturnType<typeof configureAgents>,
    pm: PackageManager = "pnpm"
): void {
    for (const result of results) {
        const agent = AGENTS[result.agent];
        const parts: string[] = [];

        if (result.sharedWith) {
            parts.push(`skills in ${chalk.gray(agent.targetDir)} ${chalk.gray(`(shared with ${AGENTS[result.sharedWith].label})`)}`);
        } else if (result.skills !== null) {
            parts.push(`${result.skills} skills in ${chalk.gray(agent.targetDir)}`);
        }

        if (result.mcp?.status === "added") {
            parts.push(`MCP server in ${chalk.gray(result.mcp.file)}`);
        } else if (result.mcp?.status === "present") {
            parts.push(`MCP server already in ${chalk.gray(result.mcp.file)}`);
        }

        // A tick is a claim that something was written; with nothing, it isn't.
        const mark = parts.length ? chalk.green("✓") : chalk.yellow("!");
        console.log(`  ${mark} ${chalk.bold(agent.label)}${parts.length ? ` — ${parts.join(", ")}` : ""}`);

        if (result.mcp?.status === "unreadable") {
            console.log(chalk.yellow(`    ${result.mcp.file} is not plain JSON, so it was left alone — add the "${MCP_SERVER_NAME}" server by hand.`));
        } else if (!result.mcp) {
            console.log(chalk.gray(`    ${agent.label} has no project-level MCP config — add @rebasepro/mcp in its MCP settings.`));
        }
    }

    const dependencyNote = mcpDependencyNote(mcpDependency, pm);
    if (dependencyNote) console.log(chalk.gray(`  ${dependencyNote}`));

    if (skillsError) {
        console.log(chalk.yellow(`  Could not install the Rebase skills: ${skillsError}`));
        console.log(chalk.yellow("  Run `rebase skills install` in the project once dependencies are installed."));
    }
}

/**
 * Ask whether to set up AI agents, then which, pre-ticking what is installed.
 *
 * Interactive only; the caller has already refused a non-TTY. Returns [] when
 * the developer says no or unticks everything.
 */
export async function promptForAgents(home?: string): Promise<AgentKey[]> {
    const { configure } = await inquirer.prompt([{
        type: "confirm",
        name: "configure",
        message: "Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)?",
        default: true
    }]);
    if (!configure) return [];

    // Installed first, so the pre-ticked boxes are the ones under the cursor.
    const detected = detectInstalledAgents(home);
    const installed = [...detected.filter(a => a.found), ...detected.filter(a => !a.found)];
    console.log("");
    console.log("Detecting installed AI coding agents...");
    for (const { label, marker, found } of installed) {
        if (found) console.log(`  ${chalk.green("✓")} ${label} — ${marker}`);
        else if (marker) console.log(chalk.gray(`  ✗ ${label} — ${marker} (not found)`));
        else console.log(chalk.gray(`  · ${label} — can't be detected; tick it below if you use it`));
    }
    console.log("");

    const { selectedAgents } = await inquirer.prompt([{
        type: "checkbox",
        name: "selectedAgents",
        message: "Select agents to configure:",
        choices: installed.map(({ key, label, found }) => {
            const { targetDir, mcp } = AGENTS[key];
            const writes = mcp ? `${targetDir} + ${mcp.file}` : targetDir;
            return { name: `${label} ${chalk.gray(`— ${writes}`)}`, short: label, value: key, checked: found };
        })
    }]);

    return AGENT_KEYS.filter(key => selectedAgents.includes(key));
}
