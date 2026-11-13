import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { toFlatRow } from "../src/services/row-pipeline";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { textTable } from "./helpers/spg-c-tables";

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
    const registry = new FixtureTableRegistry();

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
            occupant: { type: "string" },
            booking_id: { type: "number" }
        }
    };

    const bookingsCollection: LegacyCollectionConfig = {
        slug: "bookings",
        name: "Bookings",
        table: "bookings",
        properties: {
            id: { type: "number",
isId: "increment" },
            // A `hasOne`: one column cannot reference a composite key, so the
            // link to a composite-keyed target is held on the target's side.
            seat: { type: "relation", relation: { kind: "hasOne", relationName: "seat", target: () => seatsCollection, foreignKeyOnTarget: "booking_id" } }
        }
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("bookings") ? bookingsCollection : seatsCollection);
        jest.spyOn(registry, "getPgTable").mockImplementation(name => {
            if (name === "bookings") return textTable("bookings", ["id"]);
            if (name === "seats") return textTable("seats", ["seat_row", "seat_number", "occupant"]);
            return undefined;
        });
    });

    // The row builder is a plain function now, rather than a private reached
    // into through a cast. Named differently from the import it wraps: this
    // local only exists to bind `registry`, and sharing the name makes it call
    // itself — which is a stack overflow, not a test failure anyone can read.
    const flatten = (row: Record<string, unknown>, collection: LegacyCollectionConfig) =>
        toFlatRow(row, registry.requireTable(collection.slug), registry);

    it("joins a composite target key into the ref address", () => {
        const result = flatten({
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
        const keylessCollection: LegacyCollectionConfig = {
            slug: "notes",
            name: "Notes",
            table: "notes",
            properties: { body: { type: "string" } }
        };
        const keylessBooking: LegacyCollectionConfig = {
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
        jest.spyOn(registry, "getPgTable").mockImplementation(name => {
            if (name === "bookings") return textTable("bookings", ["id"]);
            if (name === "notes") return textTable("notes", ["body"]);
            return undefined;
        });
        const result = flatten({
            id: 1,
            seat: { body: "aisle, please" }
        }, keylessBooking);

        expect((result.seat as { id: string }).id).toBe("aisle, please");
    });
});
