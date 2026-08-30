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
        resolveTsx: () => "/bin/true",
        // Enough for `db push` to reach the child process, so the assertion
        // below is "the spawn did not happen" rather than "the command failed
        // earlier for an unrelated reason".
        getActiveBackendPlugin: () => "@rebasepro/server-postgres",
        resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
    };
});

// The two doors out of `rebase db <action>`: resolving (and starting) a
// database, and spawning the driver. Both are watched, because `--help` must
// go through neither.
vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));
vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({ env: {} })),
    managedNotices: () => []
}));

import { apiKeysCommand } from "./api-keys";
import { authCommand } from "./auth";
import { skillsCommand } from "./skills";
import { dbCommand } from "./db";
import { execa } from "execa";
import { prepareDatabaseEnv } from "../dev-db/prepare";

const execaSpy = execa as unknown as ReturnType<typeof vi.fn>;
const prepareSpy = prepareDatabaseEnv as unknown as ReturnType<typeof vi.fn>;

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

    /**
     * The worst of the set, and the one still shipping at 0.17.0.
     *
     * `cli.ts` rewrites the subcommand to `"--help"` only when the user named
     * none, so `rebase db --help` printed a page and `rebase db push --help`
     * did not: the flag travelled through `runDriverDbCommand`, which resolves
     * — and will START — the development database, and then handed the whole
     * line to the driver, whose dispatch has no `--help` case for `push`. It
     * applied the schema. A help flag that mutates a database is a different
     * order of problem from one that prints the wrong page.
     *
     * Asserted as "nothing ran": no child process, no database resolution, no
     * exit. `execa` and `prepare` are the two doors out of this command and
     * both are watched, so a future refactor that reintroduces the path fails
     * here rather than on someone's database.
     */
    it.each([["push"], ["migrate"], ["generate"], ["restore"], ["backup"]])(
        "rebase db %s --help touches no database",
        async (action) => {
            await dbCommand(action, argv("db", action, "--help"));

            expect(execaSpy).not.toHaveBeenCalled();
            expect(prepareSpy).not.toHaveBeenCalled();
            expect(exitSpy).not.toHaveBeenCalled();
        }
    );

    it("still runs the command without the flag", async () => {
        // The guard must not swallow real invocations: a `--help` check that
        // matched too eagerly would disable `db push` instead of fixing help.
        await dbCommand("push", argv("db", "push"));
        expect(execaSpy).toHaveBeenCalled();
    });
});
