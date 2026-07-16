import { CollectionConfig } from "@rebasepro/types";
import { Table } from "drizzle-orm";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * joinPath relations over REST, for tables Drizzle's `with` cannot express.
 *
 * The parent ids used to be recovered by parsing the row's synthesized `id`
 * back into key columns. Rows do not carry one any more, so `String(row.id)`
 * became `"undefined"`: `parseIdValues` threw (a composite key on parts
 * mismatch, a numeric key on NaN) straight into the per-relation catch, which
 * logs a warning and moves on. The response still returned 200 — with the
 * relations silently missing.
 *
 * The key columns are right there on the row, so they are read directly.
 */
describe("REST joinPath relations — parent ids come from the row's key columns", () => {
    const registry = new PostgresCollectionRegistry();

    // Drizzle names a table by symbol, and `fetchCollectionForRest` reads it to
    // find the query builder — a table without one silently falls back to the
    // raw select path, which is not the path under test.
    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { [Table.Symbol.Name]: name };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const warehousesCollection: CollectionConfig = {
        slug: "warehouses",
        name: "Warehouses",
        table: "warehouses",
        properties: {
            id: { type: "string",
isId: true },
            city: { type: "string" }
        },
        idField: "id"
    };

    // Key is `sku`, not `id` — the case the old parse could not survive.
    const skuItemsCollection: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" },
            warehouse: { type: "relation",
relationName: "warehouse" },
            all_warehouses: { type: "relation",
relationName: "all_warehouses" }
        },
        relations: [
            {
                relationName: "warehouse",
                target: () => warehousesCollection,
                cardinality: "one",
                direction: "inverse",
                joinPath: [
                    { table: "stock",
sourceColumn: "sku",
targetColumn: "warehouse_id" },
                    { table: "warehouses",
sourceColumn: "warehouse_id",
targetColumn: "id" }
                ]
            },
            {
                relationName: "all_warehouses",
                target: () => warehousesCollection,
                cardinality: "many",
                direction: "inverse",
                joinPath: [
                    { table: "stock",
sourceColumn: "sku",
targetColumn: "warehouse_id" },
                    { table: "warehouses",
sourceColumn: "warehouse_id",
targetColumn: "id" }
                ]
            }
        ],
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
            warehouse: { type: "relation",
relationName: "warehouse" }
        },
        relations: [
            {
                relationName: "warehouse",
                target: () => warehousesCollection,
                cardinality: "one",
                direction: "inverse",
                joinPath: [
                    { table: "stock",
sourceColumn: "tenant_id",
targetColumn: "warehouse_id" },
                    { table: "warehouses",
sourceColumn: "warehouse_id",
targetColumn: "id" }
                ]
            }
        ]
    };

    let fetchService: FetchService;
    let batchFetch: jest.Mock;
    let batchFetchMany: jest.Mock;

    /** A FetchService whose query builder returns `rows` verbatim. */
    const setup = (rows: Record<string, unknown>[]) => {
        const db = {
            query: {
                sku_items: { findMany: jest.fn().mockResolvedValue(rows) },
                memberships: { findMany: jest.fn().mockResolvedValue(rows) }
            }
        };
        fetchService = new FetchService(db as any, registry);

        batchFetch = jest.fn().mockResolvedValue(new Map());
        jest.spyOn(fetchService.getRelationService(), "batchFetchRelatedEntities")
            .mockImplementation(batchFetch);
        batchFetchMany = jest.fn().mockResolvedValue(new Map());
        jest.spyOn(fetchService.getRelationService(), "batchFetchRelatedEntitiesMany")
            .mockImplementation(batchFetchMany);
        return fetchService;
    };

    beforeEach(() => {
        jest.restoreAllMocks();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path.startsWith("sku_items")) return skuItemsCollection;
            if (path.startsWith("memberships")) return membershipsCollection;
            if (path.startsWith("warehouses")) return warehousesCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "sku_items") return table("sku_items", ["sku", "label"]) as any;
            if (name === "memberships") return table("memberships", ["tenant_id", "user_id"]) as any;
            if (name === "warehouses") return table("warehouses", ["id", "city"]) as any;
            return undefined;
        });
    });

    it("passes a `sku` key to the batch fetch instead of dropping the relation", async () => {
        setup([{ sku: "ABC-1",
label: "Widget" }, { sku: "ABC-2",
label: "Gadget" }]);

        await fetchService.fetchCollectionForRest("sku_items", {}, ["warehouse"]);

        expect(batchFetch).toHaveBeenCalledWith(
            "sku_items", ["ABC-1", "ABC-2"], "warehouse", expect.anything()
        );
    });

    it("populates the relation from the batch result", async () => {
        setup([{ sku: "ABC-1",
label: "Widget" }]);
        batchFetch.mockResolvedValue(new Map([
            ["ABC-1", { id: "W1",
path: "warehouses",
values: { id: "W1",
city: "Berlin" } }]
        ]));

        const rows = await fetchService.fetchCollectionForRest("sku_items", {}, ["warehouse"]);

        expect(rows[0].warehouse).toEqual({ id: "W1",
city: "Berlin" });
    });

    it("embeds the target's columns without re-merging a synthesized address", async () => {
        // The target's key is `id` here, so a merged address would be invisible
        // unless it disagrees with the column — which it does: it is a string.
        setup([{ sku: "ABC-1",
label: "Widget" }]);
        batchFetch.mockResolvedValue(new Map([
            ["ABC-1", { id: "77",
path: "warehouses",
values: { id: 77,
city: "Berlin" } }]
        ]));

        const rows = await fetchService.fetchCollectionForRest("sku_items", {}, ["warehouse"]);

        expect((rows[0].warehouse as Record<string, unknown>).id).toBe(77);
    });

    it("addresses a composite-keyed parent by its whole key", async () => {
        // Not `[1]` — the first column alone names every membership of tenant 1,
        // so two of them would each be handed the other's relations. The batch
        // groups its results by this same derived token.
        setup([{ tenant_id: 1,
user_id: 2 }]);

        const rows = await fetchService.fetchCollectionForRest("memberships", {}, ["warehouse"]);

        expect(batchFetch).toHaveBeenCalledWith(
            "memberships", ["1:::2"], "warehouse", expect.anything()
        );
        expect(rows[0]).toMatchObject({ tenant_id: 1,
user_id: 2 });
    });

    it("populates a many relation the same way, columns only", async () => {
        setup([{ sku: "ABC-1",
label: "Widget" }]);
        batchFetchMany.mockResolvedValue(new Map([
            ["ABC-1", [
                { id: "77",
path: "warehouses",
values: { id: 77,
city: "Berlin" } },
                { id: "78",
path: "warehouses",
values: { id: 78,
city: "Paris" } }
            ]]
        ]));

        const rows = await fetchService.fetchCollectionForRest("sku_items", {}, ["all_warehouses"]);

        expect(batchFetchMany).toHaveBeenCalledWith(
            "sku_items", ["ABC-1"], "all_warehouses", expect.anything()
        );
        // The embedded rows carry the target's own columns — `id` here is the
        // integer column, not a re-merged string address.
        expect(rows[0].all_warehouses).toEqual([
            { id: 77,
city: "Berlin" },
            { id: 78,
city: "Paris" }
        ]);
    });

    it("skips rows whose key column is absent rather than addressing `undefined`", async () => {
        setup([{ label: "Keyless" }]);

        const rows = await fetchService.fetchCollectionForRest("sku_items", {}, ["warehouse"]);

        expect(batchFetch).not.toHaveBeenCalled();
        expect(rows[0]).toEqual({ label: "Keyless" });
    });
});
