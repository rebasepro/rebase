import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Studio's Branches pane while `rebase dev` runs on a branch.
 *
 * A branch is a `CREATE DATABASE … TEMPLATE` copy, so it carries a snapshot of
 * the main database's `rebase.branches`, taken before its own row was
 * written. The pane read that snapshot: it never listed the branch it was on
 * nor any made since, and a branch created from it was recorded there — where
 * `rebase db branch list`, which reads the main database, never saw it. Its
 * "Default (main database)" copied the branch.
 *
 * The CLI names the main database when it starts the server on a branch
 * (`REBASE_BRANCH_PARENT_DATABASE`); branches are then kept there.
 */

const dialect = new PgDialect();

function textOf(statement: unknown): string {
    try {
        return dialect.sqlToQuery(statement as never).sql.replace(/\s+/g, " ").trim();
    } catch {
        return JSON.stringify(statement);
    }
}

const ENV = "REBASE_BRANCH_PARENT_DATABASE";

describe("branches while the server runs on a branch", () => {
    let branchExecute: jest.Mock;
    let mainExecute: jest.Mock;
    let poolManager: jest.Mocked<DatabasePoolManager>;
    let driver: PostgresBackendDriver;
    const before = process.env[ENV];

    beforeEach(() => {
        process.env[ENV] = "leadgen";
        // The server's own connection is on the branch, whose registry is a
        // stale copy of main's.
        branchExecute = jest.fn(async (statement: unknown) => {
            const sql = textOf(statement);
            if (sql.includes("current_database()")) return { rows: [{ name: "rb_feature" }] };
            if (sql.includes("rebase.branches")) return { rows: [{ name: "stale", db_name: "rb_stale", parent_db: "leadgen", created_at: "2026-01-01T00:00:00Z" }] };
            return { rows: [] };
        });
        mainExecute = jest.fn(async (statement: unknown) => {
            const sql = textOf(statement);
            if (sql.includes("FROM rebase.branches b")) {
                return { rows: [{ name: "feature", db_name: "rb_feature", parent_db: "leadgen", created_at: "2026-10-01T00:00:00Z", size_bytes: 1 }] };
            }
            return { rows: [] };
        });
        poolManager = {
            defaultDatabaseName: "rb_feature",
            getDrizzle: jest.fn((name: string) => {
                if (name !== "leadgen") throw new Error(`no pool expected on ${name}`);
                return { execute: mainExecute };
            }),
            disconnectDatabase: jest.fn().mockResolvedValue(undefined),
            servesOneDatabase: jest.fn().mockResolvedValue(false)
        } as unknown as jest.Mocked<DatabasePoolManager>;
        const registry = {
            getCollectionByPath: jest.fn(),
            getCollections: jest.fn().mockReturnValue([]),
            getTable: jest.fn(),
            getGlobalCallbacks: jest.fn()
        } as never;
        driver = new PostgresBackendDriver(
            { execute: branchExecute } as unknown as NodePgDatabase,
            { subscriptions: new Map() } as unknown as RealtimeService,
            registry,
            undefined,
            poolManager
        );
    });

    afterEach(() => {
        if (before === undefined) delete process.env[ENV];
        else process.env[ENV] = before;
    });

    it("lists the branches the main database records, the one it is on included", async () => {
        const branches = await driver.admin.listBranches!();

        expect(branches.map(b => b.name)).toEqual(["feature"]);
        expect(poolManager.getDrizzle).toHaveBeenCalledWith("leadgen");
    });

    it("copies the main database by default, and records the branch there", async () => {
        const branch = await driver.admin.createBranch!("hotfix");

        expect(branch.parentDatabase).toBe("leadgen");
        const created = branchExecute.mock.calls.map(([statement]) => textOf(statement)).find(sql => sql.startsWith("CREATE DATABASE"));
        expect(created).toBe("CREATE DATABASE \"rb_hotfix\" TEMPLATE \"leadgen\"");
        const recorded = mainExecute.mock.calls.map(([statement]) => textOf(statement)).find(sql => sql.startsWith("INSERT INTO rebase.branches"));
        expect(recorded).toBeDefined();
        expect(branchExecute.mock.calls.map(([statement]) => textOf(statement)).some(sql => sql.startsWith("INSERT INTO rebase.branches"))).toBe(false);
    });

    it("refuses to drop the main database", async () => {
        await expect(driver.admin.deleteBranch!("x")).rejects.toThrow(/not found|main database/);
        mainExecute.mockImplementationOnce(async () => ({ rows: [{ db_name: "leadgen" }] }));
        await expect(driver.admin.deleteBranch!("leadgen-alias")).rejects.toThrow("Cannot delete the main database.");
    });

    it("keeps branches on its own database when it is not on a branch", async () => {
        delete process.env[ENV];

        const branches = await driver.admin.listBranches!();

        expect(branches.map(b => b.name)).toEqual(["stale"]);
        expect(poolManager.getDrizzle).not.toHaveBeenCalled();
    });
});
