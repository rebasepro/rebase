/**
 * `rebase db branch switch` is the CLI's own, and the dispatch found it by
 * counting words.
 *
 * The branch pointer is per-checkout state that the CLI writes; the driver runs
 * as a child process and cannot persist it, so it has no `switch` of its own
 * worth reaching. The dispatch tested `rawArgs.slice(2)[2] === "switch"`, which
 * assumes nothing precedes the command words — and `--debug` is what
 * `bin/rebase.js` prints after *every* failure as the thing to re-run with, so
 * it is the single most likely token to precede them.
 *
 * `rebase --debug db branch switch feature` therefore missed this branch, went
 * to the driver, and came back reporting success while the checkout stayed on
 * the main database. Every later `dev`, `push` and `backup` then ran against
 * the wrong database in the belief that it was the branch — the exact failure
 * branching exists to prevent, announced as a success.
 */
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = path.resolve("/projects/shop");

/** What this project's `.env` holds. Emptied by the shell-only test. */
let envFile: Record<string, string> = { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/shop" };

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => SCRATCH,
    requireProjectRoot: () => SCRATCH,
    requireBackendDir: () => path.join(SCRATCH, "backend"),
    findEnvFile: () => path.join(SCRATCH, ".env"),
    readEnvFile: () => envFile,
    resolveTsx: () => "/bin/true",
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("../dev-db/branch-pointer", () => ({
    readActiveBranch: vi.fn(() => ({ name: "feature", database: "shop_branch_feature" })),
    writeActiveBranch: vi.fn(),
    clearActiveBranch: vi.fn(),
    branchDatabaseName: (name: string) => `shop_branch_${name}`,
    // The real parse rather than a constant, so the name this prints is evidence
    // of *which* connection string was resolved — the whole question below.
    databaseNameOf: (url: string) => {
        try {
            return new URL(url).pathname.slice(1) || null;
        } catch {
            return null;
        }
    }
}));

// The door out of the CLI and into the driver. Watched, because taking it is
// precisely the bug.
vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));
vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({
        env: {},
        database: { kind: "url" as const },
        description: "the configured database"
    })),
    managedNotices: () => [],
    DEV_DATABASE_KIND_ENV: "REBASE_DEV_DATABASE_KIND",
    devDatabaseKind: () => "external" as const,
    resolveActiveBranch: () => null,
    resolveComposeUrl: () => null
}));

import { dbCommand } from "./db";
import { execa } from "execa";
import { clearActiveBranch, readActiveBranch } from "../dev-db/branch-pointer";

const execaSpy = execa as unknown as ReturnType<typeof vi.fn>;
const readSpy = readActiveBranch as unknown as ReturnType<typeof vi.fn>;
const clearSpy = clearActiveBranch as unknown as ReturnType<typeof vi.fn>;

const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

const originalEnv = { ...process.env };

beforeEach(() => {
    vi.clearAllMocks();
    envFile = { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/shop" };
    delete process.env.DATABASE_URL;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
});

describe("db branch switch stays on the CLI side", () => {
    it("reports the current branch, with no flag in the way", async () => {
        await dbCommand("branch", argv("db", "branch", "switch"));

        expect(readSpy).toHaveBeenCalled();
        expect(execaSpy).not.toHaveBeenCalled();
    });

    it("still does when --debug is written before the command", async () => {
        await dbCommand("branch", argv("--debug", "db", "branch", "switch"));

        expect(readSpy).toHaveBeenCalled();
        expect(execaSpy).not.toHaveBeenCalled();
    });

    it("clears the pointer for --debug … switch --off", async () => {
        await dbCommand("branch", argv("--debug", "db", "branch", "switch", "--off"));

        expect(clearSpy).toHaveBeenCalledWith(SCRATCH);
        expect(execaSpy).not.toHaveBeenCalled();
    });

    it("leaves the other branch actions to the driver", async () => {
        // The guard must not swallow the actions the driver owns: `create` and
        // `list` are its, and a `switch` check that matched too eagerly would
        // take them too.
        await dbCommand("branch", argv("--debug", "db", "branch", "list"));

        expect(execaSpy).toHaveBeenCalled();
    });
});

describe("the database a switch branches from", () => {
    /**
     * This read `readEnvFile(projectRoot).DATABASE_URL` and nothing else, while
     * `branching.md` documents the order `--database-url` → shell
     * `DATABASE_URL` → branch → `.env`, and every sibling command follows it.
     *
     * So `export DATABASE_URL=…; rebase db branch create feature_x` created a
     * branch and `rebase db branch switch feature_x` answered "This project has
     * no DATABASE_URL, so there is no database to branch from" — about a
     * project that had one, in the shell, that `create` had just used.
     */
    const exits: number[] = [];

    beforeEach(() => {
        exits.length = 0;
        readSpy.mockReturnValue(null);
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code})`);
        }) as never);
    });

    /**
     * `switch` with no name reports where you are, naming the database it
     * resolved. No network, and the name is the evidence.
     */
    const reportedDatabase = async (): Promise<string> => {
        await dbCommand("branch", argv("db", "branch", "switch")).catch(() => {});
        const printed = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
            .map(c => c.join(" ")).join("\n");
        // eslint-disable-next-line no-control-regex
        return printed.replace(/\x1b\[[0-9;]*m/g, "");
    };

    const refusal = () =>
        (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => c.join(" ")).join("\n");

    it("accepts a URL supplied only through the shell", async () => {
        envFile = {};
        process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/from_shell";

        expect(await reportedDatabase()).toContain("from_shell");
    });

    it("lets the shell outrank the project's .env, as the documented order says", async () => {
        envFile = { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/from_file" };
        process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/from_shell";

        const printed = await reportedDatabase();
        expect(printed).toContain("from_shell");
        expect(printed).not.toContain("from_file");
    });

    it("lets --database-url outrank the shell, as the documented order says", async () => {
        process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5432/from_shell";

        // The `=` spelling, so the URL cannot be read as the branch name.
        await dbCommand("branch", argv("db", "branch", "switch", "--database-url=postgres://u@h:5432/from_flag"))
            .catch(() => {});
        const printed = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
            .map(c => c.join(" ")).join("\n");
        expect(printed).toContain("from_flag");
    });

    it("still refuses when nothing anywhere names one", async () => {
        envFile = {};

        await dbCommand("branch", argv("db", "branch", "switch", "feature_x")).catch(() => {});

        expect(refusal()).toContain("no database to branch from");
        // Named for what it is, rather than as a missing variable: a project on
        // the managed database has a database, it just cannot be copied.
        expect(refusal()).toContain("managed development database");
        expect(exits).toContain(1);
    });
});
