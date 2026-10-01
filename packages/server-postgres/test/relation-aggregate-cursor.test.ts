/**
 * Cursor paging over a sort by an aggregate of a relation, against a real
 * Postgres.
 *
 * `sdk/relations.md` promises it — "Cursor pagination works over it" — and the
 * keyset comparison is built for it: the aggregate is not a column of the row,
 * so the cursor row's value is recomputed in SQL from the id the cursor carries.
 * But `encodeCursor` refused any sort key whose value was not on the row, so a
 * listing sorted by `count(applications)` was never issued a cursor:
 * `meta.nextCursor` was absent beside `hasMore: true`, and the documented
 * `do { … } while (after)` loop stopped after the first page.
 *
 * So this walks the listing page by page through the cursors the driver issues,
 * and holds the result to one unpaged read of the same order — ties, and the
 * talent with no application at all, included.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, OrderByTuple } from "@rebasepro/types";
import { cursorToStartAfter, decodeCursor } from "@rebasepro/common";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const talentsTable = pgTable("talents", {
    id: serial("id").primaryKey(),
    name: varchar("name")
});

const applicationsTable = pgTable("talent_applications", {
    id: serial("id").primaryKey(),
    talentId: integer("talent_id")
});

const applications = {
    slug: "talent_applications",
    name: "Applications",
    table: "talent_applications",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        talentId: { name: "Talent", type: "number", columnName: "talent_id" }
    }
} as unknown as CollectionConfig;

const talents = {
    slug: "talents",
    name: "Talents",
    table: "talents",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        applications: {
            name: "Applications",
            type: "relation",
            relation: { kind: "hasMany", target: () => applications, foreignKeyOnTarget: "talent_id" }
        }
    }
} as unknown as CollectionConfig;

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([talents, applications]);
    registry.registerTable(talentsTable, "talents");
    registry.registerTable(applicationsTable, "talent_applications");
    const orm = drizzle(pglite, { schema: { talents: talentsTable, talent_applications: applicationsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    // Counts 3, 2, 2, 1, 0, 2: a tie three wide, and a talent with none.
    await db.exec(`
        CREATE TABLE talents (id serial PRIMARY KEY, name varchar);
        CREATE TABLE talent_applications (id serial PRIMARY KEY, talent_id integer REFERENCES talents(id));
        INSERT INTO talents (name) VALUES ('a'), ('b'), ('c'), ('d'), ('e'), ('f');
        INSERT INTO talent_applications (talent_id) VALUES (1), (1), (1), (2), (2), (3), (3), (4), (6), (6);
    `);
});

afterEach(async () => {
    await db.close();
});

describe("cursor paging over a relation-aggregate sort", () => {
    it.each([
        ["count(applications)", "desc", 2],
        ["count(applications)", "asc", 4],
        ["count(applications)", "desc", 1]
    ] as const)("walks every row once, in order, sorted by %s %s, %i per page", async (key, direction, limit) => {
        const driver = driverOver(db);
        const rest = driver.restFetchService!;
        const orderBy: OrderByTuple[] = [[key, direction]];

        const whole = (await rest.fetchCollectionForRest("talents", { orderBy })).map(row => row.id);
        expect(whole).toHaveLength(6);

        const seen: unknown[] = [];
        let startAfter: Record<string, unknown> | undefined;
        // Bounded, so a cursor that never advances fails instead of hanging.
        for (let page = 0; page < 10; page++) {
            const rows = await rest.fetchCollectionForRest("talents", { orderBy, limit, startAfter });
            seen.push(...rows.map(row => row.id));
            if (rows.length < limit) break;
            const cursor = rest.cursorFor!("talents", rows[rows.length - 1], orderBy);
            expect(cursor).toBeDefined();
            startAfter = cursorToStartAfter(decodeCursor(cursor!));
        }

        expect(seen).toEqual(whole);
    });
});
