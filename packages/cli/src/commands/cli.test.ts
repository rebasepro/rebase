/**
 * Tests for CLI command routing and entry point.
 *
 * Verifies that the CLI correctly routes commands, prints help,
 * handles unknown commands, and reports its version.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the routing logic by importing the entry function and mocking
// the individual command handlers. This avoids spawning child processes.

// Mock all command modules before importing the CLI
vi.mock("./init", () => ({
    createRebaseApp: vi.fn()
}));
vi.mock("./generate_sdk", () => ({
    generateSdkCommand: vi.fn()
}));
vi.mock("./schema", () => ({
    schemaCommand: vi.fn()
}));
vi.mock("./db", () => ({
    dbCommand: vi.fn()
}));
vi.mock("./dev", () => ({
    devCommand: vi.fn()
}));
vi.mock("./build", () => ({
    buildCommand: vi.fn()
}));
vi.mock("./start", () => ({
    startCommand: vi.fn()
}));
vi.mock("./auth", () => ({
    authCommand: vi.fn()
}));
vi.mock("./doctor", () => ({
    doctorCommand: vi.fn()
}));
vi.mock("./cloud", () => ({
    cloudCommand: vi.fn()
}));
// Spread the real module rather than listing the two exports this file cares
// about. A hand-listed mock fails the whole suite the day a command imports a
// third helper — which is what happened when `readEnvFile` was added — and the
// failure names the mock, not the import, so it reads as a broken test.
vi.mock("../utils/project", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    requireProjectRoot: vi.fn(() => "/projects/shop")
}));

import path from "path";
import { entry } from "../cli";
import { requireProjectRoot } from "../utils/project";
import { cloudCommand } from "./cloud";
import { createRebaseApp } from "./init";
import { schemaCommand } from "./schema";
import { dbCommand } from "./db";
import { devCommand } from "./dev";
import { buildCommand } from "./build";
import { startCommand } from "./start";
import { authCommand } from "./auth";
import { generateSdkCommand } from "./generate_sdk";

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let processExitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Don't let process.exit kill the test runner
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
});

afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
});

describe("CLI routing", () => {
    it("routes 'init' to createRebaseApp", async () => {
        const args = ["node", "rebase", "init", "my-app"];
        await entry(args);
        expect(createRebaseApp).toHaveBeenCalledWith(args);
    });

    it("routes 'dev' to devCommand", async () => {
        const args = ["node", "rebase", "dev"];
        await entry(args);
        expect(devCommand).toHaveBeenCalledWith(args);
    });

    it("routes 'schema generate' to schemaCommand", async () => {
        const args = ["node", "rebase", "schema", "generate"];
        await entry(args);
        expect(schemaCommand).toHaveBeenCalledWith("generate", args);
    });

    it("routes 'db push' to dbCommand", async () => {
        const args = ["node", "rebase", "db", "push"];
        await entry(args);
        expect(dbCommand).toHaveBeenCalledWith("push", args);
    });

    it("routes 'auth reset-password' to authCommand", async () => {
        const args = ["node", "rebase", "auth", "reset-password"];
        await entry(args);
        expect(authCommand).toHaveBeenCalledWith("reset-password", args);
    });

    it("routes 'cloud login' to cloudCommand", async () => {
        const args = ["node", "rebase", "cloud", "login"];
        await entry(args);
        expect(cloudCommand).toHaveBeenCalledWith("login", args);
    });

    it("passes --help through to cloud", async () => {
        const args = ["node", "rebase", "cloud", "--help"];
        await entry(args);
        expect(cloudCommand).toHaveBeenCalledWith("--help", args);
    });

    /**
     * `permissive: true` is required here — every command parses its own flags,
     * so this parser has to pass through what it does not recognise. But `arg`
     * does not skip an undeclared flag, it appends it to `_` beside the
     * positionals. `rebase cloud --json storage create` therefore gave
     * `_ = ["cloud", "--json", "storage", "create"]` and the subcommand read as
     * "--json", which `cloudCommand` then took for the resource group.
     *
     * The subcommand is now the second *word*, ignoring flags.
     */
    it("names the subcommand past a flag written before it", async () => {
        const args = ["node", "rebase", "cloud", "--json", "storage", "create"];
        await entry(args);
        expect(cloudCommand).toHaveBeenCalledWith("storage", args);
    });

    it("names the command past a flag written before it", async () => {
        const args = ["node", "rebase", "--json", "db", "push"];
        await entry(args);
        expect(dbCommand).toHaveBeenCalledWith("push", args);
    });

    /**
     * What this level cannot fix, recorded so the limit is deliberate rather
     * than discovered: a flag that takes a value leaves the value in `_` as a
     * bare token, and which flags take values is known only to the command
     * itself. So `--project acme` still yields "acme" as the subcommand here.
     *
     * That is why `cloudCommand` resolves the group from its own positionals
     * against its own flag spec instead of trusting this argument — see the
     * dispatch tests in cloud/cloud-commands.test.ts. This asserts the handoff
     * still happens with the full argv, which is what makes that recovery
     * possible.
     */
    it("hands cloud the whole argv, since only cloud can parse cloud's flags", async () => {
        const args = ["node", "rebase", "cloud", "--project", "acme", "storage", "create"];
        await entry(args);
        expect(cloudCommand).toHaveBeenCalledWith("acme", args);
    });

    it("routes 'build' to buildCommand", async () => {
        await entry(["node", "rebase", "build"]);
        expect(buildCommand).toHaveBeenCalled();
    });

    it("routes 'start' to startCommand", async () => {
        await entry(["node", "rebase", "start"]);
        expect(startCommand).toHaveBeenCalled();
    });

    it("passes --help through to namespaced commands", async () => {
        const args = ["node", "rebase", "schema", "--help"];
        await entry(args);
        expect(schemaCommand).toHaveBeenCalledWith("--help", args);
    });

    it("prints help when no command is given", async () => {
        await entry(["node", "rebase"]);
        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("rebase");
        expect(output).toContain("Commands");
    });

    it("prints help when --help is given with no command", async () => {
        await entry(["node", "rebase", "--help"]);
        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Commands");
    });

    it("shows an error for unknown commands and exits non-zero", async () => {
        await entry(["node", "rebase", "foobar"]);

        // The message goes to stderr, and the exit code must not read as success
        // to a shell or CI script.
        const errOutput = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(errOutput).toContain("Unknown command");
        expect(processExitSpy).toHaveBeenCalledWith(1);

        // Help is still printed to stdout so the user sees the valid commands.
        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Commands");
    });
});

describe("generate-sdk resolves its defaults from the project root", () => {
    /*
     * `./config/collections` was resolved against the cwd, so this command
     * worked from a repository root and threw "Collections directory not found"
     * one directory down — from `backend/`, from `frontend/` — while every
     * sibling command (`db push`, `dev`, `doctor`) worked from all of them,
     * because they resolve the root first.
     */
    it("defaults both paths to the project root, not the cwd", async () => {
        await entry(["node", "rebase", "generate-sdk"]);

        expect(generateSdkCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                collectionsDir: path.join("/projects/shop", "config/collections"),
                output: path.join("/projects/shop", "generated/sdk")
            })
        );
    });

    it("leaves an explicitly passed path alone — that one means the cwd", async () => {
        await entry(["node", "rebase", "generate-sdk", "--collections-dir", "./elsewhere", "--output", "./out"]);

        expect(generateSdkCommand).toHaveBeenCalledWith(
            expect.objectContaining({ collectionsDir: "./elsewhere",
output: "./out" })
        );
    });

    it("does not demand a project root just to print its help", async () => {
        await entry(["node", "rebase", "generate-sdk", "--help"]);

        expect(generateSdkCommand).toHaveBeenCalledWith(
            expect.objectContaining({ help: true })
        );
        expect(requireProjectRoot).not.toHaveBeenCalled();
    });

    /**
     * `permissive: true` does not relax parsing — it moves an undeclared flag
     * into the positionals. So `--ouput ./sdk` was accepted, ignored, and never
     * mentioned: the SDK went to the default path and the next build imported a
     * stale one. Nothing in this command reads a positional, so there was
     * nowhere for the mistake to surface.
     */
    it("rejects a misspelled flag instead of writing to the default path", async () => {
        await expect(entry(["node", "rebase", "generate-sdk", "--ouput", "./sdk"]))
            .rejects.toThrow(/unknown or unexpected option: --ouput/);
        expect(generateSdkCommand).not.toHaveBeenCalled();
    });

    /**
     * The line was parsed from a fixed `args.slice(3)`, so anything before the
     * command word shifted it — and `--debug` is what the CLI prints after
     * *every* failure as the thing to re-run with. `rebase --debug generate-sdk
     * -o ./sdk` therefore dropped `-o` and wrote to the project default.
     */
    it("reads its flags wherever they appear on the line", async () => {
        await entry(["node", "rebase", "--debug", "generate-sdk", "-o", "./sdk"]);

        expect(generateSdkCommand).toHaveBeenCalledWith(
            expect.objectContaining({ output: "./sdk" })
        );
    });

    it("refuses a bare word it has no meaning for", async () => {
        await expect(entry(["node", "rebase", "generate-sdk", "./sdk"]))
            .rejects.toThrow(/takes 0 arguments/);
    });
});
