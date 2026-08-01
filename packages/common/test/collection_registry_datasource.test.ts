import { CollectionConfig } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { createDataSourceRegistry } from "../src/data/resolveDataSource";

describe("CollectionRegistry — data source resolution stamping", () => {

    const firestoreColl: CollectionConfig = {
        name: "Events",
        slug: "events",
        table: "events",
        dataSource: "analytics",
        properties: { title: { name: "Title",
type: "string" } }
    } as CollectionConfig;

    const plainColl: CollectionConfig = {
        name: "Products",
        slug: "products",
        table: "products",
        properties: { title: { name: "Title",
type: "string" } }
    } as CollectionConfig;

    it("stamps both dataSource and engine from a registered definition", () => {
        const registry = new CollectionRegistry(
            [firestoreColl],
            createDataSourceRegistry([
                { key: "analytics", engine: "firestore", transport: "direct" }
            ])
        );
        const normalized = registry.get("events");
        expect(normalized?.dataSource).toBe("analytics");
        expect(normalized?.engine).toBe("firestore");
        // Raw layer keeps the author's original fields.
        expect(registry.getRaw("events")?.engine).toBeUndefined();
    });

    it("stamps default dataSource and engine on plain collections", () => {
        const registry = new CollectionRegistry(
            [plainColl],
            createDataSourceRegistry([{ key: "(default)", engine: "postgres", transport: "server" }])
        );
        const normalized = registry.get("products");
        expect(normalized?.dataSource).toBe("(default)");
        expect(normalized?.engine).toBe("postgres");
        // Raw layer has no dataSource or engine.
        expect(registry.getRaw("products")?.dataSource).toBeUndefined();
        expect(registry.getRaw("products")?.engine).toBeUndefined();
    });

    it("does not override an explicit engine", () => {
        const coll = { ...firestoreColl, engine: "mongodb" } as CollectionConfig;
        const registry = new CollectionRegistry(
            [coll],
            createDataSourceRegistry([{ key: "analytics", engine: "firestore", transport: "direct" }])
        );
        expect(registry.get("events")?.engine).toBe("mongodb");
        expect(registry.get("events")?.dataSource).toBe("analytics");
    });
});
