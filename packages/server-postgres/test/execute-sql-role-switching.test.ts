import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
    PostgresBackendDriver,
    RoleSwitchUnavailableError,
    effectiveSqlRole,
    isRoleSwitchingOptedOut,
    CONNECTION_OWNER
} from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * `executeSql({ role })` asks for a *constrained* execution: run this as that
 * database role so RLS binds. The one thing it must never do is answer that
 * request with owner-visible rows, because the caller cannot tell the two
 * apart — a policy spot-check would read a protected table as exposed.
 *
 * It used to do exactly that. A `SET LOCAL ROLE` refused for lack of privilege
 * was logged as a warning and the statement then ran unswitched, latching a
 * process-wide flag on the way so every later call was silently unscoped too.
 *
 * These tests pin the shape of the fix: refuse, except along the one documented
 * path where an operator has asked for owner execution on purpose.
 */

const OWNER_ROLE = "rebase";

/** Drizzle statements are objects; the text lives in their chunks. */
function sqlText(statement: unknown): string {
    return JSON.stringify(statement);
}

function pgError(message: string, code: string): Error {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    return err;
}

describe("executeSql role switching", () => {
    let driver: PostgresBackendDriver;
    let execute: jest.Mock;
    let transaction: jest.Mock;
    let txExecute: jest.Mock;
    let mockDb: NodePgDatabase;
    const envBefore = process.env.DISABLE_DB_ROLE_SWITCHING;

    beforeEach(() => {
        delete process.env.DISABLE_DB_ROLE_SWITCHING;

        txExecute = jest.fn().mockResolvedValue({ rows: [{ n: 1 }] });
        transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute: txExecute }));
        // `SELECT current_user` is the first thing the role path asks for;
        // anything else is the caller's own statement.
        execute = jest.fn(async (statement: unknown) =>
            sqlText(statement).includes("current_user")
                ? { rows: [{ role: OWNER_ROLE }] }
                : { rows: [{ n: 1 }] });

        mockDb = { execute, transaction } as unknown as NodePgDatabase;

        const registry = {
            getCollectionByPath: jest.fn(),
            getCollections: jest.fn().mockReturnValue([]),
            getTable: jest.fn(),
            getGlobalCallbacks: jest.fn()
        } as never;
        driver = new PostgresBackendDriver(
            mockDb,
            { subscriptions: new Map() } as unknown as RealtimeService,
            registry
        );
    });

    afterEach(() => {
        if (envBefore === undefined) delete process.env.DISABLE_DB_ROLE_SWITCHING;
        else process.env.DISABLE_DB_ROLE_SWITCHING = envBefore;
    });

    it("does not switch when the session already runs as the requested role", async () => {
        const rows = await driver.executeSql("SELECT 1", { role: OWNER_ROLE });

        expect(rows).toEqual([{ n: 1 }]);
        expect(transaction).not.toHaveBeenCalled();
        // Two statements on the plain connection: the current_user probe and
        // the query itself. No SET ROLE, because there is nothing to change.
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it("switches inside a transaction when the role differs", async () => {
        await driver.executeSql("SELECT 1", { role: "rebase_user" });

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(sqlText(txExecute.mock.calls[0][0])).toContain("SET LOCAL ROLE");
    });

    it("refuses rather than running as the owner when SET ROLE is denied", async () => {
        txExecute.mockRejectedValueOnce(pgError("permission denied to set role \"rebase_user\"", "42501"));

        await expect(driver.executeSql("SELECT * FROM notes", { role: "rebase_user" }))
            .rejects.toBeInstanceOf(RoleSwitchUnavailableError);

        // THE point of the fix: the statement must not have been retried on the
        // unswitched connection. Only the current_user probe ran there.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(sqlText(execute.mock.calls[0][0])).toContain("current_user");
    });

    it("keeps refusing on later calls without re-asking the database", async () => {
        txExecute.mockRejectedValueOnce(pgError("must be member of role \"rebase_user\"", "42501"));
        await expect(driver.executeSql("SELECT 1", { role: "rebase_user" })).rejects.toBeInstanceOf(RoleSwitchUnavailableError);

        execute.mockClear();
        transaction.mockClear();

        await expect(driver.executeSql("SELECT 2", { role: "rebase_user" }))
            .rejects.toBeInstanceOf(RoleSwitchUnavailableError);
        // Fails fast — but fails. The latch must not become a licence to run
        // the statement unscoped, which is what it used to be.
        expect(transaction).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledTimes(1); // the current_user probe only
    });

    it("still serves the role the session already has after a switch failure", async () => {
        txExecute.mockRejectedValueOnce(pgError("permission denied to set role", "42501"));
        await expect(driver.executeSql("SELECT 1", { role: "rebase_user" })).rejects.toThrow();

        // Asking for the role the connection already holds needs no switch, so
        // the latch has nothing to say about it. Refusing here would take the
        // Studio SQL editor down on its default selection.
        const rows = await driver.executeSql("SELECT 1", { role: OWNER_ROLE });
        expect(rows).toEqual([{ n: 1 }]);
    });

    it("propagates a non-permission failure unchanged", async () => {
        txExecute.mockRejectedValueOnce(pgError("syntax error at or near \"SELCT\"", "42601"));

        await expect(driver.executeSql("SELCT 1", { role: "rebase_user" }))
            .rejects.toThrow(/syntax error/);
    });

    it("runs as the owner when an operator opted out, and says so", async () => {
        process.env.DISABLE_DB_ROLE_SWITCHING = "true";

        const rows = await driver.executeSql("SELECT 1", { role: "rebase_user" });

        expect(rows).toEqual([{ n: 1 }]);
        expect(transaction).not.toHaveBeenCalled();
        // The audit line must report the role that applied, not the one asked
        // for — this is the only case where they legitimately differ.
        expect(effectiveSqlRole("rebase_user")).toBe(CONNECTION_OWNER);
    });
});

describe("effectiveSqlRole", () => {
    const envBefore = process.env.DISABLE_DB_ROLE_SWITCHING;
    afterEach(() => {
        if (envBefore === undefined) delete process.env.DISABLE_DB_ROLE_SWITCHING;
        else process.env.DISABLE_DB_ROLE_SWITCHING = envBefore;
    });

    it("reports the requested role when switching is available", () => {
        delete process.env.DISABLE_DB_ROLE_SWITCHING;
        expect(isRoleSwitchingOptedOut()).toBe(false);
        expect(effectiveSqlRole("rebase_user")).toBe("rebase_user");
    });

    it("reports the owner when no role was requested", () => {
        expect(effectiveSqlRole(undefined)).toBe(CONNECTION_OWNER);
    });

    it("only honours the exact string \"true\"", () => {
        // `=1` doing nothing is a known finding across the whole env surface
        // (docs/audits/80-config-and-env.md); pinned here so this variable is
        // not quietly fixed alone and left disagreeing with the rest.
        process.env.DISABLE_DB_ROLE_SWITCHING = "1";
        expect(isRoleSwitchingOptedOut()).toBe(false);
    });
});
