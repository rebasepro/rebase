import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CollectionConfig } from "@rebasepro/types";
import { DataService } from "../src/services/dataService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A re-runnable import writes its rows with `status: "new"` plus `upsert` — the
 * right choice, because an import's rows carry a natural key for rows that may
 * not exist yet. But `status: "new"` also computes the `on_create` timestamp for
 * every row, and the conflict-update branch then wrote it over the value the
 * existing row already had. A nightly `POST /products/bulk {upsert: true}` reset
 * `createdAt` on every product it touched, and nothing in the response said so.
 */
describe("upsert and on_create timestamps", () => {
    const registry = new PostgresCollectionRegistry();

    const mockProductsTable = {
        sku: { name: "sku" },
        title: { name: "title" },
        createdAt: { name: "created_at" },
        updatedAt: { name: "updated_at" },
        _def: { tableName: "products" }
    };

    const products: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            sku: { type: "string",
isId: true },
            title: { type: "string" },
            createdAt: { type: "date",
autoValue: "on_create" },
            updatedAt: { type: "date",
autoValue: "on_update" }
        }
    };

    let db: jest.Mocked<NodePgDatabase>;
    let onConflictDoUpdate: jest.Mock;
    let dataService: DataService;

    beforeEach(() => {
        jest.spyOn(registry, "getCollectionByPath").mockReturnValue(products);
        jest.spyOn(registry, "getCollections").mockReturnValue([products]);
        jest.spyOn(registry, "getTable").mockReturnValue(
            mockProductsTable as unknown as ReturnType<typeof registry.getTable>
        );

        onConflictDoUpdate = jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ sku: "SKU-1" }])
        });

        db = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            $dynamic: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ sku: "SKU-1",
title: "Widget" }]),
            orderBy: jest.fn().mockResolvedValue([]),
            insert: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnValue({
                onConflictDoUpdate,
                onConflictDoNothing: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([{ sku: "SKU-1" }])
                }),
                returning: jest.fn().mockResolvedValue([{ sku: "SKU-1" }])
            }),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            rowCount: 1,
            transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db))
        } as unknown as jest.Mocked<NodePgDatabase>;

        dataService = new DataService(db, registry);
    });

    afterEach(() => jest.restoreAllMocks());

    const upsert = () => dataService.save(
        "products",
        {
            sku: "SKU-1",
            title: "Widget",
            createdAt: "2026-08-08T10:00:00.000Z",
            updatedAt: "2026-08-08T10:00:00.000Z"
        },
        "SKU-1",
        undefined,
        { upsert: true }
    );

    it("does not re-stamp createdAt on a row that already existed", async () => {
        await upsert();
        const { set } = onConflictDoUpdate.mock.calls[0][0];
        expect(set).not.toHaveProperty("createdAt");
    });

    it("still updates the on_update stamp and the ordinary columns", async () => {
        await upsert();
        const { set } = onConflictDoUpdate.mock.calls[0][0];
        expect(set.updatedAt).toBe("2026-08-08T10:00:00.000Z");
        expect(set.title).toBe("Widget");
    });

    it("still writes createdAt in the INSERT branch, where the row is new", async () => {
        await upsert();
        const inserted = (db.insert as jest.Mock).mock.results[0].value.values.mock.calls[0][0];
        expect(inserted.createdAt).toBe("2026-08-08T10:00:00.000Z");
    });

    it("never reassigns the key column against the conflict target", async () => {
        await upsert();
        const { set } = onConflictDoUpdate.mock.calls[0][0];
        expect(set).not.toHaveProperty("sku");
    });
});
