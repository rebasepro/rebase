import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const collectionRegistry = new PostgresCollectionRegistry();

/**
 * A row is exactly its columns.
 *
 * The driver used to synthesize an `id` and write it into the row on the way
 * out. That renamed primary keys (a `sku` key was served as `id`, and `sku` did
 * not appear at all), restringified them (`42` → `"42"`), and — where a plain
 * column happened to be called `id` — overwrote real data. None of it was
 * covered: every one of these passes against the old code except by asserting
 * the thing it got wrong.
 *
 * The address is not data. It is derived by the consumer from the collection's
 * primary keys (see `rowToEntity`), and must not appear here.
 */
describe("DataService - rows carry columns, not addresses", () => {
    let dataService: DataService;
    let db: jest.Mocked<NodePgDatabase<any>>;

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const mockProducts = table("products", ["id", "name", "price"]);
    const mockSkuItems = table("sku_items", ["sku", "label"]);
    const mockMemberships = table("memberships", ["tenant_id", "user_id", "role"]);
    const mockEvents = table("events", ["event_id", "id", "name"]);

    const productsCollection: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" },
            price: { type: "number" }
        },
        idField: "id"
    };

    const skuItemsCollection: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        },
        idField: "sku"
    };

    const membershipsCollection: CollectionConfig = {
        slug: "memberships",
        name: "Memberships",
        table: "memberships",
        properties: {
            tenant_id: { type: "number",
isId: true },
            user_id: { type: "number",
isId: true },
            role: { type: "string" }
        }
    };

    // `event_id` is the key; `id` is an ordinary column that happens to share
    // the name the address used to be written under.
    const eventsCollection: CollectionConfig = {
        slug: "events",
        name: "Events",
        table: "events",
        properties: {
            event_id: { type: "number",
isId: true },
            id: { type: "string" },
            name: { type: "string" }
        },
        idField: "event_id"
    };

    const setupDb = (rows: Record<string, unknown>[]) => {
        db = {
            select: jest.fn(() => db),
            from: jest.fn(() => {
                const chain: any = {
                    where: jest.fn(() => chain),
                    $dynamic: jest.fn(() => chain),
                    limit: jest.fn(() => chain),
                    offset: jest.fn(() => chain),
                    orderBy: jest.fn(() => chain),
                    innerJoin: jest.fn(() => chain),
                    then: (resolve: (r: unknown) => void) => resolve(rows)
                };
                return chain;
            }),
            transaction: jest.fn((cb: any) => cb(db))
        } as any;
        dataService = new DataService(db, collectionRegistry);
    };

    beforeEach(() => {
        jest.clearAllMocks();

        jest.spyOn(collectionRegistry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("products")) return productsCollection;
            if (path.startsWith("sku_items")) return skuItemsCollection;
            if (path.startsWith("memberships")) return membershipsCollection;
            if (path.startsWith("events")) return eventsCollection;
            return undefined;
        });

        jest.spyOn(collectionRegistry, "getTable").mockImplementation(name => {
            if (name === "products") return mockProducts as any;
            if (name === "sku_items") return mockSkuItems as any;
            if (name === "memberships") return mockMemberships as any;
            if (name === "events") return mockEvents as any;
            return undefined;
        });
    });

    it("keeps a numeric primary key a number", async () => {
        // The address is a string by construction; writing it into the row
        // handed the SDK `id: "42"` for an integer column.
        setupDb([{ id: 42,
name: "Camera",
price: 299 }]);

        const rows = await dataService.fetchCollection("products", {});

        expect(rows[0].id).toBe(42);
        expect(typeof rows[0].id).toBe("number");
    });

    it("serves a `sku` primary key as `sku`, and invents no `id`", async () => {
        // This row used to come back as { id: "ABC-1", label } — the key column
        // renamed, and the name the developer chose gone from their own API.
        setupDb([{ sku: "ABC-1",
label: "Widget" }]);

        const rows = await dataService.fetchCollection("sku_items", {});

        expect(rows[0]).toEqual({ sku: "ABC-1",
label: "Widget" });
        expect(rows[0]).not.toHaveProperty("id");
    });

    it("serves both columns of a composite key, and no joined token", async () => {
        setupDb([{ tenant_id: 1,
user_id: 2,
role: "admin" }]);

        const rows = await dataService.fetchCollection("memberships", {});

        expect(rows[0]).toEqual({ tenant_id: 1,
user_id: 2,
role: "admin" });
        expect(JSON.stringify(rows[0])).not.toContain(":::");
    });

    it("does not overwrite an ordinary column named `id`", async () => {
        // The old code spread the synthesized address last, explicitly so it
        // "wins over a raw `id` column" — silently destroying the column's real
        // value for any table with a non-key column called `id`.
        setupDb([{ event_id: 7,
id: "external-ref-99",
name: "Launch" }]);

        const rows = await dataService.fetchCollection("events", {});

        expect(rows[0].id).toBe("external-ref-99");
        expect(rows[0].event_id).toBe(7);
    });
});
