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

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => SCRATCH,
    requireProjectRoot: () => SCRATCH,
    requireBackendDir: () => path.join(SCRATCH, "backend"),
    findEnvFile: () => path.join(SCRATCH, ".env"),
    readEnvFile: () => ({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/shop" }),
    resolveTsx: () => "/bin/true",
    getActiveBackendPlugin: () => "@rebasepro/server-postgres",
    resolvePluginCliScript: () => "/tmp/rebase-test-plugin-cli.js"
}));

vi.mock("../dev-db/branch-pointer", () => ({
    readActiveBranch: vi.fn(() => ({ name: "feature", database: "shop_branch_feature" })),
    writeActiveBranch: vi.fn(),
    clearActiveBranch: vi.fn(),
    branchDatabaseName: (name: string) => `shop_branch_${name}`,
    databaseNameOf: () => "shop"
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

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
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
