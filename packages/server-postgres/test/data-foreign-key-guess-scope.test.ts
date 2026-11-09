/**
 * A filter or sort names a field by its own name, once a collection is known.
 *
 * When a name matched no column, the resolution guessed at an owning
 * relation's foreign key — `manager` → `managerId`, `manager_id` — and it did
 * so even with the collection in hand, after every declared relation had
 * already been tried. The field-access check at the door (`GET /api/data`, the
 * socket's frames) judges the name it was sent, and `manager` is no property,
 * so it passed; the driver then filtered and sorted on `managerId`, a column
 * the caller may not read, and answered one predicate at a time what the row
 * strip kept out of every response. The guesses are for callers that hand over
 * no collection to resolve against, and only those now reach them.
 *
 * Against a real Postgres (PGlite).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import type { RestFetchService } from "@rebasepro/types";

type RestReadOptions = Parameters<RestFetchService["fetchCollectionForRest"]>[1];

const staffTable = pgTable("staff", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    managerId: varchar("manager_id")
});

const staff: CollectionConfig = {
    name: "Staff",
    slug: "staff",
    table: "staff",
    properties: {
        id: { name: "Id", type: "string", isId: true },
        name: { name: "Name", type: "string" },
        managerId: { name: "Manager", type: "string", columnName: "manager_id", access: { read: ["hr"] } }
    }
};

let db: PGlite;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE staff (id varchar PRIMARY KEY, name varchar, manager_id varchar);
        INSERT INTO staff VALUES ('a', 'Ada', 'boss'), ('b', 'Bob', 'other');
    `);
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([staff]);
    registry.registerTable(staffTable, "staff");
    const orm = drizzle(db, { schema: { staff: staffTable } });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
});

afterAll(async () => {
    await db.close();
});

const read = (options: RestReadOptions) =>
    driver.restFetchService!.fetchCollectionForRest("staff", options);

describe("a collection's filter and sort names", () => {
    it("do not reach a foreign key by a guessed name in a filter", async () => {
        await expect(read({ filter: { manager: ["==", "boss"] } }))
            .rejects.toMatchObject({ code: "UNKNOWN_FILTER_FIELD" });
    });

    it("do not reach a foreign key by a guessed name in a sort", async () => {
        await expect(read({ orderBy: [["manager", "asc"]] })).rejects.toMatchObject({ statusCode: 400 });
    });

    it("still resolve the property's own name", async () => {
        expect((await read({ filter: { managerId: ["==", "boss"] } })).map(row => row.id)).toEqual(["a"]);
    });
});

describe("with no collection to resolve against", () => {
    it("still guesses an owning relation's foreign key", () => {
        const [condition] = DrizzleConditionBuilder.buildFilterConditions(
            { manager: ["==", "boss"] },
            staffTable,
            "staff"
        );
        expect(new PgDialect().sqlToQuery(condition).sql).toBe('"staff"."manager_id" = $1');
    });
});
