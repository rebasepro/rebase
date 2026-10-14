/**
 * Ctrl-C at an `init` prompt, and the refusals `init` raises itself.
 *
 * `bin/rebase.js` prints every failure as `✗ <message>` and then "Re-run with
 * --debug for the stack trace." A cancelled prompt reached it as inquirer's
 * `ExitPromptError` — `✗ User force closed the prompt with SIGINT`, an error,
 * then the hint — when nothing had gone wrong at all: Ctrl-C exits quietly,
 * with 130. And a refusal that says why is marked, so the hint is not added
 * under a message that has no stack worth reading (`utils/refusal.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import inquirer from "inquirer";

import { createRebaseApp } from "./init";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

/** What inquirer throws on Ctrl-C. */
class ExitPromptError extends Error {
    override name = "ExitPromptError";
}

let home: string;
let workdir: string;
let cwd: string;
let errors: string[];
let wasTTY: boolean | undefined;

beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-cancel-home-")));
    workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-cancel-")));
    cwd = process.cwd();
    process.chdir(workdir);
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("REBASE_E2E", "1");
    vi.stubEnv("DO_NOT_TRACK", "");
    vi.stubEnv("REBASE_TELEMETRY_DISABLED", "");
    vi.stubEnv("CI", "");
    errors = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
    wasTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.spyOn(inquirer, "prompt").mockRejectedValue(new ExitPromptError("User force closed the prompt with SIGINT") as never);
});

afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: wasTTY, configurable: true });
    process.chdir(cwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(workdir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
});

async function exitCodeOf(run: Promise<void>): Promise<number | "returned"> {
    try {
        await run;
        return "returned";
    } catch (error) {
        if (error instanceof Exited) return error.code;
        throw error;
    }
}

describe("Ctrl-C at an init prompt", () => {
    it("exits 130, says nothing is wrong, and creates nothing", async () => {
        expect(await exitCodeOf(createRebaseApp(["node", "rebase", "init"]))).toBe(130);

        expect(errors.join("\n")).not.toContain("force closed");
        expect(fs.readdirSync(workdir)).toEqual([]);
    });

    it("is a decline at the last question, and the scaffold it follows stands", async () => {
        // `--yes` answers everything but the usage-data question, which is
        // asked at the very end, on a terminal.
        expect(await exitCodeOf(createRebaseApp(["node", "rebase", "init", "my-app", "--yes", "--template", "blank"]))).toBe("returned");

        expect(errors.join("\n")).not.toContain("force closed");
        expect(fs.existsSync(path.join(workdir, "my-app", "package.json"))).toBe(true);
    });
});

describe("a refusal init raises itself", () => {
    it("is marked, so no --debug hint follows it", async () => {
        await expect(createRebaseApp([
            "node", "rebase", "init", "url-app", "--yes", "--template", "blank",
            "--database-url", "postgres://u:p@127.0.0.1:5432/app\nEXTRA=1"
        ])).rejects.toMatchObject({ isRefusal: true, message: expect.stringContaining("multiline") });
    });
});
