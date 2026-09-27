import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

/**
 * SQL a person typed runs on a session that is put back before anyone else
 * gets it.
 *
 * The Studio SQL editor's statements went to the pool like any other, with no
 * reset afterwards. `SET ROLE rebase_user; SELECT …` — the usual way to try a
 * query as the restricted role — left that pooled connection running as
 * `rebase_user` for the rest of its life, and every owner-plane statement that
 * later checked it out (auth lookups, the job and cron stores, history) ran
 * restricted: permission errors and RLS-filtered rows, on one connection in N,
 * until a restart. `set_config(…, false)` leaked the same way.
 *
 * `isolateSession` is what the editor's door asks for: the statements run on a
 * connection of their own, which is reset before it goes back.
 */

function driverOver(db: ReturnType<typeof drizzlePglite> | ReturnType<typeof drizzleNodePg>): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    return new PostgresBackendDriver(db as never, new RealtimeService(db as never, registry), registry);
}

describe("on a single session (PGlite)", () => {
    let pglite: PGlite;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        await pglite.exec("CREATE ROLE probe_role NOLOGIN;");
    });

    afterEach(async () => {
        await pglite.close();
    });

    it("leaves no role and no session setting behind", async () => {
        const driver = driverOver(drizzlePglite(pglite));

        await driver.executeSql("SET ROLE probe_role", { isolateSession: true });
        await driver.executeSql("SELECT set_config('app.leak', 'yes', false)", { isolateSession: true });

        const after = await pglite.query<{ u: string; leak: string | null }>(
            "SELECT current_user AS u, current_setting('app.leak', true) AS leak"
        );
        expect(after.rows[0].u).toBe("postgres");
        expect(after.rows[0].leak).not.toBe("yes");
    });

    it("still runs a statement as the role the editor picked, and only that statement", async () => {
        const driver = driverOver(drizzlePglite(pglite));

        const rows = await driver.executeSql("SELECT current_user AS u", { role: "probe_role", isolateSession: true });

        expect(rows).toEqual([{ u: "probe_role" }]);
        const after = await pglite.query<{ u: string }>("SELECT current_user AS u");
        expect(after.rows[0].u).toBe("postgres");
    });
});

describe("on a pool", () => {
    type FakeConnection = { query: jest.Mock; release: jest.Mock };
    let pool: Pool;
    let connection: FakeConnection;
    let statements: string[];

    beforeEach(() => {
        statements = [];
        // Never connected: `connect` is replaced, and nothing else is asked of it.
        pool = new Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
        connection = {
            query: jest.fn(async (query: unknown) => {
                statements.push(typeof query === "string" ? query : (query as { text: string }).text);
                return { rows: [], fields: [], rowCount: 0, command: "SELECT" };
            }),
            release: jest.fn()
        };
        jest.spyOn(pool, "connect").mockImplementation((async () => connection) as never);
        jest.spyOn(pool, "query").mockImplementation((async () => {
            throw new Error("the statement went to the pool instead of a connection of its own");
        }) as never);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await pool.end();
    });

    it("runs the statement on one checked-out connection, resets it, then releases it for reuse", async () => {
        const driver = driverOver(drizzleNodePg(pool));

        await driver.executeSql("SET ROLE rebase_user", { isolateSession: true });

        expect(statements[0]).toBe("SET ROLE rebase_user");
        expect(statements.slice(1)).toEqual(["SET SESSION AUTHORIZATION DEFAULT", "RESET ALL"]);
        expect(connection.release).toHaveBeenCalledTimes(1);
        expect(connection.release.mock.calls[0][0]).toBeFalsy();
    });

    it("destroys the connection instead when it cannot be reset", async () => {
        connection.query.mockImplementation((async (query: unknown) => {
            const text = typeof query === "string" ? query : (query as { text: string }).text;
            statements.push(text);
            if (text.includes("SESSION AUTHORIZATION")) {
                throw new Error("current transaction is aborted, commands ignored until end of transaction block");
            }
            return { rows: [], fields: [], rowCount: 0, command: "SELECT" };
        }) as never);
        const driver = driverOver(drizzleNodePg(pool));

        await driver.executeSql("BEGIN; SELECT 1/0", { isolateSession: true }).catch(() => undefined);

        expect(connection.release).toHaveBeenCalledWith(true);
    });
});
