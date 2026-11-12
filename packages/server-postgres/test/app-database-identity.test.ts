import { describe, it, expect, beforeEach } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { answerStatements, queryResult, spiedDrizzle, type SpiedDrizzle } from "./helpers/spg-a-db";
import { quietRealtime } from "./helpers/spg-a-driver";

/**
 * Which database is "this app's".
 *
 * The SQL console's database picker preselects it, and a statement sent to it
 * runs on the driver's own connection. It used to be read off the admin
 * connection string — `ADMIN_CONNECTION_STRING`, when set — which need not name
 * the database the app runs on: an admin URL on the server's `postgres`
 * database, or the main database while `rebase dev` runs on a branch. The
 * console then preselected "postgres" (or the main database's name) and ran
 * every statement under that label on the app's connection — the branch —
 * while choosing the app's real name opened a second pool to it.
 *
 * Branching read the same field, so "Default (main database)" copied the
 * maintenance database.
 */

const dialect = new PgDialect();

function textOf(statement: SQLWrapper | string): string {
    return typeof statement === "string" ? statement : dialect.sqlToQuery(statement.getSQL()).sql;
}

describe("the app's own database", () => {
    let appExecute: SpiedDrizzle["execute"];
    let poolManager: DatabasePoolManager;
    let driver: PostgresBackendDriver;

    beforeEach(() => {
        // The driver's own connection is on `leadgen`; the admin URL names the
        // server's `postgres` database.
        const app = spiedDrizzle();
        appExecute = app.execute;
        answerStatements(appExecute, (statement) => {
            const sql = textOf(statement);
            if (sql.includes("current_database()")) return queryResult([{ name: "leadgen" }]);
            if (sql.includes("rebase.branches")) return queryResult();
            if (sql.includes("pg_database")) return queryResult([{ datname: "leadgen" }, { datname: "rb_feature" }]);
            return queryResult([{ ran: "on the app connection" }]);
        });
        const other = spiedDrizzle();
        answerStatements(other.execute, () => queryResult([{ ran: "on another database" }]));
        poolManager = new DatabasePoolManager("postgres://localhost/postgres");
        jest.spyOn(poolManager, "getDrizzle").mockReturnValue(other.db);
        jest.spyOn(poolManager, "disconnectDatabase").mockResolvedValue(undefined);
        jest.spyOn(poolManager, "servesOneDatabase").mockResolvedValue(false);
        // No maintenance pool: the copy lock that needs one is skipped.
        jest.spyOn(poolManager, "getPool").mockImplementation(() => {
            throw new Error("no maintenance pool in this test");
        });
        const registry = new FixtureTableRegistry();
        driver = new PostgresBackendDriver(app.db, quietRealtime(app.db, registry), registry, undefined, poolManager);
    });

    it("is the database the driver's connection is on, not the one the admin URL names", async () => {
        await expect(driver.fetchCurrentDatabase()).resolves.toBe("leadgen");
    });

    it("is listed first, and the admin URL's database is not slipped into the list", async () => {
        await expect(driver.fetchAvailableDatabases()).resolves.toEqual(["leadgen", "rb_feature"]);
    });

    it("runs a statement sent to it on the driver's own connection", async () => {
        const rows = await driver.executeSql("SELECT 1", { database: "leadgen" });

        expect(rows).toEqual([{ ran: "on the app connection" }]);
        expect(poolManager.getDrizzle).not.toHaveBeenCalled();
    });

    it("runs a statement sent to the admin URL's database there, not on the app's connection", async () => {
        const rows = await driver.executeSql("SELECT 1", { database: "postgres" });

        expect(rows).toEqual([{ ran: "on another database" }]);
        expect(poolManager.getDrizzle).toHaveBeenCalledWith("postgres");
    });

    it("is what a branch is copied from by default", async () => {
        const branch = await driver.admin.createBranch!("hotfix");

        expect(branch.parentDatabase).toBe("leadgen");
        const create = appExecute.mock.calls.map(([statement]) => textOf(statement)).find(sql => sql.startsWith("CREATE DATABASE"));
        expect(create).toBe("CREATE DATABASE \"rb_hotfix\" TEMPLATE \"leadgen\"");
    });
});
