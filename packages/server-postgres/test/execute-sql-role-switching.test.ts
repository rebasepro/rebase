import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
    PostgresBackendDriver,
    RoleSwitchUnavailableError,
    effectiveSqlRole,
    isRoleSwitchingOptedOut,
    CONNECTION_OWNER
} from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { recordingDb, type RecordedQuery } from "./helpers/spg-b-recording-db";

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
    let execute: ReturnType<typeof spyOnDb>["execute"];
    let transaction: ReturnType<typeof spyOnDb>["transaction"];
    /** The statements a transaction ran, in order. */
    let txStatements: RecordedQuery[];
    /** The next statements inside a transaction fail with these, in order; `undefined` lets one through. */
    let txFailures: (Error | undefined)[];
    const envBefore = process.env.DISABLE_DB_ROLE_SWITCHING;

    const spyOnDb = (db: ReturnType<typeof recordingDb>["db"]) => ({
        execute: jest.spyOn(db, "execute"),
        transaction: jest.spyOn(db, "transaction")
    });

    beforeEach(() => {
        delete process.env.DISABLE_DB_ROLE_SWITCHING;

        txStatements = [];
        txFailures = [];
        let inTransaction = false;
        const { db } = recordingDb((query) => {
            if (/^\s*begin\b/i.test(query.text)) {
                inTransaction = true;
                return [];
            }
            if (/^\s*(commit|rollback)\b/i.test(query.text)) {
                inTransaction = false;
                return [];
            }
            if (inTransaction) {
                txStatements.push(query);
                const failure = txFailures.shift();
                if (failure) throw failure;
                return [{ n: 1 }];
            }
            // `SELECT current_user` is the first thing the role path asks for;
            // anything else is the caller's own statement.
            return query.text.includes("current_user") ? [{ role: OWNER_ROLE }] : [{ n: 1 }];
        });
        ({ execute, transaction } = spyOnDb(db));

        const registry = new FixtureTableRegistry();
        driver = new PostgresBackendDriver(db, new RealtimeService(db, registry), registry);
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
        expect(txStatements[0]?.text).toContain("SET LOCAL ROLE");
    });

    it("refuses rather than running as the owner when SET ROLE is denied", async () => {
        txFailures.push(pgError("permission denied to set role \"rebase_user\"", "42501"));

        await expect(driver.executeSql("SELECT * FROM notes", { role: "rebase_user" }))
            .rejects.toBeInstanceOf(RoleSwitchUnavailableError);

        // THE point of the fix: the statement must not have been retried on the
        // unswitched connection. Only the current_user probe ran there.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(sqlText(execute.mock.calls[0][0])).toContain("current_user");
    });

    it("keeps refusing on later calls without re-asking the database", async () => {
        txFailures.push(pgError("must be member of role \"rebase_user\"", "42501"));
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

    it("keeps Postgres's reason, and the SET-option grant, on the refusals that follow", async () => {
        txFailures.push(pgError("permission denied to set role \"rebase_user\"", "42501"));
        await expect(driver.executeSql("SELECT 1", { role: "rebase_user" })).rejects.toThrow();

        const later = await driver.executeSql("SELECT 2", { role: "rebase_user" }).catch((error: unknown) => error);
        expect(later).toBeInstanceOf(RoleSwitchUnavailableError);
        expect((later as Error).message).toContain("permission denied to set role \"rebase_user\"");
        expect((later as Error).message).toContain("GRANT \"rebase_user\" TO <connection user> WITH SET TRUE");
    });

    it("refuses only the role that was refused, not every role after it", async () => {
        // A role picked in the SQL editor that the connection may not assume…
        txFailures.push(pgError("permission denied to set role \"analyst\"", "42501"));
        await expect(driver.executeSql("SELECT 1", { role: "analyst" })).rejects.toBeInstanceOf(RoleSwitchUnavailableError);

        // …says nothing about `rebase_user`, which is asked again and works.
        transaction.mockClear();
        await expect(driver.executeSql("SELECT 1", { role: "rebase_user" })).resolves.toBeDefined();
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it("still serves the role the session already has after a switch failure", async () => {
        txFailures.push(pgError("permission denied to set role", "42501"));
        await expect(driver.executeSql("SELECT 1", { role: "rebase_user" })).rejects.toThrow();

        // Asking for the role the connection already holds needs no switch, so
        // the latch has nothing to say about it. Refusing here would take the
        // Studio SQL editor down on its default selection.
        const rows = await driver.executeSql("SELECT 1", { role: OWNER_ROLE });
        expect(rows).toEqual([{ n: 1 }]);
    });

    it("propagates a non-permission failure unchanged", async () => {
        // The switch succeeds; the statement after it is the one Postgres refuses.
        txFailures.push(undefined, pgError("syntax error at or near \"SELCT\"", "42601"));

        // Drizzle names the failed query and carries the database's error as its cause.
        await expect(driver.executeSql("SELCT 1", { role: "rebase_user" }))
            .rejects.toMatchObject({ cause: { message: expect.stringMatching(/syntax error/), code: "42601" } });
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

    it.each(["true", "1", "yes", "on", "TRUE"])("opts out on %p, as every boolean variable spells yes", (value) => {
        // `=1` used to do nothing, pinned here until the whole env surface
        // shared one parser rather than fixed for this variable alone.
        process.env.DISABLE_DB_ROLE_SWITCHING = value;
        expect(isRoleSwitchingOptedOut()).toBe(true);
    });

    it.each(["false", "0", "no", "off", "", "maybe"])("keeps switching on %p", (value) => {
        // The side that has to hold: this variable turns off a boundary, so
        // nothing short of a spelled yes may turn it off.
        process.env.DISABLE_DB_ROLE_SWITCHING = value;
        expect(isRoleSwitchingOptedOut()).toBe(false);
    });
});
