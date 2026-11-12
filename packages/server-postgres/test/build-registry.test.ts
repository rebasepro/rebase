import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema, lowerTables } from "@rebasepro/common";
import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { buildTableRegistry } from "../src/model/build-registry";

/**
 * Building a driver's registry: one entry per table, carrying the compiled
 * table (as a runtime table over its catalogue table) and the collection it
 * was lowered into. An entry with one half and not the other is refused at
 * build time — the half a reader would miss is exactly where a fallback would
 * otherwise answer.
 *
 * (The boot warning about keys "the admin cannot resolve" is gone: the admin
 * no longer compiles collection files, it reads the served descriptors, which
 * always state the key.)
 */
describe("buildTableRegistry", () => {
    const skuItems = defineTable("sku_items", {
        columns: { sku: col.text().primaryKey(), label: col.text() },
        rls: "admin-only"
    });
    const products = defineTable("products", {
        columns: { id: col.serial().primaryKey(), name: col.text(), skuRef: col.text().column("sku_ref") },
        relations: { sku: rel.belongsTo(() => skuItems, { localKey: "sku_ref" }) },
        rls: "admin-only"
    });
    const compiled = compileSchema([skuItems, products]);
    const collections = lowerTables([skuItems, products]);

    const skuItemsTable = pgTable("sku_items", { sku: text("sku").primaryKey(), label: text("label") });
    const productsTable = pgTable("products", { id: serial("id").primaryKey(), name: text("name"), skuRef: text("sku_ref") });

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(require("@rebasepro/server").logger, "warn").mockImplementation(() => undefined);
        jest.spyOn(require("@rebasepro/server").logger, "info").mockImplementation(() => undefined);
    });

    it("registers each table's runtime table over its catalogue table, beside its collection", () => {
        const registry = buildTableRegistry({
            compiledTables: compiled,
            collections,
            tables: { skuItems: skuItemsTable, products: productsTable }
        });

        expect(registry.getCollections().map(c => c.slug).sort()).toEqual(["products", "sku_items"]);
        expect(registry.tables().map(t => t.slug)).toEqual(["sku_items", "products"]);
        expect(registry.getTable("products")?.pg).toBe(productsTable);
        expect(registry.getTable("products")?.descriptor).toBe(compiled[1].descriptor);
        expect(registry.getTableBySqlName("sku_items")?.slug).toBe("sku_items");
        expect(registry.getPgTable("products")).toBe(productsTable);
    });

    it("builds the lookups once: columns both ways, relations by name with their target slug, keys", () => {
        const registry = buildTableRegistry({ compiledTables: compiled, collections, tables: { products: productsTable, skuItems: skuItemsTable } });
        const table = registry.requireTable("products");
        expect(table.columnsByKey.get("skuRef")?.column).toBe("sku_ref");
        expect(table.columnsBySqlName.get("sku_ref")?.key).toBe("skuRef");
        expect(table.relations.get("sku")?.target).toBe("sku_items");
        expect(table.keys.map(key => [key.key, key.identity])).toEqual([["id", "serial"]]);
    });

    it("leaves pg undefined for a table this database does not hold", () => {
        const registry = buildTableRegistry({ compiledTables: compiled, collections, tables: { skuItems: skuItemsTable } });
        expect(registry.requireTable("products").pg).toBeUndefined();
        expect(registry.requireTable("sku_items").pg).toBe(skuItemsTable);
    });

    it("refuses collections handed over without their compiled tables, naming them", () => {
        expect(() => buildTableRegistry({ collections }))
            .toThrow(/no compiled table for: sku_items, products/);
    });

    it("refuses compiled tables handed over without their collections, naming them", () => {
        expect(() => buildTableRegistry({ compiledTables: compiled, collections: [collections[0]] }))
            .toThrow(/no lowered collection for: products/);
    });

    it("ignores non-table values in the schema object", () => {
        const registry = buildTableRegistry({
            compiledTables: compiled,
            collections,
            tables: { products: productsTable, skuItems: skuItemsTable, notATable: { some: "export" }, alsoNot: 42 }
        });
        expect(registry.getPgTableNames().sort()).toEqual(["products", "sku_items"]);
    });

    it("refuses to build when a relation names a column the database does not have", () => {
        const stale = pgTable("products", { id: serial("id").primaryKey(), name: text("name"), sku: integer("sku") });
        expect(() => buildTableRegistry({ compiledTables: compiled, collections, tables: { products: stale, skuItems: skuItemsTable } }))
            .toThrow(/products\.sku \(belongsTo\)[\s\S]*`localKey: "sku_ref"` is not a column on `products`/);
    });

    it("says which table a slug it does not serve is not, and which it does", () => {
        const registry = buildTableRegistry({ compiledTables: compiled, collections });
        expect(() => registry.requireTable("orders"))
            .toThrow('The table "orders" is not one this driver serves. It serves: sku_items, products.');
    });
});
