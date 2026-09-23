/**
 * Cursor paging over a timestamp column that holds microseconds.
 *
 * Postgres stores a `timestamptz` to the microsecond; the API serves it to the
 * millisecond, and the cursor was built from the served row. So the seek
 * compared the column against a value up to 999µs short of the cursor row's
 * own, and every row in that sliver sorted on the wrong side of it: six rows
 * written in one transaction, paged `createdAt desc` two at a time, answered
 * two rows and then `hasMore: false`; ascending, page two repeated the last row
 * of page one, and at `limit: 1` the listing never ended.
 *
 * The seek now reads the cursor row's exact value back by its key, as long as
 * that row still holds the millisecond the cursor carries.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, OrderByTuple } from "@rebasepro/types";
import { cursorToStartAfter, decodeCursor } from "@rebasepro/common";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const eventsTable = pgTable("events", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
});

const events: CollectionConfig = {
    name: "Events",
    slug: "events",
    table: "events",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        createdAt: { name: "Created", type: "date", columnName: "created_at" }
    }
};

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([events]);
    registry.registerTable(eventsTable, "events");
    const orm = drizzle(pglite, { schema: { events: eventsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

/** Every id, page by page, following each page's cursor to the end. */
async function pageThrough(driver: PostgresBackendDriver, orderBy: OrderByTuple[], limit: number): Promise<unknown[]> {
    const rest = driver.restFetchService!;
    const seen: unknown[] = [];
    let startAfter: Record<string, unknown> | undefined;
    // Bounded, so a cursor that never advances fails the test instead of hanging it.
    for (let page = 0; page < 20; page++) {
        const rows = await rest.fetchCollectionForRest("events", { orderBy, limit, startAfter });
        seen.push(...rows.map(row => row.id));
        if (rows.length < limit) break;
        const cursor = rest.cursorFor!("events", rows[rows.length - 1], orderBy);
        expect(cursor).toBeDefined();
        startAfter = cursorToStartAfter(decodeCursor(cursor!));
    }
    return seen;
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    // Four rows sharing one microsecond, as a single transaction writes them;
    // three more inside the same millisecond but a microsecond apart; and two
    // in milliseconds of their own on either side.
    await db.exec(`
        CREATE TABLE events (id serial PRIMARY KEY, title varchar, created_at timestamptz);
        INSERT INTO events (title, created_at) VALUES
            ('tie-1', '2026-09-01 10:00:00.123456+00'),
            ('tie-2', '2026-09-01 10:00:00.123456+00'),
            ('tie-3', '2026-09-01 10:00:00.123456+00'),
            ('tie-4', '2026-09-01 10:00:00.123456+00'),
            ('us-1', '2026-09-01 10:00:00.123001+00'),
            ('us-2', '2026-09-01 10:00:00.123999+00'),
            ('us-3', '2026-09-01 10:00:00.123500+00'),
            ('earlier', '2026-09-01 10:00:00.122000+00'),
            ('later', '2026-09-01 10:00:00.124000+00');
    `);
});

afterEach(async () => {
    await db.close();
});

describe("keyset paging over a microsecond timestamp", () => {
    it.each([
        ["desc", 2],
        ["asc", 2],
        ["asc", 1],
        ["desc", 1]
    ] as const)("createdAt %s, %i at a time, serves every row once, in the listing's order", async (direction, limit) => {
        const driver = driverOver(db);
        const orderBy: OrderByTuple[] = [["createdAt", direction]];
        const whole = (await driver.restFetchService!.fetchCollectionForRest("events", { orderBy }))
            .map(row => row.id);
        expect(whole).toHaveLength(9);

        expect(await pageThrough(driver, orderBy, limit)).toEqual(whole);
    });

    it("a cursor whose row has since been deleted still seeks, from the millisecond it carries", async () => {
        const driver = driverOver(db);
        const rest = driver.restFetchService!;
        const orderBy: OrderByTuple[] = [["createdAt", "desc"]];
        const [first] = await rest.fetchCollectionForRest("events", { orderBy, limit: 1 });
        expect(first.title).toBe("later");
        const cursor = rest.cursorFor!("events", first, orderBy)!;
        await db.exec("DELETE FROM events WHERE title = 'later'");

        const next = await rest.fetchCollectionForRest("events", {
            orderBy, limit: 1, startAfter: cursorToStartAfter(decodeCursor(cursor))
        });
        expect(next.map(row => row.title)).toEqual(["us-2"]);
    });
});
