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

/** The name the server is registered under, in every config. */
export const MCP_SERVER_NAME = "rebase";
const MCP_COMMAND = "npx";
const MCP_ARGS = ["-y", "@rebasepro/mcp"];

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
export function renderCodexServer(projectDir: string): string {
    // A JSON string literal is a valid TOML basic string for these values.
    const str = (v: string) => JSON.stringify(v);
    return [
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `command = ${str(MCP_COMMAND)}`,
        `args = [${MCP_ARGS.map(str).join(", ")}]`,
        "",
        `[mcp_servers.${MCP_SERVER_NAME}.env]`,
        `REBASE_PROJECT_DIR = ${str(projectDir)}`,
        ""
    ].join("\n");
}

function addCodexServer(filePath: string, projectDir: string): McpWriteStatus {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    const table = new RegExp(`^\\s*\\[mcp_servers\\.(?:${MCP_SERVER_NAME}|"${MCP_SERVER_NAME}")\\]`, "m");
    if (table.test(existing)) return "present";

    const separator = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${existing}${separator}${renderCodexServer(projectDir)}`, "utf-8");
    return "added";
}

/**
 * Register the Rebase MCP server in the agent's project-level config.
 *
 * Returns null for an agent with no project-level config to write.
 */
export function writeMcpConfig(agentKey: AgentKey, projectDir: string): McpWriteResult | null {
    const mcp = AGENTS[agentKey].mcp;
    if (!mcp) return null;

    const filePath = path.join(projectDir, mcp.file);
    const env = { REBASE_PROJECT_DIR: mcp.projectDir };
    const write = (): McpWriteStatus => {
        switch (mcp.format) {
            case "mcpServers":
                return addJsonServer(filePath, "mcpServers", { command: MCP_COMMAND, args: MCP_ARGS, env });
            case "vscode":
                // VS Code's own shape: `servers`, and an explicit transport.
                return addJsonServer(filePath, "servers", { type: "stdio", command: MCP_COMMAND, args: MCP_ARGS, env });
            case "codexToml":
                return addCodexServer(filePath, mcp.projectDir);
        }
    };
    return { file: mcp.file, status: write() };
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
    load: () => LoadedSkill[] = loadBundledSkills
): { results: AgentSetupResult[]; skillsError?: string } {
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
            mcp: writeMcpConfig(agent, projectDir)
        };
    });
    return { results, skillsError };
}

/** One line per agent, for the scaffold's output. */
export function printAgentSetup({ results, skillsError }: ReturnType<typeof configureAgents>): void {
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
