/**
 * A command that spawns a child must say why the child never started.
 *
 * `schema.ts` and `doctor.ts` both ended their spawn in `catch {
 * process.exit(1); }` — the error object was not even bound. That is right for
 * one of the two failures they catch and wrong for the other:
 *
 *  - the child ran and exited non-zero → it printed its own diagnostics through
 *    inherited stdio, and repeating execa's "Command failed with exit code 1:
 *    …" adds a worse copy with the whole argv appended;
 *  - the child never started → ENOENT on tsx, EACCES on the script, ENOMEM on a
 *    full disk. **Nobody printed anything.** `rebase schema generate` against a
 *    half-installed tsx exited 1 in silence, and `rebase doctor` — the command
 *    whose entire job is to say what is wrong — did the same.
 *
 * The tsx symlink surviving a cleaned pnpm store is the ordinary way to reach
 * this: `resolveLocalBin` finds the symlink, so the "dependencies are not
 * installed" path never fires, and the spawn is where it breaks.
 */
import path from "path";
import fs from "fs";
import os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let scratch: string;

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        findProjectRoot: () => scratch,
        requireProjectRoot: () => scratch,
        requireBackendDir: () => path.join(scratch, "backend"),
        findEnvFile: () => path.join(scratch, ".env"),
        resolveTsx: () => "/nonexistent/.bin/tsx",
        getActiveBackendPlugin: () => "@rebasepro/server-postgres",
        resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.ts"
    };
});

/**
 * execa's shape, exactly. The preamble matters: it is identical to the one a
 * child that ran and exited non-zero gets, which is why matching on the message
 * could never tell the two apart.
 */
const ENOENT = Object.assign(
    new Error("Command failed with ENOENT: /nonexistent/.bin/tsx cli.ts\nspawn /nonexistent/.bin/tsx ENOENT"),
    { code: "ENOENT", originalMessage: "spawn /nonexistent/.bin/tsx ENOENT", exitCode: undefined }
);

vi.mock("execa", () => ({ execa: vi.fn(async () => { throw ENOENT; }) }));

import { schemaCommand } from "./schema";
import { doctorCommand } from "./doctor";

function argv(...line: string[]): string[] {
    return ["/usr/bin/node", "/usr/local/bin/rebase", ...line];
}

let errors: string[];

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-spawn-"));
    fs.mkdirSync(path.join(scratch, "backend"), { recursive: true });
    errors = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        errors.push(args.join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`process.exit(${code})`);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("a spawn that never starts is reported", () => {
    it("rebase schema generate prints the ENOENT", async () => {
        await expect(schemaCommand("generate", argv("schema", "generate")))
            .rejects.toThrow("process.exit(1)");

        expect(errors.join("\n")).toContain("spawn /nonexistent/.bin/tsx ENOENT");
    });

    it("rebase doctor prints the ENOENT", async () => {
        await expect(doctorCommand(argv("doctor")))
            .rejects.toThrow("process.exit(1)");

        expect(errors.join("\n")).toContain("spawn /nonexistent/.bin/tsx ENOENT");
    });
});

describe("a child that ran and failed is not narrated twice", () => {
    it("keeps execa's exit-code message to itself", async () => {
        const { execa } = await import("execa");
        (execa as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
            throw Object.assign(
                new Error("Command failed with exit code 1: tsx cli.ts schema generate"),
                { exitCode: 1 }
            );
        });

        await expect(schemaCommand("generate", argv("schema", "generate")))
            .rejects.toThrow("process.exit(1)");

        expect(errors.join("\n")).not.toContain("Command failed");
    });

    it("keeps quiet for a child something killed, too", async () => {
        const { execa } = await import("execa");
        (execa as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
            throw Object.assign(
                new Error("Command was killed with SIGTERM: tsx cli.ts schema generate"),
                { signal: "SIGTERM", exitCode: undefined }
            );
        });

        await expect(schemaCommand("generate", argv("schema", "generate")))
            .rejects.toThrow("process.exit(1)");

        expect(errors.join("\n")).not.toContain("SIGTERM");
    });
});
