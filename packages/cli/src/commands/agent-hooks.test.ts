/**
 * The Claude Code guardrail: the PostToolUse hook every scaffold ships, which
 * runs `rebase verify --quiet` after an edit under `config/collections/`.
 *
 * Two halves. `installAgentHooks` — what `rebase skills --hooks` does to a
 * project that predates the hook — must add the hook without disturbing a
 * settings file the developer already has. And the script itself, run the way
 * Claude Code runs it: the tool call as JSON on stdin, `CLAUDE_PROJECT_DIR` in
 * the environment, exit 2 with the problems on stderr when the agent has
 * something to fix. A stand-in `node_modules/.bin/rebase` plays the CLI, so this
 * tests the script's contract rather than the verifier (`verify.test.ts` does
 * that).
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AGENT_HOOK_SCRIPT, AGENT_HOOK_SETTINGS, installAgentHooks } from "./agent-setup";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const TEMPLATE = path.join(PACKAGE_ROOT, "templates", "template");

let project: string;

beforeEach(() => {
    project = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-agent-hooks-"));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

function readSettings(): { hooks: { PostToolUse: { matcher: string; hooks: { command: string }[] }[] } } & Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(project, AGENT_HOOK_SETTINGS), "utf-8"));
}

describe("installAgentHooks", () => {
    it("writes the template's script and settings into a project that has neither", () => {
        const results = installAgentHooks(project);
        expect(results).toEqual([
            { file: AGENT_HOOK_SCRIPT, status: "added" },
            { file: AGENT_HOOK_SETTINGS, status: "added" }
        ]);
        expect(fs.readFileSync(path.join(project, AGENT_HOOK_SCRIPT), "utf-8"))
            .toBe(fs.readFileSync(path.join(TEMPLATE, AGENT_HOOK_SCRIPT), "utf-8"));
        expect(fs.statSync(path.join(project, AGENT_HOOK_SCRIPT)).mode & 0o111).not.toBe(0);
        expect(readSettings().hooks.PostToolUse[0].hooks[0].command).toContain("post-edit-collection.sh");
    });

    it("merges into existing settings, keeping every hook and setting already there", () => {
        fs.mkdirSync(path.join(project, ".claude"));
        fs.writeFileSync(path.join(project, AGENT_HOOK_SETTINGS), JSON.stringify({
            permissions: { allow: ["Bash(pnpm test)"] },
            hooks: {
                PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
                PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo post" }] }]
            }
        }, null, 2));

        expect(installAgentHooks(project)[1].status).toBe("added");
        const settings = readSettings();
        expect(settings.permissions).toEqual({ allow: ["Bash(pnpm test)"] });
        expect(settings.hooks.PostToolUse.map(entry => entry.hooks[0].command)).toEqual([
            "echo post",
            "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/post-edit-collection.sh\""
        ]);
        expect(settings.hooks).toHaveProperty("PreToolUse");
    });

    it("is a no-op the second time", () => {
        installAgentHooks(project);
        const before = fs.readFileSync(path.join(project, AGENT_HOOK_SETTINGS), "utf-8");
        expect(installAgentHooks(project).map(r => r.status)).toEqual(["present", "present"]);
        expect(fs.readFileSync(path.join(project, AGENT_HOOK_SETTINGS), "utf-8")).toBe(before);
    });

    it("keeps an edited script unless forced", () => {
        installAgentHooks(project);
        fs.writeFileSync(path.join(project, AGENT_HOOK_SCRIPT), "#!/bin/sh\nexit 0\n");
        expect(installAgentHooks(project)[0].status).toBe("kept");
        expect(fs.readFileSync(path.join(project, AGENT_HOOK_SCRIPT), "utf-8")).toBe("#!/bin/sh\nexit 0\n");
        expect(installAgentHooks(project, { force: true })[0].status).toBe("replaced");
    });

    it("leaves a settings file that is not plain JSON alone", () => {
        fs.mkdirSync(path.join(project, ".claude"));
        fs.writeFileSync(path.join(project, AGENT_HOOK_SETTINGS), "{ // a comment\n}\n");
        expect(installAgentHooks(project)[1].status).toBe("unreadable");
        expect(fs.readFileSync(path.join(project, AGENT_HOOK_SETTINGS), "utf-8")).toBe("{ // a comment\n}\n");
    });
});

describe("post-edit-collection.sh", () => {
    /** A stand-in CLI: records that it ran, prints `output`, exits `code`. */
    function fakeRebase(code: number, output: string): void {
        const bin = path.join(project, "node_modules", ".bin");
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(project, "output.txt"), output);
        fs.writeFileSync(path.join(bin, "rebase"), [
            "#!/usr/bin/env bash",
            `echo "$@" > "${path.join(project, "ran")}"`,
            `cat "${path.join(project, "output.txt")}"`,
            `exit ${code}`
        ].join("\n"), { mode: 0o755 });
    }

    function runHook(filePath: string) {
        return spawnSync("bash", [path.join(TEMPLATE, AGENT_HOOK_SCRIPT)], {
            input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: filePath } }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: project },
            encoding: "utf-8"
        });
    }

    it("ignores an edit outside config/collections without running anything", () => {
        fakeRebase(1, "should not run");
        const result = runHook(path.join(project, "frontend", "src", "App.tsx"));
        expect(result.status).toBe(0);
        expect(fs.existsSync(path.join(project, "ran"))).toBe(false);
    });

    it("runs `rebase verify --quiet` after a collection edit and stays silent when it passes", () => {
        fakeRebase(0, "");
        const result = runHook(path.join(project, "config", "collections", "posts.ts"));
        expect(result.status).toBe(0);
        expect(fs.readFileSync(path.join(project, "ran"), "utf-8").trim()).toBe("verify --quiet");
        expect(result.stderr).toBe("");
    });

    it("hands the verifier's findings to the agent with exit 2 when it fails", () => {
        const finding = "✗ config/collections/posts.ts → posts.properties.title.widget  `widget` is no longer read here.";
        fakeRebase(1, finding);
        const result = runHook(path.join(project, "config", "collections", "posts.ts"));
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("rebase verify failed after editing config/collections/posts.ts");
        expect(result.stderr).toContain(finding);
        expect(result.stderr).toContain("Fix them in config/collections/");
    });

    it("does not block the edit when the project's CLI predates `rebase verify`", () => {
        fakeRebase(1, "✗ Unknown command \"verify\" — did you mean `version`? Run `rebase --help` for the rest.");
        const result = runHook(path.join(project, "config", "collections", "posts.ts"));
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("predates `rebase verify`");
        expect(result.stderr).not.toContain("Fix them in config/collections/");
    });

    it("checks an edit Claude Code reports with a Windows path", () => {
        fakeRebase(1, "✗ config/collections/posts.ts → posts.securityRules  missing.");
        const result = runHook("C:\\Users\\me\\shop\\config\\collections\\posts.ts");
        expect(result.status).toBe(2);
        expect(fs.readFileSync(path.join(project, "ran"), "utf-8").trim()).toBe("verify --quiet");
    });
});
