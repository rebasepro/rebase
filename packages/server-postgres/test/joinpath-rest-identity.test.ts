import { CollectionConfig } from "@rebasepro/types";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { FetchService } from "../src/services/FetchService";
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { arrayRowsFor, recordingDb } from "./helpers/spg-b-recording-db";

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

    registry.registerTable(pgTable("sku_items", { sku: text("sku").primaryKey(), label: text("label") }), "sku_items");
    registry.registerTable(pgTable("memberships", { tenant_id: integer("tenant_id"), user_id: integer("user_id") }), "memberships");
    registry.registerTable(pgTable("warehouses", { id: integer("id").primaryKey(), city: text("city") }), "warehouses");

    const warehousesCollection: CollectionConfig = {
        slug: "warehouses",
        name: "Warehouses",
        table: "warehouses",
        properties: {
            id: { type: "string",
isId: true },
            city: { type: "string" }
        }
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
            warehouse: { type: "relation" },
            all_warehouses: { type: "relation" }
        },
        relations: [
            {
                kind: "via",
                relationName: "warehouse",
                target: () => warehousesCollection,
                cardinality: "one",
                joinPath: [
                    { table: "stock", on: { from: "sku", to: "sku" } },
                    { table: "warehouses", on: { from: "warehouse_id", to: "id" } }
                ]
            },
            {
                kind: "via",
                relationName: "all_warehouses",
                target: () => warehousesCollection,
                cardinality: "many",
                joinPath: [
                    { table: "stock", on: { from: "sku", to: "sku" } },
                    { table: "warehouses", on: { from: "warehouse_id", to: "id" } }
                ]
            }
        ]
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
            warehouse: { type: "relation" }
        },
        relations: [
            {
                kind: "via",
                relationName: "warehouse",
                target: () => warehousesCollection,
                cardinality: "one",
                joinPath: [
                    { table: "stock", on: { from: "tenant_id", to: "tenant_id" } },
                    { table: "warehouses", on: { from: "warehouse_id", to: "id" } }
                ]
            }
        ]
    };

    let fetchService: FetchService;
    const spyBatch = () => jest.spyOn(RelationService.prototype, "batchFetchRelatedEntities").mockResolvedValue(new Map());
    const spyBatchMany = () => jest.spyOn(RelationService.prototype, "batchFetchRelatedEntitiesMany").mockResolvedValue(new Map());
    let batchFetch: ReturnType<typeof spyBatch>;
    let batchFetchMany: ReturnType<typeof spyBatchMany>;

    /**
     * A FetchService whose base select returns `rows`, with the relation batch
     * loaders stubbed.
     *
     * `db.query` — Drizzle's relational API — is gone from every read path: it
     * compiles a to-many relation into a lateral join, and the batched loader
     * these tests stub replaced it. So the base rows come from a plain select
     * and the relations from the batch, which is the whole shape under test.
     */
    const setup = (rows: Record<string, unknown>[]) => {
        const { db } = recordingDb(({ text: sqlText }) => (/^\s*select\b/i.test(sqlText) ? arrayRowsFor(sqlText, rows) : []));
        fetchService = new FetchService(db, registry);
        batchFetch = spyBatch();
        batchFetchMany = spyBatchMany();
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
    });

    it("passes a `sku` key to the batch fetch instead of dropping the relation", async () => {
        setup([{ sku: "ABC-1",
label: "Widget" }, { sku: "ABC-2",
label: "Gadget" }]);

        await fetchService.fetchCollectionForRest("sku_items", {}, ["warehouse"]);

        expect(batchFetch).toHaveBeenCalledWith(
            "sku_items", ["ABC-1", "ABC-2"], "warehouse", expect.anything(), undefined,
            expect.objectContaining({ style: "rest" })
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

        expect(rows[0].warehouse).toMatchObject({ id: 77 });
    });

    it("addresses a composite-keyed parent by its whole key", async () => {
        // Not `[1]` — the first column alone names every membership of tenant 1,
        // so two of them would each be handed the other's relations. The batch
        // groups its results by this same derived token.
        setup([{ tenant_id: 1,
user_id: 2 }]);

        const rows = await fetchService.fetchCollectionForRest("memberships", {}, ["warehouse"]);

        expect(batchFetch).toHaveBeenCalledWith(
            "memberships", ["1:::2"], "warehouse", expect.anything(), undefined,
            expect.objectContaining({ style: "rest" })
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

        // No `where`, no per-parent order or limit to push into the read, and
        // the target rendered as its own REST route renders it.
        expect(batchFetchMany).toHaveBeenCalledWith(
            "sku_items", ["ABC-1"], "all_warehouses", expect.anything(), undefined, undefined,
            expect.objectContaining({ style: "rest" })
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
        setup([{ sku: null, label: "Keyless" }]);

        const rows = await fetchService.fetchCollectionForRest("sku_items", {}, ["warehouse"]);

        expect(batchFetch).not.toHaveBeenCalled();
        expect(rows[0]).toEqual({ sku: null, label: "Keyless" });
    });
});
