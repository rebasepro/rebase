import { EntityCollection } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { createDataSourceRegistry } from "../src/data/resolveDataSource";

describe("CollectionRegistry — data source engine stamping", () => {

    const firestoreColl: EntityCollection = {
        id: "events",
        name: "Events",
        path: "events",
        slug: "events",
        dataSource: "analytics",
        properties: { title: { type: "string" } }
    } as EntityCollection;

    const plainColl: EntityCollection = {
        id: "products",
        name: "Products",
        path: "products",
        slug: "products",
        table: "products",
        properties: { title: { type: "string" } }
    } as EntityCollection;

    it("stamps the resolved engine onto a dataSource-only collection (normalized layer)", () => {
        const registry = new CollectionRegistry(
            [firestoreColl],
            createDataSourceRegistry([
                { key: "analytics", engine: "firestore", transport: "direct" }
            ])
        );
        const normalized = registry.get("events");
        expect(normalized?.driver).toBe("firestore");
        // Raw layer keeps the author's original fields (no driver invented).
        expect(registry.getRaw("events")?.driver).toBeUndefined();
    });

    it("leaves plain default collections untouched (driver stays undefined)", () => {
        const registry = new CollectionRegistry(
            [plainColl],
            createDataSourceRegistry([{ key: "(default)", engine: "postgres", transport: "server" }])
        );
        expect(registry.get("products")?.driver).toBeUndefined();
    });

    it("does not override an explicit driver", () => {
        const coll = { ...firestoreColl, driver: "mongodb" } as EntityCollection;
        const registry = new CollectionRegistry(
            [coll],
            createDataSourceRegistry([{ key: "analytics", engine: "firestore", transport: "direct" }])
        );
        expect(registry.get("events")?.driver).toBe("mongodb");
    });
});
