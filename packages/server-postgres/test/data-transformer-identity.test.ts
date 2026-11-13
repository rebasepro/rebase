import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { getTableColumns } from "drizzle-orm";
import { pgTable, text, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { parseDataFromServer } from "../src/data-transformer";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";

/**
 * Reading an inverse relation means finding the rows that point *back* at this
 * one, so the query has to name this row — by its key columns, since a row
 * carries no address of its own.
 *
 * Both halves are derived: the FK value this row is matched by, and the address
 * of each ref built from the rows that come back. A composite-keyed target
 * addressed by its first column alone would name every row that shares it.
 */
describe("parseDataFromServer — inverse relations are addressed by key columns", () => {
    const registry = new FixtureTableRegistry();

    const tables: Record<string, PgTable> = {
        events: pgTable("events", { sku: text("sku"), id: text("id") }),
        attendees: pgTable("attendees", { id: text("id"), event_sku: text("event_sku") }),
        seats: pgTable("seats", { seat_row: text("seat_row"), seat_number: text("seat_number"), event_sku: text("event_sku") })
    };

    /**
     * A db that answers every read with `rows` and records the values the read
     * bound — what it was filtered by. drizzle's proxy driver takes a selected
     * row as its values in column order.
     */
    const dbReturning = (rows: Record<string, unknown>[]) => {
        const filteredBy: unknown[] = [];
        const db = drizzle(async (sql, params) => {
            filteredBy.push(...params);
            const table = tables[sql.match(/from "(\w+)"/)?.[1] ?? ""];
            const columns = table ? Object.keys(getTableColumns(table)) : [];
            return { rows: rows.map(row => columns.map(column => row[column] ?? null)) };
        });
        return { db, filteredBy };
    };

    const attendeesCollection: LegacyCollectionConfig = {
        slug: "attendees",
        name: "Attendees",
        table: "attendees",
        properties: {
            id: { type: "number",
isId: "increment" },
            event_sku: { type: "string" }
        }
    };

    // Composite-keyed target: a seat identified by (row, number).
    const seatsCollection: LegacyCollectionConfig = {
        slug: "seats",
        name: "Seats",
        table: "seats",
        properties: {
            seat_row: { type: "string",
isId: true },
            seat_number: { type: "number",
isId: true },
            event_sku: { type: "string" }
        }
    };

    // `sku` is the key; `id` is an ordinary column holding an external ref.
    const eventsCollection: LegacyCollectionConfig = {
        slug: "events",
        name: "Events",
        table: "events",
        properties: {
            sku: { type: "string",
isId: true },
            id: { type: "string" },
            attendees: { type: "relation" }
        },
        relations: [
            {
                kind: "hasMany",
                relationName: "attendees",
                target: () => attendeesCollection,
                foreignKeyOnTarget: "event_sku"
            }
        ]
    };

    // Its own slug: a table is served under one slug, and the registry
    // compiles the table that slug names.
    const eventsWithSeats: LegacyCollectionConfig = {
        ...eventsCollection,
        slug: "events_with_seats",
        properties: {
            sku: { type: "string",
isId: true },
            seat: { type: "relation" }
        },
        relations: [
            {
                kind: "hasOne",
                relationName: "seat",
                target: () => seatsCollection,
                foreignKeyOnTarget: "event_sku"
            }
        ]
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getPgTable").mockImplementation(name => {
            return tables[name];
        });
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("events_with_seats")) return eventsWithSeats;
            if (path.startsWith("events")) return eventsCollection;
            if (path.startsWith("attendees")) return attendeesCollection;
            if (path.startsWith("seats")) return seatsCollection;
            return undefined;
        });
    });

    it("matches the target's FK against the key column, not a column named `id`", async () => {
        const { db, filteredBy } = dbReturning([]);

        await parseDataFromServer(
            { sku: "EVT-1",
id: "external-ref-99" },
            registry.requireTable("events"),
            db,
            registry
        );

        // "EVT-1" — the key. "external-ref-99" is data, and would find the
        // attendees of a different event, or none.
        expect(filteredBy).toContain("EVT-1");
        expect(filteredBy).not.toContain("external-ref-99");
    });

    it("addresses a composite-keyed target's ref by its whole key", async () => {
        const { db } = dbReturning([
            { seat_row: "A",
seat_number: 12,
event_sku: "EVT-1" }
        ]);

        const result = await parseDataFromServer(
            { sku: "EVT-1" },
            registry.requireTable("events_with_seats"),
            db,
            registry
        ) as Record<string, unknown>;

        // Not "A" — that names every seat in the row.
        expect((result.seat as { id: string }).id).toBe("A:::12");
    });

    it("addresses each ref of a many relation by the target's key", async () => {
        const { db } = dbReturning([
            { id: 5,
event_sku: "EVT-1" },
            { id: 6,
event_sku: "EVT-1" }
        ]);

        const result = await parseDataFromServer(
            { sku: "EVT-1",
id: "external-ref-99" },
            registry.requireTable("events"),
            db,
            registry
        ) as Record<string, unknown>;

        expect((result.attendees as { id: string }[]).map(ref => ref.id)).toEqual(["5", "6"]);
    });
});
