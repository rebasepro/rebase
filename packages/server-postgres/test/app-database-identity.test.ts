import { describe, it, expect, beforeEach } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";

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

function textOf(statement: unknown): string {
    try {
        return dialect.sqlToQuery(statement as never).sql;
    } catch {
        return JSON.stringify(statement);
    }
}

describe("the app's own database", () => {
    let appExecute: jest.Mock;
    let otherExecute: jest.Mock;
    let poolManager: jest.Mocked<DatabasePoolManager>;
    let driver: PostgresBackendDriver;

    beforeEach(() => {
        // The driver's own connection is on `leadgen`; the admin URL names the
        // server's `postgres` database.
        appExecute = jest.fn(async (statement: unknown) => {
            const sql = textOf(statement);
            if (sql.includes("current_database()")) return { rows: [{ name: "leadgen" }] };
            if (sql.includes("rebase.branches")) return { rows: [] };
            if (sql.includes("pg_database")) return { rows: [{ datname: "leadgen" }, { datname: "rb_feature" }] };
            return { rows: [{ ran: "on the app connection" }] };
        });
        otherExecute = jest.fn(async () => ({ rows: [{ ran: "on another database" }] }));
        poolManager = {
            defaultDatabaseName: "postgres",
            getDrizzle: jest.fn(() => ({ execute: otherExecute })),
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
            { execute: appExecute } as unknown as NodePgDatabase,
            { subscriptions: new Map() } as unknown as RealtimeService,
            registry,
            undefined,
            poolManager
        );
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
