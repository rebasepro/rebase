/**
 * E2E: a `columnType: "time"` property round-trips, against a real Postgres.
 *
 * Studio offers `time` for a date property, and the read path ran the column's
 * `09:30:00` through `new Date(...)`, which is Invalid — so every time column
 * read as `null` in the API, the table and the form, and a user who "filled
 * it in" wrote a whole timestamp into it, read in the server's zone.
 *
 * A time of day is served the way a date-only column is: as a date on a fixed
 * day in UTC — `1970-01-01T09:30:00.000Z` — and written back as that UTC time
 * of day, so the zone the server or the browser runs in cannot move it.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar, time } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const shopsTable = pgTable("shops", { id: varchar("id").primaryKey(), opens: time("opens") });
const shops = {
    name: "Shops", slug: "shops", table: "shops",
    properties: {
        id: { type: "string", isId: true },
        opens: { type: "date", columnType: "time" }
    }
} as unknown as CollectionConfig;

describe("a time column", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        // A server zone far from UTC, so a write that goes through local time shows.
        await admin.query(`ALTER DATABASE rebase SET timezone TO 'Pacific/Auckland';`);
        await admin.query("CREATE TABLE shops (id VARCHAR PRIMARY KEY, opens time); INSERT INTO shops VALUES ('s1', '09:30');");
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([shops]);
        registry.registerTable(shopsTable, "shops");
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    });

    afterAll(async () => {
        await pool?.end();
        await admin?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("reads a stored time as that time of day", async () => {
        const row = await driver.fetchOne({ path: "shops", id: "s1", collection: shops });
        expect(row?.opens).toEqual({ __type: "date", value: "1970-01-01T09:30:00.000Z" });
    });

    it("writes a time of day back as itself", async () => {
        await driver.save({
            path: "shops", collection: shops, id: "s1", status: "existing",
            values: { opens: new Date("1970-01-01T18:45:30.000Z") }
        });
        const { rows } = await admin.query("SELECT opens::text AS opens FROM shops WHERE id = 's1'");
        expect(rows[0].opens).toBe("18:45:30");
        const row = await driver.fetchOne({ path: "shops", id: "s1", collection: shops });
        expect(row?.opens).toEqual({ __type: "date", value: "1970-01-01T18:45:30.000Z" });
    });

    it("takes a time written as text", async () => {
        await driver.save({ path: "shops", collection: shops, id: "s1", status: "existing", values: { opens: "07:05" } });
        const { rows } = await admin.query("SELECT opens::text AS opens FROM shops WHERE id = 's1'");
        expect(rows[0].opens).toBe("07:05:00");
    });
});
