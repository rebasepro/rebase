import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry, tablesFromCollections } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";
import { unusedDb } from "./helpers/spg-c-db";
import { textTable } from "./helpers/spg-c-tables";

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
    const registry = new FixtureTableRegistry();


    const productsCollection: LegacyCollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" }
        }
    };

    const skuItemsCollection: LegacyCollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        }
    };

    const membershipsCollection: LegacyCollectionConfig = {
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
    let realtimeService: RealtimeService;
    let historyService: HistoryService;

    /** Stand the driver up over a `dataService.save` that returns `savedRow`. */
    const setup = (savedRow: Record<string, unknown>) => {
        const db = unusedDb();
        realtimeService = new RealtimeService(db, registry);
        jest.spyOn(realtimeService, "notifyUpdate").mockResolvedValue(undefined);
        historyService = new HistoryService(db);
        jest.spyOn(historyService, "recordHistory").mockResolvedValue(undefined);
        jest.spyOn(historyService, "assertRecordable").mockImplementation(() => undefined);

        driver = new PostgresBackendDriver(db, realtimeService, registry, undefined, undefined, historyService);

        jest.spyOn(driver.dataService, "save").mockResolvedValue(savedRow);
        return driver;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        // Hooks are the table's, read from the registry; none unless a test attaches them.
        for (const slug of ["products", "sku_items", "memberships"]) registry.setTableHooks(slug, {});

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("products")) return productsCollection;
            if (path.startsWith("sku_items")) return skuItemsCollection;
            if (path.startsWith("memberships")) return membershipsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getPgTable").mockImplementation(name => {
            if (name === "products") return textTable("products", ["id", "name"]);
            if (name === "sku_items") return textTable("sku_items", ["sku", "label"]);
            if (name === "memberships") return textTable("memberships", ["tenant_id", "user_id", "role"]);
            return undefined;
        });
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

        registry.setTableHooks("sku_items", { afterSave });
        await driver.save({
            path: "sku_items",
            values: { label: "Widget" },
            collection: skuItemsCollection,
            status: "new"
        });

        expect(afterSave).toHaveBeenCalledWith(expect.objectContaining({
            id: "ABC-1",
            values: { sku: "ABC-1",
label: "Widget" },
            status: "new"
        }));
    });

    it("keeps the `id` column in the values it hands hooks", async () => {
        // `id` was destructured out of `values` back when it was the synthesized
        // address. It is a column now, and stripping it hid real data from every
        // hook and from row history.
        const afterSave = jest.fn();
        setup({ id: 42,
name: "Camera" });

        registry.setTableHooks("products", { afterSave });
        await driver.save({
            path: "products",
            values: { name: "Camera" },
            collection: productsCollection,
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

        // History is the table's to declare (`history: true`), never the
        // caller's: a table of its own, over the same SQL table.
        registry.registerTables(tablesFromCollections([{ ...skuItemsCollection, slug: "audited_sku_items", history: true }]).tables);
        await driver.save({
            path: "audited_sku_items",
            values: { label: "Widget" },
            status: "new"
        });

        expect(historyService.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
            tableName: "audited_sku_items",
            id: "ABC-1",
            action: "create"
        }));
    });

    it("defers the notification with an address, not undefined", async () => {
        setup({ sku: "ABC-1",
label: "Widget" });
        driver._deferNotifications = true;

        await driver.save({
            path: "sku_items",
            values: { label: "Widget" },
            collection: skuItemsCollection,
            status: "new"
        });

        const pending = driver._pendingNotifications;
        expect(realtimeService.notifyUpdate).not.toHaveBeenCalled();
        expect(pending).toHaveLength(1);
        expect(pending[0].id).toBe("ABC-1");
    });

    it("hands delete hooks the row's columns, without inventing an `id`", async () => {
        // The address arrives beside the row as `id`; merging it into the row
        // fabricated an `id` field for tables that have no such column.
        const beforeDelete = jest.fn();
        setup({});
        // The stored row, read as REST serves it: a `sku`-keyed table, so no `id` column.
        jest.spyOn(driver.dataService, "fetchOneForRest").mockResolvedValue({ sku: "ABC-1", label: "Widget" });
        jest.spyOn(driver.dataService, "delete").mockResolvedValue(undefined);

        registry.setTableHooks("sku_items", { beforeDelete });
        await driver.delete({
            row: { id: "ABC-1", path: "sku_items" },
            collection: skuItemsCollection
        });

        expect(beforeDelete).toHaveBeenCalledWith(expect.objectContaining({
            id: "ABC-1",
            values: { sku: "ABC-1",
label: "Widget" }
        }));
        expect(realtimeService.notifyUpdate).toHaveBeenCalledWith(
            "sku_items", "ABC-1", null, undefined
        );
    });
});
