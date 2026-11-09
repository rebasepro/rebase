import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { QueryResult } from "pg";
import { answerStatements, queryResult, spiedDrizzle, type SpiedDrizzle } from "./helpers/spg-a-db";
import { quietRealtime } from "./helpers/spg-a-driver";

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

function textOf(statement: SQLWrapper | string): string {
    const text = typeof statement === "string" ? statement : dialect.sqlToQuery(statement.getSQL()).sql;
    return text.replace(/\s+/g, " ").trim();
}

const ENV = "REBASE_BRANCH_PARENT_DATABASE";

describe("branches while the server runs on a branch", () => {
    let branchExecute: SpiedDrizzle["execute"];
    let mainExecute: SpiedDrizzle["execute"];
    /** Results the main database answers with first, before its usual ones. */
    let mainAnswersNext: QueryResult<Record<string, unknown>>[];
    let poolManager: DatabasePoolManager;
    let driver: PostgresBackendDriver;
    const before = process.env[ENV];

    beforeEach(() => {
        process.env[ENV] = "leadgen";
        // The server's own connection is on the branch, whose registry is a
        // stale copy of main's.
        const branch = spiedDrizzle();
        branchExecute = branch.execute;
        answerStatements(branchExecute, (statement) => {
            const sql = textOf(statement);
            if (sql.includes("current_database()")) return queryResult([{ name: "rb_feature" }]);
            if (sql.includes("rebase.branches")) return queryResult([{ name: "stale", db_name: "rb_stale", parent_db: "leadgen", created_at: "2026-01-01T00:00:00Z" }]);
            return queryResult();
        });
        const main = spiedDrizzle();
        mainExecute = main.execute;
        mainAnswersNext = [];
        answerStatements(mainExecute, (statement) => {
            const next = mainAnswersNext.shift();
            if (next) return next;
            const sql = textOf(statement);
            if (sql.includes("FROM rebase.branches b")) {
                return queryResult([{ name: "feature", db_name: "rb_feature", parent_db: "leadgen", created_at: "2026-10-01T00:00:00Z", size_bytes: 1 }]);
            }
            return queryResult();
        });
        poolManager = new DatabasePoolManager("postgres://localhost/rb_feature");
        jest.spyOn(poolManager, "getDrizzle").mockImplementation((name: string) => {
            if (name !== "leadgen") throw new Error(`no pool expected on ${name}`);
            return main.db;
        });
        jest.spyOn(poolManager, "disconnectDatabase").mockResolvedValue(undefined);
        jest.spyOn(poolManager, "servesOneDatabase").mockResolvedValue(false);
        // No maintenance pool: the copy lock that needs one is skipped.
        jest.spyOn(poolManager, "getPool").mockImplementation(() => {
            throw new Error("no maintenance pool in this test");
        });
        const registry = new PostgresCollectionRegistry();
        driver = new PostgresBackendDriver(branch.db, quietRealtime(branch.db, registry), registry, undefined, poolManager);
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
        mainAnswersNext.push(queryResult([{ db_name: "leadgen" }]));
        await expect(driver.admin.deleteBranch!("leadgen-alias")).rejects.toThrow("Cannot delete the main database.");
    });

    it("keeps branches on its own database when it is not on a branch", async () => {
        delete process.env[ENV];

        const branches = await driver.admin.listBranches!();

        expect(branches.map(b => b.name)).toEqual(["stale"]);
        expect(poolManager.getDrizzle).not.toHaveBeenCalled();
    });
});
