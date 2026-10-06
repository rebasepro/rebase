import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { refuseOversizedRows, SQL_RESULT_BYTE_BUDGET, SqlResultTooLargeError } from "../src/services/sql-script";

/**
 * The admin `executeSql` door — the WebSocket `EXECUTE_SQL` without
 * `mode: "script"` — had no limit. A million-row `SELECT` held every row parsed,
 * then the frame built from them, and a server with 1 GiB died of it. It now
 * refuses a result past `maxResultBytes` with `RESULT_TOO_LARGE`, and never
 * answers with part of one: a program reading rows through it would take the
 * part for the whole.
 *
 * On a pool the read stops at the budget (`test/e2e/sql-script-e2e.test.ts`
 * proves it against a real server). In process — PGlite, the managed
 * development database — the rows are read whole before anything could stop
 * them, and are refused all the same.
 */

const WIDE = "SELECT g, repeat('x', 1000) AS pad FROM generate_series(1, 2000) g";

describe("the byte budget on PGlite", () => {
    let pglite: PGlite;
    let driver: PostgresBackendDriver;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        const db = drizzle(pglite);
        const registry = new PostgresCollectionRegistry();
        driver = new PostgresBackendDriver(db as never, new RealtimeService(db as never, registry), registry);
    });

    afterEach(async () => {
        await pglite.close();
    });

    it("refuses a result past it, rather than answering with part of it", async () => {
        const run = driver.executeSql(WIDE, { isolateSession: true, maxResultBytes: 1_000_000 });

        await expect(run).rejects.toBeInstanceOf(SqlResultTooLargeError);
        await expect(run).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
    });

    it("returns a result under it whole", async () => {
        const rows = await driver.executeSql(WIDE, { isolateSession: true, maxResultBytes: 4_000_000 });

        expect(rows).toHaveLength(2000);
    });

    it("is refused on the shared session too, not only on one of its own", async () => {
        await expect(driver.executeSql(WIDE, { maxResultBytes: 1_000_000 })).rejects.toBeInstanceOf(SqlResultTooLargeError);
    });

    it("leaves the session usable and reset after a refusal", async () => {
        const leaky = "SELECT set_config('app.leak', 'yes', false), repeat('x', 1000) FROM generate_series(1, 2000)";
        await expect(driver.executeSql(leaky, { isolateSession: true, maxResultBytes: 1_000_000 }))
            .rejects.toBeInstanceOf(SqlResultTooLargeError);

        const after = await pglite.query<{ leak: string | null }>("SELECT current_setting('app.leak', true) AS leak");
        expect(after.rows[0].leak).not.toBe("yes");
        expect(await driver.executeSql("SELECT 1 AS one")).toEqual([{ one: 1 }]);
    });

    it("changes nothing for a caller that sets no budget", async () => {
        expect(await driver.executeSql(WIDE, { isolateSession: true })).toHaveLength(2000);
    });
});

describe("refuseOversizedRows", () => {
    it("counts each value's text, so a few wide rows are refused like many narrow ones", () => {
        const wide = [{ doc: { body: "x".repeat(600) } }, { doc: { body: "y".repeat(600) } }];
        const narrow = Array.from({ length: 200 }, (_, index) => ({ id: index, label: "abc" }));

        expect(() => refuseOversizedRows(wide, 1000)).toThrow(SqlResultTooLargeError);
        expect(() => refuseOversizedRows(narrow, 1000)).toThrow(SqlResultTooLargeError);
        expect(refuseOversizedRows(narrow, 10_000)).toBe(narrow);
    });

    it("names the limit and what to do in its message", () => {
        expect(new SqlResultTooLargeError(SQL_RESULT_BYTE_BUDGET).message).toMatch(/128 MB.*LIMIT/);
    });
});
