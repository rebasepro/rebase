/**
 * A write stores the text it was given.
 *
 * The last pass before a row is written knew no property types, and coerced
 * strings anyway: any value reading `nan` in any case became NULL, and any
 * value shaped like an ISO timestamp was re-printed by `Date`. So a person
 * named "Nan" was saved with no name, `{ meta: { label: "nan" } }` lost its
 * label, and a text field holding `2024-01-01T00:00:00.123456Z` came back with
 * its microseconds cut off. The coercions belong to the properties that need
 * them: `"NaN"` on a number, a date's text on a date.
 *
 * Against a real Postgres (PGlite): what is stored is the database's answer.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, jsonb, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { serializeColumnToServer } from "../src/data-transformer";
import { col } from "@rebasepro/types";
import { columnOf } from "./helpers/codec-columns";

const peopleTable = pgTable("people", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    note: varchar("note"),
    meta: jsonb("meta"),
    score: integer("score"),
    price: numeric("price"),
    seenAt: timestamp("seen_at", { withTimezone: true, mode: "string" })
});

const people: CollectionConfig = {
    name: "People",
    slug: "people",
    table: "people",
    properties: {
        id: { name: "Id", type: "string", isId: true },
        name: { name: "Name", type: "string" },
        note: { name: "Note", type: "string" },
        meta: { name: "Meta", type: "map" },
        score: { name: "Score", type: "number" },
        price: { name: "Price", type: "number" },
        seenAt: { name: "Seen", type: "date", columnName: "seen_at" }
    }
} as CollectionConfig;

let db: PGlite;
let driver: PostgresBackendDriver;

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE people (id varchar PRIMARY KEY, name varchar, note varchar, meta jsonb, score integer, price numeric, seen_at timestamptz);
        INSERT INTO people (id, name, score, price) VALUES ('p1', 'Ada', 1, 1.5);
    `);
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([people]);
    registry.registerPgTable(peopleTable, "people");
    const orm = drizzle(db, { schema: { people: peopleTable } });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
});

afterEach(async () => {
    await db.close();
});

async function saveAndRead(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    await driver.save({ path: "people", id: "p1", values, status: "existing" });
    const { rows } = await db.query<Record<string, unknown>>(
        "SELECT name, note, meta, score, price::text AS price, seen_at::text AS seen_at FROM people WHERE id = 'p1'"
    );
    return rows[0];
}

describe("text a write is given", () => {
    it("keeps a string that reads 'nan'", async () => {
        expect((await saveAndRead({ name: "Nan" })).name).toBe("Nan");
        expect((await saveAndRead({ name: "NaN" })).name).toBe("NaN");
    });

    it("keeps 'nan' inside a map", async () => {
        expect((await saveAndRead({ meta: { label: "nan" } })).meta).toEqual({ label: "nan" });
    });

    it("keeps a string shaped like a timestamp exactly as written", async () => {
        const text = "2024-01-01T00:00:00.123456Z";
        expect((await saveAndRead({ note: text })).note).toBe(text);
    });
});

describe("the coercions a column type asks for", () => {
    it("still reads 'NaN' on a number as no value", async () => {
        const row = await saveAndRead({ score: "NaN", price: "nan" });
        expect(row.score).toBeNull();
        expect(row.price).toBeNull();
    });

    it("still writes a date given in Date.toString() form", async () => {
        const row = await saveAndRead({ seenAt: new Date("2024-03-04T05:06:07Z").toString() });
        expect(new Date(String(row.seen_at)).toISOString()).toBe("2024-03-04T05:06:07.000Z");
    });

    it("normalizes a date's text, and only a date's", () => {
        const date = columnOf(col.timestamp({ withTimezone: true }));
        const text = columnOf(col.text());
        expect(serializeColumnToServer("2024-01-01T00:00:00Z", date)).toBe("2024-01-01T00:00:00.000Z");
        expect(serializeColumnToServer("2024-01-01T00:00:00Z", text)).toBe("2024-01-01T00:00:00Z");
    });
});
