import { EntityCollection, DataDriver } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { buildRebaseData } from "../src/data/buildRebaseData";
import { buildRoutedRebaseData } from "../src/data/buildRoutedRebaseData";
import { resolveDataSource, createDataSourceRegistry } from "../src/data/resolveDataSource";

/**
 * Integration test for the data-source routing pipeline as wired by
 * `RebaseNavigation` on the frontend:
 *
 *   buildRoutedRebaseData({
 *     defaultData,
 *     sources,
 *     resolveKey: (path) => resolveDataSource(registry.getCollection(path), defs).key
 *   })
 *
 * It exercises the real CollectionRegistry + resolveDataSource +
 * buildRoutedRebaseData together (no React), proving a collection is routed to
 * the right backend purely from its path.
 */
function mockDriver(key: string): DataDriver {
    return {
        key,
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchEntity: jest.fn().mockResolvedValue(undefined),
        saveEntity: jest.fn().mockResolvedValue({ id: "x", path: key, values: {} }),
        deleteEntity: jest.fn().mockResolvedValue(undefined)
    } as unknown as DataDriver;
}

describe("data-source routing pipeline (RebaseNavigation wiring)", () => {

    const definitions = [
        { key: "analytics", engine: "firestore", transport: "direct" as const }
    ];
    const dsRegistry = createDataSourceRegistry(definitions);

    const products: EntityCollection = {
        id: "products", name: "Products", path: "products", slug: "products",
        table: "products", properties: { title: { type: "string" } }
    } as EntityCollection;

    const events: EntityCollection = {
        id: "events", name: "Events", path: "events", slug: "events",
        dataSource: "analytics", properties: { title: { type: "string" } }
    } as EntityCollection;

    function buildRouted() {
        const registry = new CollectionRegistry([products, events], dsRegistry);
        const pg = mockDriver("postgres");
        const fs = mockDriver("firestore");
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pg),
            sources: { analytics: buildRebaseData(fs) },
            resolveKey: (path) => {
                const slug = path.split("/")[0];
                return resolveDataSource(registry.get(slug), dsRegistry).key;
            }
        });
        return { routed, pg, fs, registry };
    }

    it("routes a direct-source collection to its driver", async () => {
        const { routed, pg, fs } = buildRouted();
        await routed.collection("events").find();
        expect(fs.fetchCollection).toHaveBeenCalledTimes(1);
        expect((fs.fetchCollection as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "events" });
        expect(pg.fetchCollection).not.toHaveBeenCalled();
    });

    it("routes a default-source collection to the default driver", async () => {
        const { routed, pg, fs } = buildRouted();
        await routed.collection("products").find();
        expect(pg.fetchCollection).toHaveBeenCalledTimes(1);
        expect(fs.fetchCollection).not.toHaveBeenCalled();
    });

    it("routes by the accessed path (entity sub-path inherits the source)", async () => {
        const { routed, fs } = buildRouted();
        await routed.collection("events/evt1").findById("evt1");
        expect(fs.fetchEntity).toHaveBeenCalledTimes(1);
        expect((fs.fetchEntity as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "events/evt1", entityId: "evt1" });
    });

    it("reference from a direct form to a default collection still hits the default", async () => {
        // A Firestore (events) form referencing products must read products
        // from Postgres — routing follows the target path, not the ancestor.
        const { routed, pg, fs } = buildRouted();
        await routed.collection("products").findById("p1");
        expect(pg.fetchEntity).toHaveBeenCalledTimes(1);
        expect(fs.fetchEntity).not.toHaveBeenCalled();
    });

    it("routes writes on a direct-source collection to its driver", async () => {
        const { routed, pg, fs } = buildRouted();
        await routed.collection("events").create({ title: "launch" });
        expect(fs.saveEntity).toHaveBeenCalledTimes(1);
        expect((fs.saveEntity as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "events", status: "new" });
        expect(pg.saveEntity).not.toHaveBeenCalled();
    });

    it("stamps the resolved engine for capabilities (dataSource-only collection)", () => {
        const { registry } = buildRouted();
        expect(registry.get("events")?.driver).toBe("firestore");
    });
});
