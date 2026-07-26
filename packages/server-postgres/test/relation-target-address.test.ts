import { CollectionConfig } from "@rebasepro/types";
import { toCmsRow } from "../src/services/row-pipeline";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A relation ref points at the target row by address, and that address is the
 * whole key.
 *
 * Every ref used to read `targetPks[0]` — the first key column. For a
 * composite-keyed target that is one part of the address, so the ref pointed at
 * every row that shared it; for a target whose key could not be resolved it was
 * `undefined[0]`, which threw and took down the parent's fetch. Both go through
 * `buildCompositeId` now.
 */
describe("relation ref target — addressed by the whole key", () => {
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
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
            occupant: { type: "string" }
        }
    };

    const bookingsCollection: CollectionConfig = {
        slug: "bookings",
        name: "Bookings",
        table: "bookings",
        properties: {
            id: { type: "number",
isId: "increment" },
            seat: { type: "relation",
relationName: "seat" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "seat",
                target: () => seatsCollection,
                localKey: "seat_id"
            }
        ]
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("bookings") ? bookingsCollection : seatsCollection);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "bookings") return table("bookings", ["id"]) as any;
            if (name === "seats") return table("seats", ["seat_row", "seat_number", "occupant"]) as any;
            return undefined;
        });
    });

    // The CMS row builder is a plain function now, rather than a private
    // reached into through a cast.
    const toFlatRow = (row: Record<string, unknown>, collection: CollectionConfig) =>
        toCmsRow(row, collection, registry);

    it("joins a composite target key into the ref address", () => {
        const result = toFlatRow({
            id: 1,
            seat: { seat_row: "A",
seat_number: 12,
occupant: "Ada" }
        }, bookingsCollection);

        // Not "A" — the whole key, so the ref resolves to one seat and not a row.
        expect((result.seat as { id: string }).id).toBe("A:::12");
    });

    it("survives a target with no resolvable key at all", () => {
        // No `isId`, no drizzle-declared primary, no `id` column. Reading
        // `targetPks[0].fieldName` here was a TypeError that failed the whole
        // parent fetch; a first-column guess is wrong-ish, but it returns rows.
        const keylessCollection: CollectionConfig = {
            slug: "notes",
            name: "Notes",
            table: "notes",
            properties: { body: { type: "string" } }
        };
        const keylessBooking: CollectionConfig = {
            ...bookingsCollection,
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "seat",
                    target: () => keylessCollection,
                    localKey: "seat_id"
                }
            ]
        };
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "bookings") return table("bookings", ["id"]) as any;
            if (name === "notes") return table("notes", ["body"]) as any;
            return undefined;
        });
        const result = toFlatRow({
            id: 1,
            seat: { body: "aisle, please" }
        }, keylessBooking);

        expect((result.seat as { id: string }).id).toBe("aisle, please");
    });
});
