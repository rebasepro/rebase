import { CollectionConfig } from "@rebasepro/types";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";

/**
 * A save names the row it saved — by deriving the address, not reading it.
 *
 * `PersistService` returns the re-fetched row, which is exactly its columns.
 * The driver used to read `savedRow.id` off it, which is `undefined` for every
 * table whose key is not literally named `id`. That reached `savedId.toString()`
 * in the realtime notify — unconditional, and *after* the transaction had
 * committed — so the write landed and the request 500'd. `afterSave` saw
 * `id: undefined` on the way there, and history recorded the same.
 *
 * These fail against the pre-fix driver: the first two throw, and the third
 * catches an `id` column being stripped out of the values callbacks receive.
 */
describe("PostgresBackendDriver.save — the address is derived", () => {
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const productsCollection: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" }
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

    let driver: PostgresBackendDriver;
    let realtimeService: { notifyUpdate: jest.Mock };
    let historyService: { recordHistory: jest.Mock };

    /** Stand the driver up over a `dataService.save` that returns `savedRow`. */
    const setup = (savedRow: Record<string, unknown>) => {
        realtimeService = { notifyUpdate: jest.fn().mockResolvedValue(undefined) };
        historyService = { recordHistory: jest.fn() };

        driver = new PostgresBackendDriver(
            {} as any,
            realtimeService as unknown as RealtimeService,
            registry,
            undefined,
            undefined,
            historyService as unknown as HistoryService
        );

        jest.spyOn(driver.dataService, "save").mockResolvedValue(savedRow as any);
        return driver;
    };

    beforeEach(() => {
        jest.restoreAllMocks();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("products")) return productsCollection;
            if (path.startsWith("sku_items")) return skuItemsCollection;
            if (path.startsWith("memberships")) return membershipsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "products") return table("products", ["id", "name"]) as any;
            if (name === "sku_items") return table("sku_items", ["sku", "label"]) as any;
            if (name === "memberships") return table("memberships", ["tenant_id", "user_id", "role"]) as any;
            return undefined;
        });
        jest.spyOn(registry, "getGlobalCallbacks").mockReturnValue(undefined as any);
    });

    it("notifies subscribers with a `sku` key's address instead of throwing", async () => {
        setup({ sku: "ABC-1",
label: "Widget" });

        const saved = await driver.save({
            path: "sku_items",
            values: { label: "Widget" },
            collection: skuItemsCollection,
            status: "new"
        });

        expect(saved).toEqual({ sku: "ABC-1",
label: "Widget" });
        expect(realtimeService.notifyUpdate).toHaveBeenCalledWith(
            "sku_items", "ABC-1", { sku: "ABC-1",
label: "Widget" }, undefined
        );
    });

    it("joins a composite key into one address for the notification", async () => {
        setup({ tenant_id: 1,
user_id: 2,
role: "admin" });

        await driver.save({
            path: "memberships",
            values: { role: "admin" },
            collection: membershipsCollection,
            status: "new"
        });

        expect(realtimeService.notifyUpdate).toHaveBeenCalledWith(
            "memberships", "1:::2", expect.anything(), undefined
        );
    });

    it("hands afterSave the address and the row's own columns", async () => {
        const afterSave = jest.fn();
        setup({ sku: "ABC-1",
label: "Widget" });

        await driver.save({
            path: "sku_items",
            values: { label: "Widget" },
            collection: { ...skuItemsCollection,
callbacks: { afterSave } } as CollectionConfig,
            status: "new"
        });

        expect(afterSave).toHaveBeenCalledWith(expect.objectContaining({
            id: "ABC-1",
            values: { sku: "ABC-1",
label: "Widget" },
            status: "new"
        }));
    });

    it("keeps the `id` column in the values it hands callbacks", async () => {
        // `id` was destructured out of `values` back when it was the synthesized
        // address. It is a column now, and stripping it hid real data from every
        // callback and from row history.
        const afterSave = jest.fn();
        setup({ id: 42,
name: "Camera" });

        await driver.save({
            path: "products",
            values: { name: "Camera" },
            collection: { ...productsCollection,
callbacks: { afterSave } } as CollectionConfig,
            status: "new"
        });

        expect(afterSave).toHaveBeenCalledWith(expect.objectContaining({
            id: "42",
            values: { id: 42,
name: "Camera" }
        }));
    });

    it("records history under the derived address", async () => {
        setup({ sku: "ABC-1",
label: "Widget" });

        await driver.save({
            path: "sku_items",
            values: { label: "Widget" },
            collection: { ...skuItemsCollection,
history: true } as CollectionConfig,
            status: "new"
        });

        expect(historyService.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
            tableName: "sku_items",
            id: "ABC-1",
            action: "create"
        }));
    });

    it("defers the notification with an address, not undefined", async () => {
        setup({ sku: "ABC-1",
label: "Widget" });
        (driver as unknown as { _deferNotifications: boolean })._deferNotifications = true;

        await driver.save({
            path: "sku_items",
            values: { label: "Widget" },
            collection: skuItemsCollection,
            status: "new"
        });

        const pending = (driver as unknown as {
            _pendingNotifications: { id: string }[]
        })._pendingNotifications;
        expect(realtimeService.notifyUpdate).not.toHaveBeenCalled();
        expect(pending).toHaveLength(1);
        expect(pending[0].id).toBe("ABC-1");
    });

    it("hands delete callbacks the row's columns, without inventing an `id`", async () => {
        // The address arrives beside the row as `id`; merging it into the row
        // fabricated an `id` field for tables that have no such column.
        const beforeDelete = jest.fn();
        setup({});
        jest.spyOn(driver.dataService, "delete").mockResolvedValue(undefined as never);

        await driver.delete({
            row: { id: "ABC-1",
path: "sku_items",
values: { sku: "ABC-1",
label: "Widget" } },
            collection: { ...skuItemsCollection,
callbacks: { beforeDelete } } as CollectionConfig
        });

        expect(beforeDelete).toHaveBeenCalledWith(expect.objectContaining({
            id: "ABC-1",
            row: { sku: "ABC-1",
label: "Widget" }
        }));
        expect(realtimeService.notifyUpdate).toHaveBeenCalledWith(
            "sku_items", "ABC-1", null, undefined
        );
    });
});
