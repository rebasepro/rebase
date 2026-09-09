import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const collectionRegistry = new PostgresCollectionRegistry();

/**
 * The admin renders a relation cell straight from the `data` payload the server
 * embeds in each relation ref (see RelationPreview: a relation carrying `data`
 * never calls useFetch). Two things have to hold for that to stay true, and
 * neither shows up as a test failure elsewhere if it regresses — the UI just
 * quietly starts issuing one request per relation cell:
 *
 *   1. fetchCollection embeds the related row under `data`.
 *   2. it does so in a number of queries that doesn't grow with the row count.
 */
describe("DataService - relation eager loading (admin N+1 guard)", () => {
    let dataService: DataService;
    let db: jest.Mocked<NodePgDatabase<any>>;
    let selectCalls = 0;

    const mockCustomersTable = {
        id: { name: "id" },
        name: { name: "name" },
        _def: { tableName: "customers" }
    };

    const mockUserProfilesTable = {
        id: { name: "id" },
        userId: { name: "user_id" },
        bio: { name: "bio" },
        _def: { tableName: "user_profiles" }
    };

    const customersCollection: CollectionConfig = {
        slug: "customers",
        name: "Customers",
        table: "customers",
        properties: {
            id: { type: "number" },
            name: { type: "string" }
        },
        idField: "id"
    };

    const userProfilesCollection: CollectionConfig = {
        slug: "user_profiles",
        name: "User Profiles",
        table: "user_profiles",
        properties: {
            id: { type: "number" },
            bio: { type: "string" },
            user: { type: "relation",
relationName: "user" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "user",
                target: () => customersCollection,
                localKey: "user_id"
            }
        ],
        idField: "id"
    };

    const makeProfiles = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: i + 1,
bio: `bio-${i + 1}`,
userId: 100 + i }));

    const makeCustomers = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: 100 + i,
name: `Customer ${100 + i}` }));

    /**
     * Stands in for postgres, counting round-trips. The owning-relation batch
     * loader issues `select({ parentId, fkValue }).from(parent)` followed by
     * `select().from(target)`, so rows are chosen by table plus projection.
     */
    const setupDb = (profiles: Record<string, unknown>[], customers: Record<string, unknown>[]) => {
        selectCalls = 0;
        let currentProjection: Record<string, unknown> | undefined;

        const rowsFor = (tableName?: string) => {
            if (tableName === "customers") return customers;
            if (currentProjection && "parentId" in currentProjection && "fkValue" in currentProjection) {
                return profiles.map(p => ({ parentId: p.id,
fkValue: p.userId }));
            }
            return profiles;
        };

        db = {
            select: jest.fn((projection?: Record<string, unknown>) => {
                selectCalls++;
                currentProjection = projection;
                return db;
            }),
            from: jest.fn((table: any) => {
                const rows = rowsFor(table?._def?.tableName);
                const chain: any = {
                    where: jest.fn(() => chain),
                    $dynamic: jest.fn(() => chain),
                    limit: jest.fn(() => chain),
                    offset: jest.fn(() => chain),
                    orderBy: jest.fn(() => chain),
                    innerJoin: jest.fn(() => chain),
                    then: (resolve: (rows: unknown) => void) => resolve(rows)
                };
                return chain;
            }),
            transaction: jest.fn((callback: any) => callback(db))
        } as any;

        dataService = new DataService(db, collectionRegistry);
    };

    beforeEach(() => {
        jest.clearAllMocks();

        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("customers")) return customersCollection;
            if (path.startsWith("user_profiles")) return userProfilesCollection;
            return undefined;
        });

        jest.spyOn(collectionRegistry, "getTable").mockImplementation(tableName => {
            if (tableName === "customers") return mockCustomersTable as any;
            if (tableName === "user_profiles") return mockUserProfilesTable as any;
            return undefined;
        });
    });

    it("embeds the related row when the read asks for it", async () => {
        setupDb(makeProfiles(3), makeCustomers(3));

        const rows = await dataService.fetchCollection("user_profiles", { include: ["*"] });

        // Plain columns under the relation key — the shape the REST list, the
        // SDK and the admin all already normalise to. It used to be a
        // `{ __type: "relation", id, path, data }` envelope that every consumer
        // then unwrapped.
        expect(rows[0].user).toMatchObject({ id: 100, name: "Customer 100" });
    });

    /**
     * The change that makes `listen()` and `find()` agree.
     *
     * This method is what the realtime refetch goes through, and it used to
     * load EVERY relation unconditionally while the REST list loaded none. Same
     * query, two row shapes — and a client rendering both saw the row change
     * shape the moment a write landed.
     */
    it("loads no relations when the read does not ask for any", async () => {
        setupDb(makeProfiles(3), makeCustomers(3));

        const rows = await dataService.fetchCollection("user_profiles", {});

        // The foreign key's own stub — `{ __type, id, path }`, which
        // `parseDataFromServer` derives from the column without querying — and
        // no related row embedded over it.
        expect(rows[0].user).toEqual({ __type: "relation", id: "100", path: "customers" });
        // One select: the base rows. No relation was loaded, so none was read.
        expect(selectCalls).toBe(1);
    });

    it("keeps the query count flat as the row count grows", async () => {
        setupDb(makeProfiles(3), makeCustomers(3));
        await dataService.fetchCollection("user_profiles", { include: ["*"] });
        const callsForThreeRows = selectCalls;

        setupDb(makeProfiles(30), makeCustomers(30));
        await dataService.fetchCollection("user_profiles", { include: ["*"] });

        // One base select plus a fixed pair per relation — never one per row.
        expect(callsForThreeRows).toBe(3);
        expect(selectCalls).toBe(callsForThreeRows);
    });
});
