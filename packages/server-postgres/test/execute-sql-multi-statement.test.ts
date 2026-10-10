import { describe, it, expect, jest } from "@jest/globals";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { rowsOfResult } from "../src/utils/result-rows";

/**
 * `executeSql("SELECT 1 AS a; SELECT 2 AS b")` answers the last statement's
 * rows.
 *
 * node-postgres hands back one result per statement when the text holds
 * several, as an array. Every `executeSql` path read `.rows` off that array —
 * `undefined` — and the caller got no rows: the SQL console said "no results"
 * for a script that ended in a SELECT, and so did every Studio view going
 * through `executeSql`.
 */

/** What node-postgres answers for `SELECT 1 AS a; SELECT 2 AS b`. */
const twoResults = [
    { command: "SELECT", rowCount: 1, rows: [{ a: 1 }] },
    { command: "SELECT", rowCount: 1, rows: [{ b: 2 }] }
];

function driverAnswering(result: unknown, owner = "rebase") {
    const execute = jest.fn(async (statement: unknown) =>
        JSON.stringify(statement).includes("current_user") ? { rows: [{ role: owner }] } : result);
    const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute }));
    const mockDb = { execute, transaction } as unknown as NodePgDatabase;
    const registry = {
        getCollectionByPath: jest.fn(),
        getCollections: jest.fn().mockReturnValue([]),
        getTable: jest.fn(),
        getGlobalCallbacks: jest.fn()
    } as never;
    return new PostgresBackendDriver(mockDb, { subscriptions: new Map() } as unknown as RealtimeService, registry);
}

describe("executeSql with several statements", () => {
    it("answers the last statement's rows on the default database", async () => {
        await expect(driverAnswering(twoResults).executeSql("SELECT 1 AS a; SELECT 2 AS b")).resolves.toEqual([{ b: 2 }]);
    });

    it("answers the last statement's rows under a role", async () => {
        await expect(driverAnswering(twoResults).executeSql("SELECT 1 AS a; SELECT 2 AS b", { role: "viewer" }))
            .resolves.toEqual([{ b: 2 }]);
    });

    it("answers the last statement's rows as the session's own role", async () => {
        await expect(driverAnswering(twoResults).executeSql("SELECT 1 AS a; SELECT 2 AS b", { role: "rebase" }))
            .resolves.toEqual([{ b: 2 }]);
    });
});

describe("rowsOfResult", () => {
    it("reads one result, a list of results, and a result with no rows", () => {
        expect(rowsOfResult({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
        expect(rowsOfResult(twoResults)).toEqual([{ b: 2 }]);
        expect(rowsOfResult([{ command: "CREATE", rows: [] }])).toEqual([]);
        expect(rowsOfResult([])).toEqual([]);
    });
});
