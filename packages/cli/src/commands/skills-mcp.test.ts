/**
 * `rebase skills install --mcp` sets an existing project up the way `rebase
 * init --agent` sets up a new one: the skills, and the Rebase MCP server in the
 * agent's own config.
 *
 * Only `init --agent` registered the server, and `init` refuses a directory
 * that already holds a project — so a project scaffolded before agent setup
 * existed, or one whose author declined the prompt, had no command that would
 * do it. `skills install --agent cursor` wrote 21 skills and no
 * `.cursor/mcp.json`, while the docs framed it as the way to set an agent up.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_KEYS, AGENTS, skillsCommand } from "./skills";

let scratch: string;
let cwd: string;
let printed: string[];

beforeEach(() => {
    cwd = process.cwd();
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-skills-mcp-")));
    fs.writeFileSync(path.join(scratch, "rebase.json"), JSON.stringify({ rebase: "^1", apps: {} }));
    process.chdir(scratch);
    printed = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
    });
});

afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(scratch, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// eslint-disable-next-line no-control-regex
const output = () => printed.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

describe("rebase skills install --mcp", () => {
    it("registers the MCP server beside the skills", async () => {
        await skillsCommand("install", ["node", "rebase", "skills", "install", "--agent", "cursor", "--mcp"]);

        expect(fs.existsSync(path.join(scratch, ".cursor", "rules", "rebase.mdc"))).toBe(true);
        const config = JSON.parse(fs.readFileSync(path.join(scratch, ".cursor", "mcp.json"), "utf8"));
        expect(config.mcpServers.rebase).toBeDefined();
        expect(output()).toContain(".cursor/mcp.json");
    });

    it("keeps the servers already in the file, and says the Rebase one is already there on a rerun", async () => {
        fs.writeFileSync(path.join(scratch, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
        await skillsCommand("install", ["node", "rebase", "skills", "install", "--agent", "claude", "--mcp"]);
        await skillsCommand("install", ["node", "rebase", "skills", "install", "--agent", "claude", "--mcp"]);

        const config = JSON.parse(fs.readFileSync(path.join(scratch, ".mcp.json"), "utf8"));
        expect(Object.keys(config.mcpServers).sort()).toEqual(["other", "rebase"]);
        expect(output()).toMatch(/already in .*\.mcp\.json/);
    });

    it("without --mcp writes no MCP config, and says how to add it", async () => {
        await skillsCommand("install", ["node", "rebase", "skills", "install", "--agent", "cursor"]);

        expect(fs.existsSync(path.join(scratch, ".cursor", "mcp.json"))).toBe(false);
        expect(output()).toContain("rebase skills install --agent cursor --mcp");
    });

    // Every config format the server can be written in — JSON `mcpServers`,
    // VS Code's `servers`, Codex's TOML — is read back the same way.
    it.each(AGENT_KEYS.filter(key => AGENTS[key].mcp))("says nothing about --mcp once %s has the server", async agent => {
        await skillsCommand("install", ["node", "rebase", "skills", "install", "--agent", agent, "--mcp"]);
        printed = [];
        await skillsCommand("install", ["node", "rebase", "skills", "install", "--agent", agent]);
        expect(output()).not.toContain("--mcp");
    });
});
