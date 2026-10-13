/**
 * E2E: a `databaseDefault` column is filled by the database on create.
 *
 * `code text NOT NULL DEFAULT …` is required and has a value no property can
 * state. With `databaseDefault: true`, a create may leave it out — and the
 * admin form, which sends `null` for a field nobody filled in, must not turn
 * that into an INSERT of NULL, which the column's NOT NULL refuses and its
 * DEFAULT never sees.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const ticketsTable = pgTable("tickets", {
    id: varchar("id").primaryKey(),
    title: text("title").notNull(),
    code: text("code").notNull()
});

const tickets = {
    name: "Tickets", slug: "tickets", table: "tickets",
    properties: {
        id: { type: "string", isId: true },
        title: { type: "string", validation: { required: true } },
        code: { type: "string", validation: { required: true }, databaseDefault: true }
    }
} as unknown as CollectionConfig;

describe("databaseDefault on create", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE TABLE tickets (
                id VARCHAR PRIMARY KEY,
                title TEXT NOT NULL,
                code TEXT NOT NULL DEFAULT ('T-' || lower(md5((random())::text)))
            );
        `);
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([tickets]);
        registry.registerTable(ticketsTable, "tickets");
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await admin?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    const stored = async (id: string) =>
        (await admin.query("SELECT code FROM tickets WHERE id = $1", [id])).rows[0]?.code as string | undefined;

    it("fills a column the create leaves out", async () => {
        await driver.save({ path: "tickets", id: "t-1", values: { title: "Left out" }, status: "new", collection: tickets });
        expect(await stored("t-1")).toMatch(/^T-[0-9a-f]{32}$/);
    });

    it("fills a column the create sends as null, as the admin form does", async () => {
        await driver.save({ path: "tickets", id: "t-2", values: { title: "Sent null", code: null }, status: "new", collection: tickets });
        expect(await stored("t-2")).toMatch(/^T-[0-9a-f]{32}$/);
    });

    it("keeps a value the create does send", async () => {
        await driver.save({ path: "tickets", id: "t-3", values: { title: "Sent", code: "MINE" }, status: "new", collection: tickets });
        expect(await stored("t-3")).toBe("MINE");
    });
});
