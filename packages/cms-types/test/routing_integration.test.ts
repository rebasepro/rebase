import { CollectionConfig, DataDriver, EntityReference } from "@rebasepro/types";
import { CollectionRegistry, collectionEntityDataOptions } from "@rebasepro/cms-types";
import { buildRebaseData } from "@rebasepro/common";
import { buildRoutedRebaseData } from "@rebasepro/common";
import { resolveDataSource, createDataSourceRegistry } from "@rebasepro/common";

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
        fetchOne: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockResolvedValue({ id: "x", path: key, values: {} }),
        delete: jest.fn().mockResolvedValue(undefined),
        checkUniqueField: jest.fn()
    };
}

describe("data-source routing pipeline (RebaseNavigation wiring)", () => {

    const definitions = [
        { key: "analytics", engine: "firestore", transport: "direct" as const }
    ];
    const dsRegistry = createDataSourceRegistry(definitions);

    const products: CollectionConfig = {
        name: "Products", slug: "products",
        table: "products", properties: { title: { name: "Title",
type: "string" } }
    } as CollectionConfig;

    const events: CollectionConfig = {
        // `table` + `dataSource` and no `engine`: the author names a data source
        // and lets the registry resolve the engine from its definition.
        name: "Events", slug: "events", table: "events",
        dataSource: "analytics", properties: { title: { name: "Title",
type: "string" } }
    } as CollectionConfig;

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
        await routed.table("events").find();
        expect(fs.fetchCollection).toHaveBeenCalledTimes(1);
        expect((fs.fetchCollection as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "events" });
        expect(pg.fetchCollection).not.toHaveBeenCalled();
    });

    it("routes a default-source collection to the default driver", async () => {
        const { routed, pg, fs } = buildRouted();
        await routed.table("products").find();
        expect(pg.fetchCollection).toHaveBeenCalledTimes(1);
        expect(fs.fetchCollection).not.toHaveBeenCalled();
    });

    it("routes by the accessed path (entity sub-path inherits the source)", async () => {
        const { routed, fs } = buildRouted();
        await routed.table("events/evt1").findById("evt1");
        expect(fs.fetchOne).toHaveBeenCalledTimes(1);
        expect((fs.fetchOne as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "events/evt1", id: "evt1" });
    });

    it("reference from a direct form to a default collection still hits the default", async () => {
        // A Firestore (events) form referencing products must read products
        // from Postgres — routing follows the target path, not the ancestor.
        const { routed, pg, fs } = buildRouted();
        await routed.table("products").findById("p1");
        expect(pg.fetchOne).toHaveBeenCalledTimes(1);
        expect(fs.fetchOne).not.toHaveBeenCalled();
    });

    it("routes writes on a direct-source collection to its driver", async () => {
        const { routed, pg, fs } = buildRouted();
        await routed.table("events").create({ title: "launch" });
        expect(fs.save).toHaveBeenCalledTimes(1);
        expect((fs.save as jest.Mock).mock.calls[0][0]).toMatchObject({ path: "events", status: "new" });
        expect(pg.save).not.toHaveBeenCalled();
    });

    it("stamps the resolved engine for capabilities (dataSource-only collection)", () => {
        const { registry } = buildRouted();
        expect(registry.get("events")?.engine).toBe("firestore");
    });
});

/**
 * A hybrid registry: Postgres tables served by the client, Firestore
 * collections by a direct driver, and references between the two.
 *
 * A reference to a record of the other data source is stored as the record's
 * id — a string both sides can hold and query — and is a reference only in
 * the admin's view model, where its `driver` names the target's data source.
 * `fs_customers` is stored at `customers`, the slug of the Postgres collection
 * beside it: a reference to the Postgres customer must not be captured by it.
 */
describe("references across data sources (hybrid Postgres + Firestore)", () => {

    const dsRegistry = createDataSourceRegistry([{ key: "firestore", engine: "firestore", transport: "direct" }]);

    const customers: CollectionConfig = {
        name: "Customers", slug: "customers", table: "customers",
        properties: {
            name: { name: "Name", type: "string" },
            // A column holding the ids of Firestore documents.
            eventIds: { name: "Events", type: "array", of: { type: "reference", path: "fs_events" } }
        }
    };

    const firestoreCustomers: CollectionConfig = {
        name: "Customers (Firestore)", slug: "fs_customers", path: "customers",
        engine: "firestore", dataSource: "firestore",
        properties: { name: { name: "Name", type: "string" } }
    };

    const firestoreEvents: CollectionConfig = {
        name: "Events", slug: "fs_events", path: "events",
        engine: "firestore", dataSource: "firestore",
        properties: {
            type: { name: "Type", type: "string" },
            customerId: { name: "Customer", type: "reference", path: "customers" },
            mirror: { name: "Mirror", type: "reference", path: "fs_customers" }
        }
    };

    function buildHybrid(rows: { postgres?: Record<string, unknown>[], firestore?: Record<string, unknown>[] } = {}) {
        const registry = new CollectionRegistry([customers, firestoreCustomers, firestoreEvents], dsRegistry);
        const options = collectionEntityDataOptions(
            (slug: string) => registry.get(slug),
            { resolveDataPath: (path: string) => registry.resolveDataPath(path) }
        );
        const pg = mockDriver("postgres");
        const fs = mockDriver("firestore");
        (pg.fetchCollection as jest.Mock).mockResolvedValue(rows.postgres ?? []);
        (fs.fetchCollection as jest.Mock).mockResolvedValue(rows.firestore ?? []);
        (pg.save as jest.Mock).mockImplementation(async ({ values }: { values: Record<string, unknown> }) => ({ id: "1", ...values }));
        (fs.save as jest.Mock).mockImplementation(async ({ values }: { values: Record<string, unknown> }) => ({ id: "e1", ...values }));
        const routed = buildRoutedRebaseData({
            defaultData: buildRebaseData(pg, options),
            sources: { firestore: buildRebaseData(fs, options) },
            resolveKey: (path) => resolveDataSource(registry.get(path.split("/")[0]), dsRegistry).key
        });
        return { routed, pg, fs, registry };
    }

    const postgresCustomer = new EntityReference({ id: "42", path: "customers", driver: "(default)" });

    it("stores a Firestore document's reference to a Postgres row as the row's id", async () => {
        const { routed, fs } = buildHybrid();
        await routed.table("fs_events").create({ type: "signup", customerId: postgresCustomer });
        expect((fs.save as jest.Mock).mock.calls[0][0]).toMatchObject({
            path: "events",
            values: { type: "signup", customerId: "42" }
        });
    });

    it("keeps a reference within Firestore for the driver to store as a document reference", async () => {
        const { routed, fs } = buildHybrid();
        const sameSource = new EntityReference({ id: "c1", path: "customers" });
        await routed.table("fs_events").update("e1", { mirror: sameSource });
        expect((fs.save as jest.Mock).mock.calls[0][0].values.mirror).toBe(sameSource);
    });

    it("reads the stored id back as a reference routed to Postgres, not to the Firestore collection stored at its path", async () => {
        const { routed, registry } = buildHybrid({ firestore: [{ id: "e1", type: "signup", customerId: "42" }] });
        const { data } = await routed.table("fs_events").find();
        const reference = data[0].values.customerId;
        expect(reference).toEqual(postgresCustomer);
        // What the preview does with it: the collection it is looked up in.
        if (!(reference instanceof EntityReference)) throw new Error("expected a reference");
        expect(registry.resolveCollectionPath(reference.path, reference.driver)).toBe("customers");
        // Read as a stored Firestore path, the same string is the Firestore collection.
        expect(registry.resolveCollectionPath(reference.path, "firestore")).toBe("fs_customers");
    });

    it("re-routes a pointer an older save wrote into Firestore as a document reference", async () => {
        // What every save wrote before: `doc("customers", "42")`, read back
        // as a reference into Firestore.
        const dangling = new EntityReference({ id: "42", path: "customers", driver: "firestore" });
        const { routed } = buildHybrid({ firestore: [{ id: "e1", customerId: dangling }] });
        const { data } = await routed.table("fs_events").find();
        expect(data[0].values.customerId).toEqual(postgresCustomer);
    });

    it("leaves references within Firestore as they were read", async () => {
        const mirror = new EntityReference({ id: "c1", path: "customers", driver: "firestore" });
        const { routed } = buildHybrid({ firestore: [{ id: "e1", mirror }] });
        const { data } = await routed.table("fs_events").find();
        expect(data[0].values.mirror).toBe(mirror);
    });

    it("reads a Postgres column of Firestore ids as references routed to Firestore, and stores them back as ids", async () => {
        const { routed, pg, registry } = buildHybrid({ postgres: [{ id: "1", name: "Ada", eventIds: ["e1", "e2"] }] });
        const { data } = await routed.table("customers").find();
        const references = data[0].values.eventIds;
        expect(references).toEqual([
            new EntityReference({ id: "e1", path: "events", driver: "firestore" }),
            new EntityReference({ id: "e2", path: "events", driver: "firestore" })
        ]);
        expect(registry.resolveCollectionPath("events", "firestore")).toBe("fs_events");

        await routed.table("customers").update("1", { eventIds: references });
        expect((pg.save as jest.Mock).mock.calls[0][0].values).toEqual({ eventIds: ["e1", "e2"] });
    });
});
