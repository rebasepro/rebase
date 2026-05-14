/**
 * Tests for package manager detection and command abstraction.
 *
 * Verifies that the detection logic correctly identifies pnpm/npm
 * from environment variables, lock files, and defaults, and that
 * the command builders produce correct arguments for each PM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { detectPackageManager, getPMCommands } from "./package-manager";
import type { PackageManager, PMCommands } from "./package-manager";

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pm-test-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Restore env
    delete process.env.npm_config_user_agent;
});

// =============================================================================
// Detection
// =============================================================================

describe("detectPackageManager", () => {
    describe("user agent detection", () => {
        it("detects npm from npm_config_user_agent", () => {
            process.env.npm_config_user_agent = "npm/10.2.0 node/v20.11.0 darwin arm64";
            expect(detectPackageManager(tmpDir)).toBe("npm");
        });

        it("detects pnpm from npm_config_user_agent", () => {
            process.env.npm_config_user_agent = "pnpm/8.15.4 npm/? node/v20.11.0 darwin arm64";
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });

        it("user agent takes precedence over lock files", () => {
            process.env.npm_config_user_agent = "npm/10.2.0 node/v20.11.0";
            // Even with pnpm-lock.yaml present, npm_config_user_agent wins
            fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");
            expect(detectPackageManager(tmpDir)).toBe("npm");
        });
    });

    describe("lock file detection", () => {
        it("detects npm from package-lock.json in target dir", () => {
            delete process.env.npm_config_user_agent;
            fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
            expect(detectPackageManager(tmpDir)).toBe("npm");
        });

        it("detects pnpm from pnpm-lock.yaml in target dir", () => {
            delete process.env.npm_config_user_agent;
            fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });

        it("prefers package-lock.json over pnpm-lock.yaml when both exist", () => {
            delete process.env.npm_config_user_agent;
            fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
            fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");
            // package-lock.json is checked first
            expect(detectPackageManager(tmpDir)).toBe("npm");
        });
    });

    describe("default behavior", () => {
        it("defaults to pnpm when no signals are present", () => {
            delete process.env.npm_config_user_agent;
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });

        it("defaults to pnpm when no target dir is provided", () => {
            delete process.env.npm_config_user_agent;
            expect(detectPackageManager()).toBe("pnpm");
        });
    });
});

// =============================================================================
// Command builders
// =============================================================================

describe("getPMCommands", () => {
    describe("pnpm commands", () => {
        let cmds: PMCommands;

        beforeEach(() => {
            cmds = getPMCommands("pnpm");
        });

        it("has the correct name", () => {
            expect(cmds.name).toBe("pnpm");
        });

        it("produces correct install command", () => {
            expect(cmds.install).toEqual(["pnpm", "install"]);
        });

        it("produces correct run command", () => {
            expect(cmds.run("dev")).toEqual(["pnpm", "run", "dev"]);
            expect(cmds.run("build")).toEqual(["pnpm", "run", "build"]);
        });

        it("produces correct exec command", () => {
            expect(cmds.exec("rebase", ["schema", "generate"])).toEqual([
                "pnpm", "exec", "rebase", "schema", "generate"
            ]);
        });

        it("produces correct view command", () => {
            expect(cmds.view("@rebasepro/cli", "version")).toEqual([
                "pnpm", "view", "@rebasepro/cli", "version"
            ]);
        });

        it("produces correct runAll command", () => {
            expect(cmds.runAll("build")).toEqual(["pnpm", "-r", "run", "build"]);
        });

        it("produces correct runWorkspace command", () => {
            expect(cmds.runWorkspace("backend", "start")).toEqual([
                "pnpm", "--filter", "backend", "start"
            ]);
        });

        it("uses workspace:* protocol", () => {
            expect(cmds.workspaceProtocol).toBe("workspace:*");
        });
    });

    describe("npm commands", () => {
        let cmds: PMCommands;

        beforeEach(() => {
            cmds = getPMCommands("npm");
        });

        it("has the correct name", () => {
            expect(cmds.name).toBe("npm");
        });

        it("produces correct install command", () => {
            expect(cmds.install).toEqual(["npm", "install"]);
        });

        it("produces correct run command", () => {
            expect(cmds.run("dev")).toEqual(["npm", "run", "dev"]);
            expect(cmds.run("build")).toEqual(["npm", "run", "build"]);
        });

        it("produces correct exec command", () => {
            expect(cmds.exec("rebase", ["schema", "generate"])).toEqual([
                "npx", "rebase", "schema", "generate"
            ]);
        });

        it("produces correct view command", () => {
            expect(cmds.view("@rebasepro/cli", "version")).toEqual([
                "npm", "view", "@rebasepro/cli", "version"
            ]);
        });

        it("produces correct runAll command", () => {
            expect(cmds.runAll("build")).toEqual([
                "npm", "run", "build", "--workspaces", "--if-present"
            ]);
        });

        it("produces correct runWorkspace command", () => {
            expect(cmds.runWorkspace("backend", "start")).toEqual([
                "npm", "run", "start", "-w", "backend"
            ]);
        });

        it("uses * protocol (no workspace: prefix)", () => {
            expect(cmds.workspaceProtocol).toBe("*");
        });
    });
});

// =============================================================================
// Type safety
// =============================================================================

describe("type contracts", () => {
    it("detectPackageManager returns only 'pnpm' or 'npm'", () => {
        const validValues: PackageManager[] = ["pnpm", "npm"];
        delete process.env.npm_config_user_agent;
        const result = detectPackageManager(tmpDir);
        expect(validValues).toContain(result);
    });

    it("PMCommands.run returns a new array each time", () => {
        const cmds = getPMCommands("pnpm");
        const a = cmds.run("dev");
        const b = cmds.run("dev");
        expect(a).toEqual(b);
        expect(a).not.toBe(b); // different references
    });

    it("PMCommands.exec returns a new array each time", () => {
        const cmds = getPMCommands("npm");
        const args = ["schema", "generate"];
        const a = cmds.exec("rebase", args);
        const b = cmds.exec("rebase", args);
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
    });
});
