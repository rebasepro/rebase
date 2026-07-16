import { CollectionConfig } from "@rebasepro/types";
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * Every related row RelationService hands back is named by an address, and that
 * address is the whole key.
 *
 * These addresses are what the admin routes on and what the REST layer embeds,
 * so a composite-keyed target reduced to its first key column produces a link
 * that opens some *other* row — one that merely shares that column. Nothing
 * errors; it just goes to the wrong place.
 */
describe("RelationService — related rows are addressed by the whole key", () => {
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
            booking_id: { type: "number" }
        }
    };

    const bookingsCollection: CollectionConfig = {
        slug: "bookings",
        name: "Bookings",
        table: "bookings",
        properties: {
            id: { type: "number",
isId: "increment" },
            seats: { type: "relation",
relationName: "seats" }
        },
        relations: [
            {
                relationName: "seats",
                target: () => seatsCollection,
                cardinality: "many",
                direction: "inverse",
                foreignKeyOnTarget: "booking_id"
            }
        ],
        idField: "id"
    };

    /** A db whose select-chain resolves to `rows`. */
    const dbReturning = (rows: Record<string, unknown>[]) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["from", "where", "$dynamic", "limit", "offset", "orderBy", "innerJoin", "leftJoin"]) {
            chain[method] = jest.fn(() => chain);
        }
        chain.then = (resolve: (r: unknown) => void) => resolve(rows);
        return { select: jest.fn(() => chain) };
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("bookings") ? bookingsCollection : seatsCollection);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "bookings") return table("bookings", ["id"]) as any;
            if (name === "seats") return table("seats", ["seat_row", "seat_number", "booking_id"]) as any;
            return undefined;
        });
    });

    it("joins a composite-keyed target's key into each related row's address", async () => {
        const db = dbReturning([
            { seat_row: "A",
seat_number: 12,
booking_id: 1 },
            { seat_row: "A",
seat_number: 13,
booking_id: 1 }
        ]);
        const relationService = new RelationService(db as any, registry);

        const rows = await relationService.fetchRelatedEntities("bookings", 1, "seats");

        // Not ["A", "A"] — which would name the same row twice, and the wrong one.
        expect(rows.map(row => row.id)).toEqual(["A:::12", "A:::13"]);
        expect(rows[0].path).toBe("seats");
        expect(rows[0].values).toMatchObject({ seat_row: "A",
seat_number: 12 });
    });

    it("addresses a single-key target by that key, unchanged", async () => {
        // The ordinary case has to keep working: one key, one value, no separator.
        const guestsCollection: CollectionConfig = {
            slug: "guests",
            name: "Guests",
            table: "guests",
            properties: {
                id: { type: "number",
isId: "increment" },
                booking_id: { type: "number" }
            },
            idField: "id"
        };
        const withGuests: CollectionConfig = {
            ...bookingsCollection,
            properties: {
                id: { type: "number",
isId: "increment" },
                guests: { type: "relation",
relationName: "guests" }
            },
            relations: [
                {
                    relationName: "guests",
                    target: () => guestsCollection,
                    cardinality: "many",
                    direction: "inverse",
                    foreignKeyOnTarget: "booking_id"
                }
            ]
        };
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("bookings") ? withGuests : guestsCollection);
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "bookings") return table("bookings", ["id"]) as any;
            if (name === "guests") return table("guests", ["id", "booking_id"]) as any;
            return undefined;
        });

        const db = dbReturning([{ id: 5,
booking_id: 1 }, { id: 6,
booking_id: 1 }]);
        const relationService = new RelationService(db as any, registry);

        const rows = await relationService.fetchRelatedEntities("bookings", 1, "guests");

        expect(rows.map(row => row.id)).toEqual(["5", "6"]);
    });
});
