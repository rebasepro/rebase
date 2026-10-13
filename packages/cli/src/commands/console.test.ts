/**
 * `rebase console`: the CLI's half — the line is checked strictly, the
 * database is resolved the way `rebase db push` resolves it, and the driver is
 * handed `console …` with the paths made absolute and the history file named.
 *
 * The driver's half (`server-postgres/src/cli-console.ts`) is exercised against
 * a real database in `server-postgres/test/e2e/open-rebase-e2e.test.ts`.
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
        requireProjectRoot: () => scratch,
        requireBackendDir: () => path.join(scratch, "backend"),
        findEnvFile: () => null,
        getActiveBackendPlugin: () => "@rebasepro/server-postgres",
        resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.ts"
    };
});

vi.mock("../dev-db/prepare", async importOriginal => {
    const actual = await importOriginal<typeof import("../dev-db/prepare")>();
    return {
        ...actual,
        devDatabaseKind: () => "managed",
        prepareDatabaseEnv: vi.fn(async (_root: string, options: { onProgress?: (line: string) => void }) => {
            options.onProgress?.("Starting the development database…");
            return {
                database: { kind: "managed", source: "managed" },
                env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:54329/managed", REBASE_DB_POOL_MAX: "1" },
                description: "the managed development database"
            };
        }),
        managedNotices: () => ["Using the managed development database."]
    };
});

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));

import { execa } from "execa";
import { consoleCommand } from "./console";
import { prepareDatabaseEnv } from "../dev-db/prepare";

const execaSpy = vi.mocked(execa);
const prepareSpy = vi.mocked(prepareDatabaseEnv);
let stdout: string[];
let stderr: string[];

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-console-"));
    fs.mkdirSync(path.join(scratch, "backend"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
    execaSpy.mockClear();
    prepareSpy.mockClear();
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
});

/** What the driver was spawned with: its argv after the script, and its environment. */
function spawned(): { args: string[]; env: Record<string, string> } {
    expect(execaSpy).toHaveBeenCalledTimes(1);
    const [, argv, options] = execaSpy.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    const script = argv.indexOf("/tmp/rebase-test-plugin-cli.ts");
    return { args: argv.slice(script + 1), env: options.env };
}

describe("rebase console", () => {
    it("--eval hands the driver the code, the history file and the resolved database", async () => {
        await consoleCommand(["node", "rebase", "console", "-e", "rebase.sql('select 1')"]);

        const { args, env } = spawned();
        expect(args).toEqual([
            "console", "-e", "rebase.sql('select 1')",
            `--history=${path.join(scratch, ".rebase", "console_history")}`
        ]);
        expect(env.DATABASE_URL).toBe("postgresql://postgres@127.0.0.1:54329/managed");
        expect(env.REBASE_DB_POOL_MAX).toBe("1");
    });

    it("--eval keeps stdout for the result: the database notices go to stderr", async () => {
        await consoleCommand(["node", "rebase", "console", "--eval", "1 + 1"]);
        expect(stdout).toEqual([]);
        expect(stderr.join("\n")).toContain("Using the managed development database.");
    });

    it("resolves --collections from where the command was run, not from backend/", async () => {
        const cwd = process.cwd();
        process.chdir(scratch);
        try {
            await consoleCommand(["node", "rebase", "console", "--collections", "config/collections"]);
        } finally {
            process.chdir(cwd);
        }
        expect(spawned().args).toContain(fs.realpathSync(path.join(scratch, "config", "collections")));
    });

    it("refuses an unknown flag before a database is resolved", async () => {
        await expect(consoleCommand(["node", "rebase", "console", "--evel", "1"])).rejects.toThrow(/--evel/);
        expect(prepareSpy).not.toHaveBeenCalled();
        expect(execaSpy).not.toHaveBeenCalled();
    });

    it("--help prints every flag and touches nothing", async () => {
        await consoleCommand(["node", "rebase", "console", "--help"]);
        const help = stdout.join("\n");
        for (const flag of ["--eval", "--collections", "--database-url", "--docker"]) expect(help).toContain(flag);
        expect(prepareSpy).not.toHaveBeenCalled();
        expect(execaSpy).not.toHaveBeenCalled();
    });
});
