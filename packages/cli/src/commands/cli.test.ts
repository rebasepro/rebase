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

import { entry } from "../cli";
import { cloudCommand } from "./cloud";
import { createRebaseApp } from "./init";
import { schemaCommand } from "./schema";
import { dbCommand } from "./db";
import { devCommand } from "./dev";
import { buildCommand } from "./build";
import { startCommand } from "./start";
import { authCommand } from "./auth";

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
