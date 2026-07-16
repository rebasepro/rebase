import { CollectionConfig } from "@rebasepro/types";
import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { buildCollectionRegistry } from "../src/collections/buildRegistry";

/**
 * Building the registry is an ordering problem, which is why it is one function.
 *
 * Keys are resolved from the drizzle schema, so anything that reads them has to
 * run after the tables are registered. `warnOnKeysTheAdminCannotResolve` is the
 * one that does, and it fails *open*: a collection whose table it cannot look
 * up is one it skips, because a collection on another engine legitimately has
 * none. Run before the tables land, it skips everything and reports nothing —
 * which is indistinguishable from a clean bill of health.
 */
describe("buildCollectionRegistry", () => {
    // `sku` is the key in the schema; the collection config never says so, and
    // the admin cannot see the schema — exactly what the warning is for.
    const skuItems = pgTable("sku_items", {
        sku: text("sku").primaryKey(),
        label: text("label")
    });

    const products = pgTable("products", {
        id: serial("id").primaryKey(),
        name: text("name")
    });

    const skuItemsCollection: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string" },
            label: { type: "string" }
        }
    };

    const productsCollection: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            id: { type: "number" },
            name: { type: "string" }
        }
    };

    let warn: jest.SpyInstance;

    beforeEach(() => {
        jest.restoreAllMocks();
        warn = jest.spyOn(require("@rebasepro/server").logger, "warn").mockImplementation(() => undefined);
        jest.spyOn(require("@rebasepro/server").logger, "info").mockImplementation(() => undefined);
    });

    it("registers the collections and their tables", () => {
        const registry = buildCollectionRegistry({
            collections: [skuItemsCollection, productsCollection],
            tables: { skuItems,
products }
        });

        expect(registry.getCollections().map(c => c.slug).sort()).toEqual(["products", "sku_items"]);
        expect(registry.getTable("sku_items")).toBeDefined();
        expect(registry.getTable("products")).toBeDefined();
    });

    it("warns about a key the admin cannot resolve — which needs the tables to be in first", () => {
        buildCollectionRegistry({
            collections: [skuItemsCollection],
            tables: { skuItems }
        });

        // If this ran before `registerTable`, the key would be unresolvable, the
        // collection skipped, and this warning silently absent.
        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain("sku_items");
        expect(message).toContain("`sku`");
    });

    it("says nothing about a collection whose key resolves on both sides", () => {
        buildCollectionRegistry({
            collections: [productsCollection],
            tables: { products }
        });

        expect(warn).not.toHaveBeenCalled();
    });

    it("says nothing when there is no schema to resolve keys from", () => {
        // A driver configured with collections but no tables cannot resolve any
        // key, and has nothing to report rather than everything.
        buildCollectionRegistry({ collections: [skuItemsCollection] });

        expect(warn).not.toHaveBeenCalled();
    });

    it("ignores non-table values in the schema object", () => {
        // The generated schema module exports relations and enums alongside the
        // tables; only the tables are registered.
        const registry = buildCollectionRegistry({
            collections: [productsCollection],
            tables: { products,
notATable: { some: "export" },
alsoNot: 42 } as Record<string, unknown>
        });

        expect(registry.getTableNames()).toEqual(["products"]);
    });
});
