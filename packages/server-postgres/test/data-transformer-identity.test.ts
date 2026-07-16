import { CollectionConfig } from "@rebasepro/types";
import { parseDataFromServer } from "../src/data-transformer";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    /** A db whose `select…where` records the value it was filtered by. */
    const dbReturning = (rows: Record<string, unknown>[]) => {
        const filteredBy: unknown[] = [];
        const chain: Record<string, unknown> = {};
        chain.from = jest.fn(() => chain);
        chain.where = jest.fn((condition: unknown) => {
            // `eq(col, value)` lays the comparison out as query chunks — the
            // column, " = ", then the bound value, which is the primitive here.
            const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks ?? [];
            for (const chunk of chunks) {
                if (typeof chunk === "string" || typeof chunk === "number") filteredBy.push(chunk);
            }
            return chain;
        });
        chain.limit = jest.fn(() => Promise.resolve(rows));
        return { db: { select: jest.fn(() => chain) },
filteredBy };
    };

    const attendeesCollection: CollectionConfig = {
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
    const seatsCollection: CollectionConfig = {
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
    const eventsCollection: CollectionConfig = {
        slug: "events",
        name: "Events",
        table: "events",
        properties: {
            sku: { type: "string",
isId: true },
            id: { type: "string" },
            attendees: { type: "relation",
relationName: "attendees" }
        },
        relations: [
            {
                relationName: "attendees",
                target: () => attendeesCollection,
                cardinality: "many",
                direction: "inverse",
                foreignKeyOnTarget: "event_sku"
            }
        ]
    };

    const eventsWithSeats: CollectionConfig = {
        ...eventsCollection,
        properties: {
            sku: { type: "string",
isId: true },
            seat: { type: "relation",
relationName: "seat" }
        },
        relations: [
            {
                relationName: "seat",
                target: () => seatsCollection,
                cardinality: "one",
                direction: "inverse",
                foreignKeyOnTarget: "event_sku"
            }
        ]
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "events") return table("events", ["sku", "id"]) as any;
            if (name === "attendees") return table("attendees", ["id", "event_sku"]) as any;
            if (name === "seats") return table("seats", ["seat_row", "seat_number", "event_sku"]) as any;
            return undefined;
        });
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
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
            eventsCollection,
            db as any,
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
            eventsWithSeats,
            db as any,
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
            eventsCollection,
            db as any,
            registry
        ) as Record<string, unknown>;

        expect((result.attendees as { id: string }[]).map(ref => ref.id)).toEqual(["5", "6"]);
    });
});
