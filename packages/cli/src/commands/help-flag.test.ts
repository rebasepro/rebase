/**
 * `--help` describes a command; it must never run one.
 *
 * `cli.ts` only rewrites the subcommand to `"--help"` when the user named no
 * subcommand, on the stated assumption that "a handler that parses its own flags
 * sees the request whichever branch this takes". Three handlers did not parse
 * it, and each did real work for a flag whose entire job is to print text:
 *
 *  - `rebase skills install --help` **wrote files** — it detected the agents in
 *    the project and overwrote `.claude/skills/<name>/SKILL.md`, the Cursor
 *    rules and the rest, with no diff, no backup and no prompt.
 *  - `rebase auth reset-password --help` took `--help` as the email, contacted
 *    the backend, then wrote `.tmp-reset-password.ts` into the user's `backend/`
 *    and ran a database UPDATE for a user named `--help`.
 *  - `rebase api-keys list --help` listed the keys; `rebase api-keys revoke
 *    --help` sent `DELETE /api/admin/api-keys/--help`.
 *
 * These assert the *outcome* rather than the printed page: no HTTP request, no
 * file written, no exit. `apps`, `start`, `telemetry` and the whole `cloud`
 * family already behaved this way.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let scratch: string;

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        // Both spellings: `skills` falls back to the cwd, the others exit.
        findProjectRoot: () => scratch,
        requireProjectRoot: () => scratch,
        requireBackendDir: () => path.join(scratch, "backend"),
        findEnvFile: () => path.join(scratch, ".env"),
        readEnvFile: () => ({
            REBASE_SERVICE_KEY: "svc_test",
            SERVICE_KEY: "svc_test",
            REBASE_BASE_URL: "http://127.0.0.1:9"
        }),
        resolveTsx: () => "/bin/true"
    };
});

import { apiKeysCommand } from "./api-keys";
import { authCommand } from "./auth";
import { skillsCommand } from "./skills";

/** A full `process.argv`, the way `cli.ts` hands it to a command. */
function argv(...line: string[]): string[] {
    return ["/usr/bin/node", "/usr/local/bin/rebase", ...line];
}

/** Every file under a directory. */
function filesUnder(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...filesUnder(full));
        else out.push(full);
    }
    return out;
}

let fetchSpy: ReturnType<typeof vi.fn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-help-"));
    // `.claude/` is what `skills install` detects — without it the install has
    // nothing to write and the test would pass for the wrong reason.
    fs.mkdirSync(path.join(scratch, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "backend"), { recursive: true });

    fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`process.exit(${code})`);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(scratch, { recursive: true,
force: true });
});

describe("--help never runs the command", () => {
    it("rebase skills install --help writes nothing", async () => {
        await skillsCommand("install", argv("skills", "install", "--help"));

        expect(filesUnder(path.join(scratch, ".claude"))).toEqual([]);
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("rebase auth reset-password --help contacts nothing and writes nothing", async () => {
        await authCommand("reset-password", argv("auth", "reset-password", "--help"));

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(filesUnder(path.join(scratch, "backend"))).toEqual([]);
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("rebase api-keys list --help lists nothing", async () => {
        await apiKeysCommand("list", argv("api-keys", "list", "--help"));

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("rebase api-keys revoke --help deletes nothing", async () => {
        await apiKeysCommand("revoke", argv("api-keys", "revoke", "--help"));

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
