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
vi.mock("./auth", () => ({
    authCommand: vi.fn()
}));

import { entry } from "../cli";
import { createRebaseApp } from "./init";
import { schemaCommand } from "./schema";
import { dbCommand } from "./db";
import { devCommand } from "./dev";
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

    it("routes 'db studio' to dbCommand", async () => {
        const args = ["node", "rebase", "db", "studio"];
        await entry(args);
        expect(dbCommand).toHaveBeenCalledWith("studio", args);
    });

    it("routes 'auth reset-password' to authCommand", async () => {
        const args = ["node", "rebase", "auth", "reset-password"];
        await entry(args);
        expect(authCommand).toHaveBeenCalledWith("reset-password", args);
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

    it("shows an error for unknown commands", async () => {
        await entry(["node", "rebase", "foobar"]);
        const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Unknown command");
    });
});
