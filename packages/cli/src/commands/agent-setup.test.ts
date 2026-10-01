/**
 * Setting a new project up for the developer's AI coding agents.
 *
 * What these pin is the part a person cannot see from the prompt: that the
 * config each agent is handed is one it reads, in the shape it reads it, and
 * that writing it never costs the developer anything already in the file — a
 * second MCP server, a comment, a hand-edited entry. The prompt itself is
 * inquirer's; what reaches the disk is ours.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    configureAgents,
    ensureMcpDependency,
    MCP_BIN,
    MCP_PACKAGE,
    MCP_SERVER_NAME,
    mcpLaunch,
    retargetScaffoldMcpConfig,
    writeMcpConfig
} from "./agent-setup";
import { AGENT_KEYS, AGENTS, detectInstalledAgents, type LoadedSkill, resolveAgentNames } from "./skills";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, "../../templates/template");
const MCP_MANIFEST = path.resolve(HERE, "../../../mcp/package.json");

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-agent-setup-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(scratch, rel), "utf-8"));

/** One skill, so an install is cheap and its result countable. */
const oneSkill = (): LoadedSkill[] => {
    const dir = path.join(scratch, "src-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n# Demo\n");
    return [{ name: "demo", dir, content: "# Demo\n", assets: [] }];
};

describe("writeMcpConfig", () => {
    it("registers the server where each agent reads it, in that agent's shape", () => {
        const expected = {
            claude: { file: ".mcp.json", key: "mcpServers", dir: "." },
            cursor: { file: ".cursor/mcp.json", key: "mcpServers", dir: "${workspaceFolder}" },
            gemini: { file: ".gemini/settings.json", key: "mcpServers", dir: "." },
            kiro: { file: ".kiro/settings/mcp.json", key: "mcpServers", dir: "." },
            copilot: { file: ".vscode/mcp.json", key: "servers", dir: "${workspaceFolder}" }
        } as const;

        for (const [agent, { file, key, dir }] of Object.entries(expected)) {
            const result = writeMcpConfig(agent as keyof typeof expected, scratch, "pnpm");
            expect(result).toEqual({ file, status: "added" });
            expect(readJson(file)).toMatchObject({
                [key]: {
                    [MCP_SERVER_NAME]: {
                        command: "pnpm",
                        args: ["exec", "rebase-mcp"],
                        env: { REBASE_PROJECT_DIR: dir }
                    }
                }
            });
        }
    });

    it("gives VS Code the explicit stdio transport its format requires", () => {
        writeMcpConfig("copilot", scratch, "pnpm");
        expect(readJson(".vscode/mcp.json")).toMatchObject({ servers: { rebase: { type: "stdio" } } });
    });

    it("writes Codex's project config as TOML", () => {
        expect(writeMcpConfig("codex", scratch, "pnpm")).toEqual({ file: ".codex/config.toml", status: "added" });
        expect(fs.readFileSync(path.join(scratch, ".codex/config.toml"), "utf-8")).toBe([
            "[mcp_servers.rebase]",
            "command = \"pnpm\"",
            "args = [\"exec\", \"rebase-mcp\"]",
            "",
            "[mcp_servers.rebase.env]",
            "REBASE_PROJECT_DIR = \".\"",
            ""
        ].join("\n"));
    });

    it("has nothing to write for Windsurf, which reads only a user-level config", () => {
        expect(writeMcpConfig("windsurf", scratch, "pnpm")).toBeNull();
        expect(fs.readdirSync(scratch)).toEqual([]);
    });

    it("keeps every other server and setting in an existing JSON config", () => {
        fs.mkdirSync(path.join(scratch, ".gemini"));
        fs.writeFileSync(path.join(scratch, ".gemini/settings.json"), JSON.stringify({
            theme: "dark",
            mcpServers: { github: { command: "gh-mcp" } }
        }));

        expect(writeMcpConfig("gemini", scratch, "pnpm")?.status).toBe("added");
        expect(readJson(".gemini/settings.json")).toEqual({
            theme: "dark",
            mcpServers: {
                github: { command: "gh-mcp" },
                rebase: { command: "pnpm", args: ["exec", "rebase-mcp"], env: { REBASE_PROJECT_DIR: "." } }
            }
        });
    });

    it("leaves an existing rebase entry exactly as the developer wrote it", () => {
        const mine = `${JSON.stringify({ mcpServers: { rebase: { command: "node", env: { REBASE_API_TOKEN: "rk_live_x" } } } })}\n`;
        fs.writeFileSync(path.join(scratch, ".mcp.json"), mine);

        expect(writeMcpConfig("claude", scratch, "pnpm")?.status).toBe("present");
        expect(fs.readFileSync(path.join(scratch, ".mcp.json"), "utf-8")).toBe(mine);
    });

    it("refuses to rewrite a config with comments rather than delete them", () => {
        const jsonc = "{\n  // my servers\n  \"servers\": {}\n}\n";
        fs.mkdirSync(path.join(scratch, ".vscode"));
        fs.writeFileSync(path.join(scratch, ".vscode/mcp.json"), jsonc);

        expect(writeMcpConfig("copilot", scratch, "pnpm")?.status).toBe("unreadable");
        expect(fs.readFileSync(path.join(scratch, ".vscode/mcp.json"), "utf-8")).toBe(jsonc);
    });

    it("appends to an existing Codex config without touching what is there", () => {
        const existing = "model = \"gpt-5\"\n\n[mcp_servers.github]\ncommand = \"gh-mcp\"\n";
        fs.mkdirSync(path.join(scratch, ".codex"));
        fs.writeFileSync(path.join(scratch, ".codex/config.toml"), existing);

        expect(writeMcpConfig("codex", scratch, "pnpm")?.status).toBe("added");
        const after = fs.readFileSync(path.join(scratch, ".codex/config.toml"), "utf-8");
        expect(after.startsWith(existing)).toBe(true);
        expect(after).toContain("\n[mcp_servers.rebase]\n");

        expect(writeMcpConfig("codex", scratch, "pnpm")?.status).toBe("present");
        expect(fs.readFileSync(path.join(scratch, ".codex/config.toml"), "utf-8")).toBe(after);
    });

    it("is already satisfied by the .mcp.json the scaffold ships", () => {
        // `rebase init` copies the template's `.mcp.json` before this runs. If
        // the two ever named the server differently, Claude Code would get two.
        fs.copyFileSync(path.join(TEMPLATE, ".mcp.json"), path.join(scratch, ".mcp.json"));
        expect(writeMcpConfig("claude", scratch, "pnpm")?.status).toBe("present");
    });
});

describe("the MCP server is the project's own, pinned copy", () => {
    // `npx -y @rebasepro/mcp` fetched the newest release on every first start,
    // ahead of the CLI and the backend the project pins — the server drives the
    // first and calls the second.
    it("runs the bin @rebasepro/mcp declares, through the project's package manager", () => {
        const manifest = JSON.parse(fs.readFileSync(MCP_MANIFEST, "utf-8")) as { name: string; bin: Record<string, string> };
        expect(manifest.name).toBe(MCP_PACKAGE);
        expect(Object.keys(manifest.bin)).toContain(MCP_BIN);
        expect(mcpLaunch("pnpm")).toEqual({ command: "pnpm", args: ["exec", MCP_BIN] });
        // With no TTY npx assumes "yes" and installs a missing package from the
        // registry by the name it was given; `--no` refuses instead.
        expect(mcpLaunch("npm")).toEqual({ command: "npx", args: ["--no", MCP_BIN] });
    });

    it("is a devDependency of the scaffold, pinned with the other @rebasepro packages", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "package.json"), "utf-8")) as {
            devDependencies: Record<string, string>;
        };
        expect(manifest.devDependencies[MCP_PACKAGE]).toBe("workspace:*");
        const shipped = JSON.parse(fs.readFileSync(path.join(TEMPLATE, ".mcp.json"), "utf-8")) as {
            mcpServers: Record<string, { command: string; args: string[] }>;
        };
        expect(shipped.mcpServers[MCP_SERVER_NAME]).toMatchObject(mcpLaunch("pnpm"));
    });

    it("writes the npm spelling for an npm project, the scaffold's included", () => {
        expect(writeMcpConfig("cursor", scratch, "npm")?.status).toBe("added");
        expect(readJson(".cursor/mcp.json")).toMatchObject({ mcpServers: { rebase: mcpLaunch("npm") } });

        fs.copyFileSync(path.join(TEMPLATE, ".mcp.json"), path.join(scratch, ".mcp.json"));
        retargetScaffoldMcpConfig(scratch, "npm");
        expect(readJson(".mcp.json")).toMatchObject({
            mcpServers: { rebase: { ...mcpLaunch("npm"), env: { REBASE_PROJECT_DIR: "." } } }
        });
    });

    it("leaves a .mcp.json the developer changed alone", () => {
        const mine = `${JSON.stringify({ mcpServers: { rebase: { command: "node", args: ["x.js"] } } })}\n`;
        fs.writeFileSync(path.join(scratch, ".mcp.json"), mine);
        retargetScaffoldMcpConfig(scratch, "npm");
        expect(fs.readFileSync(path.join(scratch, ".mcp.json"), "utf-8")).toBe(mine);
    });

    it("adds the package to an existing project that lacks it, keeping the file's indentation", () => {
        fs.writeFileSync(path.join(scratch, "package.json"), `${JSON.stringify({ name: "app", devDependencies: { tsx: "1" } }, null, 2)}\n`);
        expect(ensureMcpDependency(scratch)).toBe("added");
        const text = fs.readFileSync(path.join(scratch, "package.json"), "utf-8");
        expect(text).toContain(`\n  "devDependencies": {\n    "tsx": "1",\n    "${MCP_PACKAGE}": `);
        expect(ensureMcpDependency(scratch)).toBe("present");
    });

    it("keeps the version a project already chose", () => {
        const manifest = `${JSON.stringify({ name: "app", devDependencies: { [MCP_PACKAGE]: "0.1.0" } })}\n`;
        fs.writeFileSync(path.join(scratch, "package.json"), manifest);
        expect(ensureMcpDependency(scratch)).toBe("present");
        expect(fs.readFileSync(path.join(scratch, "package.json"), "utf-8")).toBe(manifest);
    });

    it("registering a server makes sure the project has it", () => {
        fs.writeFileSync(path.join(scratch, "package.json"), "{}\n");
        const { mcpDependency } = configureAgents(["claude"], scratch, oneSkill, "pnpm");
        expect(mcpDependency).toBe("added");
        expect(readJson("package.json")).toMatchObject({ devDependencies: { [MCP_PACKAGE]: expect.any(String) } });
    });
});

describe("configureAgents", () => {
    it("installs the skills and registers the server for each agent", () => {
        const { results, skillsError } = configureAgents(["claude", "cursor"], scratch, oneSkill, "pnpm");
        expect(skillsError).toBeUndefined();
        expect(results).toEqual([
            { agent: "claude", skills: 1, sharedWith: undefined, mcp: { file: ".mcp.json", status: "added" } },
            { agent: "cursor", skills: 1, sharedWith: undefined, mcp: { file: ".cursor/mcp.json", status: "added" } }
        ]);
        expect(fs.existsSync(path.join(scratch, ".claude/skills/demo/SKILL.md"))).toBe(true);
        expect(fs.existsSync(path.join(scratch, ".cursor/rules/rebase.mdc"))).toBe(true);
    });

    it("writes a skills directory two agents share once", () => {
        const { results } = configureAgents(["gemini", "codex"], scratch, oneSkill, "pnpm");
        expect(results.map(r => [r.agent, r.sharedWith])).toEqual([["gemini", undefined], ["codex", "gemini"]]);
        expect(fs.existsSync(path.join(scratch, ".agents/skills/demo/SKILL.md"))).toBe(true);
    });

    it("still writes the MCP configs when the skills bundle cannot be loaded", () => {
        const { results, skillsError } = configureAgents(["cursor"], scratch, () => {
            throw new Error("bundle missing");
        }, "pnpm");
        expect(skillsError).toBe("bundle missing");
        expect(results).toEqual([{ agent: "cursor", skills: null, sharedWith: undefined, mcp: { file: ".cursor/mcp.json", status: "added" } }]);
    });
});

describe("detectInstalledAgents", () => {
    it("finds an agent by its home directory, and nothing in an empty home", () => {
        expect(detectInstalledAgents(scratch).filter(a => a.found)).toEqual([]);

        fs.mkdirSync(path.join(scratch, ".claude"));
        fs.mkdirSync(path.join(scratch, ".codeium/windsurf"), { recursive: true });
        const found = detectInstalledAgents(scratch).filter(a => a.found);
        expect(found.map(a => [a.key, a.marker])).toEqual([
            ["claude", "~/.claude"],
            ["windsurf", "~/.codeium/windsurf"]
        ]);
    });

    it("reports every agent, so the prompt can list the ones not found", () => {
        expect(detectInstalledAgents(scratch).map(a => a.key)).toEqual(AGENT_KEYS);
    });

    it("never claims Copilot, which has no directory of its own", () => {
        fs.mkdirSync(path.join(scratch, ".vscode"));
        fs.mkdirSync(path.join(scratch, ".github"));
        expect(detectInstalledAgents(scratch).find(a => a.key === "copilot")).toMatchObject({ found: false, marker: null });
    });
});

describe("resolveAgentNames", () => {
    it("reads repeated and comma-separated values, once each", () => {
        expect(resolveAgentNames(["claude,cursor", "claude"])).toEqual(["claude", "cursor"]);
    });

    it("expands all to every agent", () => {
        expect(resolveAgentNames(["all"])).toEqual(AGENT_KEYS);
    });

    it("returns null when nothing was named", () => {
        expect(resolveAgentNames([])).toBeNull();
        expect(resolveAgentNames([" , "])).toBeNull();
    });

    it("refuses a name that is not an agent, naming the ones that are", () => {
        expect(() => resolveAgentNames(["claude,copliot"])).toThrow(/Unknown agent\(s\): copliot\. Available: .*copilot/);
    });
});

describe("the agent table", () => {
    it("gives every agent with an MCP config a file no other agent writes", () => {
        const files = AGENT_KEYS.map(k => AGENTS[k].mcp?.file).filter(f => f !== undefined);
        expect(new Set(files).size).toBe(files.length);
    });
});
