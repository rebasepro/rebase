/**
 * `db stop` and `db reset` are about the managed database, and said so nowhere.
 *
 * On a project pointed at its own Postgres they answered "No development
 * database was running" and "No development database to reset" — true of the
 * PGlite one they manage, and easily read as a claim about the database the
 * developer actually configured. These are the two commands whose names most
 * invite that reading, and neither could stop or delete an external database
 * even if it wanted to.
 */
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = path.resolve("/projects/shop");

/** What `devDatabaseKind` answers for this project. */
let kind: "managed" | "external" | "docker" | null = "external";

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => SCRATCH,
    requireProjectRoot: () => SCRATCH,
    requireBackendDir: () => path.join(SCRATCH, "backend"),
    findEnvFile: () => path.join(SCRATCH, ".env"),
    readEnvFile: () => ({}),
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("../dev-db/prepare", () => ({
    prepareDatabaseEnv: vi.fn(),
    managedNotices: () => [],
    DEV_DATABASE_KIND_ENV: "REBASE_DEV_DATABASE_KIND",
    devDatabaseKind: () => kind,
    resolveActiveBranch: () => null,
    resolveComposeUrl: () => null
}));

vi.mock("../dev-db/daemon", () => ({
    stopManagedDatabase: vi.fn(async () => false),
    findRunningDaemon: vi.fn(async () => null),
    resetManagedDatabase: vi.fn()
}));

vi.mock("../dev-db/state", () => ({
    // Nothing on disk: the "nothing here" branch is what is under test.
    dataDir: () => path.join(SCRATCH, ".rebase", "pglite")
}));

import { dbCommand } from "./db";

const argv = (...line: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", ...line];

function printed(): string {
    const calls = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls;

    // eslint-disable-next-line no-control-regex
    return calls.map(c => c.join(" ")).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

beforeEach(() => {
    vi.clearAllMocks();
    kind = "external";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe.each(["stop", "reset"] as const)("db %s on a project with its own DATABASE_URL", subcommand => {
    it("names the managed database, not `the development database`", async () => {
        await dbCommand(subcommand, argv("db", subcommand));

        expect(printed()).toContain("managed development database (PGlite)");
    });

    it("says the project's own DATABASE_URL was not touched", async () => {
        await dbCommand(subcommand, argv("db", subcommand));

        expect(printed()).toContain("DATABASE_URL, which is untouched");
    });
});

describe.each(["stop", "reset"] as const)("db %s on a project on the managed database", subcommand => {
    it("does not talk about a DATABASE_URL the project does not have", async () => {
        kind = "managed";
        await dbCommand(subcommand, argv("db", subcommand));

        expect(printed()).toContain("managed development database (PGlite)");
        expect(printed()).not.toContain("untouched");
    });
});
