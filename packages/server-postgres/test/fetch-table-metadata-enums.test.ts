import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

/**
 * `fetchTableMetadata` — what the CMS's "import a table" flow reads — asked for
 * the labels of each enum column's type in its own query, one after another:
 * a table with eight status-like columns was eight round trips before the
 * rest of the metadata. It now reads them all in one.
 */
describe("fetchTableMetadata on a table with enum columns", () => {
    let pglite: PGlite;
    let driver: PostgresBackendDriver;
    let statements: number;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        await pglite.exec(`
            CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');
            CREATE TYPE size AS ENUM ('s', 'm', 'l', 'xl');
            CREATE TYPE tier AS ENUM ('free', 'pro');
            CREATE TYPE point2 AS (x int, y int);
            CREATE TABLE things (
                id int PRIMARY KEY,
                mood mood, other_mood mood, size size, tier tier, at point2, name text
            );
        `);
        const db = drizzle(pglite);
        const execute = db.execute.bind(db);
        statements = 0;
        db.execute = ((query: Parameters<typeof execute>[0]) => {
            statements++;
            return execute(query);
        }) as typeof db.execute;
        const registry = new PostgresCollectionRegistry();
        driver = new PostgresBackendDriver(db as never, new RealtimeService(db as never, registry), registry);
    });

    afterEach(async () => {
        await pglite.close();
    });

    it("reads every enum's labels in one query, in their order", async () => {
        const metadata = await driver.fetchTableMetadata("things");

        // Columns, the enums, foreign keys, junctions, policies: five, however
        // many enum columns the table has. One per enum column was nine here.
        expect(statements).toBe(5);
        const labels = Object.fromEntries(metadata.columns.map(column => [column.column_name, (column as { enum_values?: unknown }).enum_values]));
        expect(labels).toEqual({
            id: undefined,
            mood: ["sad", "ok", "happy"],
            other_mood: ["sad", "ok", "happy"],
            size: ["s", "m", "l", "xl"],
            tier: ["free", "pro"],
            at: [],
            name: undefined
        });
    });

    it("asks nothing about enums for a table without one", async () => {
        await pglite.exec("CREATE TABLE plain (id int PRIMARY KEY, name text)");

        await driver.fetchTableMetadata("plain");

        expect(statements).toBe(4);
    });
});
