/**
 * `rebase db branch switch <name>` opens a database a killed forced create
 * left closed, before it connects — as every `branch` action the driver runs
 * does.
 *
 * `create --force` closes its source to new connections for the copy. One
 * killed with SIGKILL leaves it closed, and `switch` then failed on "Could not
 * reach the database to check that branch exists".
 */
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = path.resolve("/projects/shop");
const MAIN = "postgres://u:p@127.0.0.1:5432/shop";

/** What happened, in order. */
const events: string[] = [];

vi.mock("../utils/project", async importOriginal => ({
    ...(await importOriginal<typeof import("../utils/project")>()),
    findProjectRoot: () => SCRATCH,
    requireProjectRoot: () => SCRATCH,
    requireBackendDir: () => path.join(SCRATCH, "backend"),
    findEnvFile: () => path.join(SCRATCH, ".env"),
    readEnvFile: () => ({ DATABASE_URL: MAIN })
}));

vi.mock("../dev-db/branch-pointer", () => ({
    readActiveBranch: vi.fn(() => ({ name: "feature", database: "shop_branch_feature" })),
    writeActiveBranch: vi.fn(() => { events.push("pointer written"); }),
    clearActiveBranch: vi.fn(),
    branchDatabaseName: (name: string) => `shop_branch_${name}`,
    databaseNameOf: (url: string) => new URL(url).pathname.slice(1) || null
}));

vi.mock("../dev-db/prepare", () => ({
    resolveProjectDatabase: () => ({ kind: "external" as const, url: MAIN, source: "env-file" as const }),
    resolveComposeUrl: () => null
}));

vi.mock("../utils/dev-preflight", () => ({ ensureDevDatabase: vi.fn(async () => undefined) }));

vi.mock("@rebasepro/server-postgres", () => ({
    reopenClosedDatabases: vi.fn(async (url: string, others: readonly (string | undefined)[]) => {
        events.push(`reopen ${url} ${others.join(",")}`);
        return { reopened: ["shop"], failed: [] };
    }),
    reopenedDatabasesNotice: (result: { reopened: string[] }) => result.reopened.map(database => `⚠ "${database}" was refusing every connection.`)
}));

vi.mock("pg", () => {
    class Client {
        async connect(): Promise<void> { events.push("connect"); }
        async query(): Promise<{ rows: { registered: boolean; present: boolean }[] }> {
            return { rows: [{ registered: true, present: true }] };
        }
        async end(): Promise<void> { /* nothing to close */ }
    }
    return { Client, default: { Client } };
});

const { dbCommand } = await import("./db");

let errors: string[];

beforeEach(() => {
    events.length = 0;
    errors = [];
    delete process.env.DATABASE_URL;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { errors.push(parts.map(String).join(" ")); });
});

describe("db branch switch <name> on a closed database", () => {
    it("opens it again before it connects, and says so", async () => {
        await dbCommand("branch", ["/usr/bin/node", "/usr/local/bin/rebase", "db", "branch", "switch", "other"]);

        expect(events).toEqual([`reopen ${MAIN} shop_branch_feature`, "connect", "pointer written"]);
        // eslint-disable-next-line no-control-regex
        expect(errors.join("\n").replace(/\x1b\[[0-9;]*m/g, "")).toContain("⚠ \"shop\" was refusing every connection.");
    });
});
