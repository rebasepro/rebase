/**
 * `branch delete` and `branch list` have to know which branch you are on.
 *
 * Neither did, and the driver cannot be told: it runs as a child process, and
 * to it "the branch you are standing on" and "the main database" are the same
 * connection string.
 *
 *  - **delete** — after `switch feature_x` the resolved DSN *is* `rb_feature_x`,
 *    so `BranchService` compared it against the connected database, found them
 *    equal, and answered `✗ Cannot delete the main database.` about a database
 *    the developer had never named.
 *  - **list** — `rebase.branches` lives in the database branches are made
 *    *from*, and a branch is a `CREATE DATABASE … TEMPLATE` copy. So `list` on
 *    a branch read that copy's snapshot and said `No branches found. Create one
 *    with: rebase db branch create <name>`, one command after `switch` had said
 *    `● On branch feature_x`.
 */
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = path.resolve("/projects/shop");
const PARENT_URL = "postgres://u:p@127.0.0.1:5432/shop";

/** The pointer this checkout carries. `null` in the "not on a branch" cases. */
let active: { name: string; database: string } | null = { name: "feature_x", database: "rb_feature_x" };

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => SCRATCH,
    requireProjectRoot: () => SCRATCH,
    requireBackendDir: () => path.join(SCRATCH, "backend"),
    findEnvFile: () => path.join(SCRATCH, ".env"),
    readEnvFile: () => ({ DATABASE_URL: PARENT_URL }),
    resolveTsx: () => "/bin/true",
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("../dev-db/branch-pointer", () => ({
    readActiveBranch: vi.fn(() => active),
    writeActiveBranch: vi.fn(),
    clearActiveBranch: vi.fn(),
    branchDatabaseName: (name: string) => `rb_${name}`,
    databaseNameOf: (url: string) => {
        try {
            return new URL(url).pathname.slice(1) || null;
        } catch {
            return null;
        }
    }
}));

vi.mock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));
vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(async () => ({
        env: {},
        database: { kind: "external" as const, url: PARENT_URL, source: "env-file" as const },
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

const execaSpy = execa as unknown as ReturnType<typeof vi.fn>;
const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

const exits: number[] = [];

/** Everything written to stdout and stderr, with the colour taken back out. */
function printed(): string {
    const calls = [
        ...(console.log as unknown as ReturnType<typeof vi.fn>).mock.calls,
        ...(console.error as unknown as ReturnType<typeof vi.fn>).mock.calls
    ];

    // eslint-disable-next-line no-control-regex
    return calls.map(c => c.join(" ")).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

/** The argv the driver was spawned with, or `[]` when it was not. */
function driverLine(): string[] {
    const call = execaSpy.mock.calls.at(-1);

    return call ? (call[1] as string[]) : [];
}

beforeEach(() => {
    vi.clearAllMocks();
    exits.length = 0;
    active = { name: "feature_x", database: "rb_feature_x" };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        exits.push(code ?? 0);
        throw new Error(`process.exit(${code})`);
    }) as never);
});

afterEach(() => vi.restoreAllMocks());

describe("deleting the branch you are standing on", () => {
    it("names the branch and how to leave it", async () => {
        await dbCommand("branch", argv("db", "branch", "delete", "feature_x")).catch(() => undefined);

        expect(printed()).toContain('You are on branch "feature_x"');
        expect(printed()).toContain("rebase db branch switch --off");
    });

    it("never says `Cannot delete the main database`, which was about another database", async () => {
        await dbCommand("branch", argv("db", "branch", "delete", "feature_x")).catch(() => undefined);

        expect(printed()).not.toContain("main database.");
        expect(exits).toEqual([1]);
    });

    it("does not spawn the driver — nothing is dropped", async () => {
        await dbCommand("branch", argv("db", "branch", "delete", "feature_x")).catch(() => undefined);

        expect(execaSpy).not.toHaveBeenCalled();
    });

    it("leaves a different branch alone", async () => {
        await dbCommand("branch", argv("db", "branch", "delete", "other")).catch(() => undefined);

        expect(execaSpy).toHaveBeenCalled();
        expect(exits).toEqual([]);
    });

    it("leaves every delete alone when no branch is active", async () => {
        active = null;
        await dbCommand("branch", argv("db", "branch", "delete", "feature_x")).catch(() => undefined);

        expect(execaSpy).toHaveBeenCalled();
    });

    it("finds the name past a leading --debug", async () => {
        // `--debug` is what `bin/rebase.js` prints after every failure as the
        // thing to re-run with, so it is the token most likely to precede the
        // command words.
        await dbCommand("branch", argv("--debug", "db", "branch", "delete", "feature_x")).catch(() => undefined);

        expect(printed()).toContain('You are on branch "feature_x"');
    });
});

describe("listing branches from a branch", () => {
    it("points the driver at the parent, where the registry lives", async () => {
        await dbCommand("branch", argv("db", "branch", "list")).catch(() => undefined);

        expect(driverLine()).toContain("--database-url");
        expect(driverLine()).toContain(PARENT_URL);
    });

    it("says which database it read", async () => {
        await dbCommand("branch", argv("db", "branch", "list")).catch(() => undefined);

        expect(printed()).toContain("On branch feature_x");
        expect(printed()).toContain("main database");
    });

    it("adds nothing when the checkout is not on a branch", async () => {
        active = null;
        await dbCommand("branch", argv("db", "branch", "list")).catch(() => undefined);

        expect(driverLine()).not.toContain("--database-url");
    });

    it("never overrides a --database-url the developer typed", async () => {
        const typed = "postgres://u:p@127.0.0.1:5432/somewhere_else";
        await dbCommand("branch", argv("db", "branch", "list", "--database-url", typed)).catch(() => undefined);

        expect(driverLine().filter(a => a === "--database-url")).toHaveLength(1);
        expect(driverLine()).toContain(typed);
    });

    it("leaves `create` pointed at the branch it was resolved to", async () => {
        // Only `list` reads the registry from somewhere other than the resolved
        // database. `create` copies what this checkout is on, which after a
        // switch is the branch, and that is a branch of a branch — a thing the
        // developer asked for by switching first.
        await dbCommand("branch", argv("db", "branch", "create", "another")).catch(() => undefined);

        expect(driverLine()).not.toContain("--database-url");
    });
});
