/**
 * Two ways a filter answered with rows that do not match it.
 *
 * **`array-contains-any` on a jsonb array.** It compiled to `?|`, which asks
 * whether any of a list of *strings* is a top-level key or string element of
 * the document. A number array is neither, so `{ scores: ["array-contains-any",
 * [3]] }` matched no row — while `["array-contains", 3]`, compiled to `@>`, found
 * the same rows. It is now one containment test per value.
 *
 * **A field named like an object method.** The column lookup asked `key in
 * table`, which is true of `constructor`, `toString` and every other name a
 * plain object answers to, and of `enableRLS`, which Drizzle sets on the table.
 * The "column" it found was a function, bound as a parameter, so
 * `{ constructor: ["!=", "x"] }` compared two parameters and answered with every
 * row — the silent widening an unknown filter field is refused to prevent —
 * and `__proto__` crashed the compiler into a 500. Both are now the 400 any
 * other unknown field gets, and so is a sort on one.
 *
 * Against a real Postgres (PGlite): whether a row matches is the database's
 * answer.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { jsonb, pgTable, text, varchar } from "drizzle-orm/pg-core";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import type { RestFetchService } from "@rebasepro/types";

type RestReadOptions = Parameters<RestFetchService["fetchCollectionForRest"]>[1];

const itemsTable = pgTable("items", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    labels: text("labels").array(),
    scores: jsonb("scores"),
    words: jsonb("words")
});

const items: LegacyCollectionConfig = {
    name: "Items",
    slug: "items",
    table: "items",
    properties: {
        id: { name: "Id", type: "string", isId: true },
        name: { name: "Name", type: "string" },
        labels: { name: "Labels", type: "array", of: { type: "string" } },
        scores: { name: "Scores", type: "array", of: { type: "number" } },
        words: { name: "Words", type: "array", of: { type: "string" } }
    }
} as LegacyCollectionConfig;

let db: PGlite;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE items (id varchar PRIMARY KEY, name varchar, labels text[], scores jsonb, words jsonb);
        INSERT INTO items VALUES
            ('a', 'Alpha', '{red}', '[1, 2]', '["x", "y"]'),
            ('b', 'Beta', '{blue}', '[3]', '["z"]'),
            ('c', 'Gamma', '{}', '[]', '[]'),
            ('d', 'Delta', NULL, NULL, NULL),
            ('e', 'Epsilon', '{red,blue}', '[2, 3]', '["y"]');
    `);
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([items]);
    registry.registerPgTable(itemsTable, "items");
    const orm = drizzle(db, { schema: { items: itemsTable } });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
});

afterAll(async () => {
    await db.close();
});

const ids = async (options: RestReadOptions): Promise<string[]> =>
    (await driver.restFetchService!.fetchCollectionForRest("items", options))
        .map(row => String(row.id))
        .sort();

describe("array-contains-any on a jsonb array", () => {
    it("matches a number array by its numbers", async () => {
        expect(await ids({ filter: { scores: ["array-contains-any", [3]] } })).toEqual(["b", "e"]);
        expect(await ids({ filter: { scores: ["array-contains-any", [1, 3]] } })).toEqual(["a", "b", "e"]);
    });

    it("agrees with array-contains for a single value", async () => {
        expect(await ids({ filter: { scores: ["array-contains-any", [2]] } }))
            .toEqual(await ids({ filter: { scores: ["array-contains", 2] } }));
    });

    it("still matches a string array by its strings", async () => {
        expect(await ids({ filter: { words: ["array-contains-any", ["y", "z"]] } })).toEqual(["a", "b", "e"]);
    });

    it("matches nothing for an empty list, and leaves native arrays as they were", async () => {
        expect(await ids({ filter: { scores: ["array-contains-any", []] } })).toEqual([]);
        expect(await ids({ filter: { labels: ["array-contains-any", ["blue"]] } })).toEqual(["b", "e"]);
    });
});

describe("a field named like an object method", () => {
    it.each(["constructor", "toString", "hasOwnProperty", "enableRLS", "__proto__"])(
        "'%s' is an unknown filter field, not a match for every row",
        async (field) => {
            await expect(ids({ filter: { [field]: ["!=", "x"] } }))
                .rejects.toMatchObject({ code: "UNKNOWN_FILTER_FIELD" });
        }
    );

    it("is an unknown sort field too", async () => {
        await expect(ids({ orderBy: [["constructor", "asc"]] }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("leaves real columns resolving as before", async () => {
        expect(await ids({ filter: { name: ["==", "Beta"] }, orderBy: [["name", "asc"]] })).toEqual(["b"]);
    });
});
