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
                kind: "hasMany",
                relationName: "seats",
                target: () => seatsCollection,
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

    describe("batching parents that share their first key column", () => {
        // `bookings` keyed on (tenant_id, ref): two bookings of the same tenant
        // differ only in the second column.
        const tenantBookings: CollectionConfig = {
            slug: "tenant_bookings",
            name: "Tenant Bookings",
            table: "tenant_bookings",
            properties: {
                tenant_id: { type: "number",
isId: true },
                ref: { type: "string",
isId: true },
                seats: { type: "relation",
relationName: "seats" }
            },
            relations: [
                {
                    kind: "via",
                    relationName: "seats",
                    target: () => seatsCollection,
                    cardinality: "many",
                    joinPath: [
                        { table: "seats",
on: { from: "tenant_bookings.ref",
to: "seats.booking_ref" } }
                    ]
                }
            ]
        };

        beforeEach(() => {
            jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
                path.startsWith("tenant_bookings") ? tenantBookings : seatsCollection);
            jest.spyOn(registry, "getTable").mockImplementation(name => {
                if (name === "tenant_bookings") return table("tenant_bookings", ["tenant_id", "ref"]) as any;
                if (name === "seats") return table("seats", ["seat_row", "seat_number", "booking_ref"]) as any;
                return undefined;
            });
        });

        it("groups each parent's rows under its own whole-key address", async () => {
            // Both rows are tenant 1. Grouping on `tenant_id` alone would file
            // them under one key, and the last one written would win — every
            // booking of the tenant showing the same seat.
            const db = dbReturning([
                {
                    tenant_bookings: { tenant_id: 1,
ref: "A" },
                    seats: { seat_row: "A",
seat_number: 1,
booking_ref: "A" }
                },
                {
                    tenant_bookings: { tenant_id: 1,
ref: "B" },
                    seats: { seat_row: "B",
seat_number: 2,
booking_ref: "B" }
                }
            ]);
            const relationService = new RelationService(db as any, registry);

            const result = await relationService.batchFetchRelatedEntitiesMany(
                "tenant_bookings",
                ["1:::A", "1:::B"],
                "seats",
                (tenantBookings.relations as any)[0]
            );

            expect([...result.keys()].sort()).toEqual(["1:::A", "1:::B"]);
            expect(result.get("1:::A")!.map(r => r.id)).toEqual(["A:::1"]);
            expect(result.get("1:::B")!.map(r => r.id)).toEqual(["B:::2"]);
        });
    });

    describe("relations that cannot name a composite-keyed parent", () => {
        // `foreignKeyOnTarget` is one column; `seats.booking_id` cannot hold the
        // two values that identify a (tenant_id, ref) booking.
        const viaSingleFk: CollectionConfig = {
            slug: "tenant_bookings",
            name: "Tenant Bookings",
            table: "tenant_bookings",
            properties: {
                tenant_id: { type: "number",
isId: true },
                ref: { type: "string",
isId: true },
                seats: { type: "relation",
relationName: "seats" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "seats",
                    target: () => seatsCollection,
                    foreignKeyOnTarget: "booking_id"
                }
            ]
        };

        beforeEach(() => {
            jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
                path.startsWith("tenant_bookings") ? viaSingleFk : seatsCollection);
            jest.spyOn(registry, "getTable").mockImplementation(name => {
                if (name === "tenant_bookings") return table("tenant_bookings", ["tenant_id", "ref"]) as any;
                if (name === "seats") return table("seats", ["seat_row", "seat_number", "booking_id"]) as any;
                return undefined;
            });
        });

        it("says so, instead of silently matching on the first key column", async () => {
            // Left alone this reads `booking_id` as `tenant_id` and hands one
            // tenant's seats to every booking they own.
            const relationService = new RelationService(dbReturning([]) as any, registry);

            await expect(relationService.batchFetchRelatedEntitiesMany(
                "tenant_bookings",
                ["1:::A"],
                "seats",
                (viaSingleFk.relations as any)[0]
            )).rejects.toThrow(/single foreign-key column.*composite key|composite key/i);
        });
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
                    kind: "hasMany",
                    relationName: "guests",
                    target: () => guestsCollection,
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
