/**
 * `MongoCollectionRegistry` keys.
 *
 * It registered by `collection.name` — the human label — and looked up by path,
 * so every lookup missed. The HTTP routes survive it because they pass the
 * collection explicitly; the realtime path has no other source, so it ran with
 * `collection: undefined`: no `securityRules`, no `properties`, no callbacks.
 */

import { CollectionConfig } from "@rebasepro/types";
import { MongoCollectionRegistry } from "../src/factory";

const collection: CollectionConfig = {
    slug: "mongo_customer",
    name: "Customers (MongoDB)",
    engine: "mongodb",
    // The MongoDB collection-name override: a third distinct name for the same
    // collection, and what `getCollectionDataPath` hands the driver.
    path: "customers_v2",
    properties: {}
};

describe("MongoCollectionRegistry", () => {
    it("finds a collection by the data path the driver is addressed with", () => {
        const registry = new MongoCollectionRegistry();
        registry.register(collection);
        expect(registry.getCollectionByPath("customers_v2")?.slug).toBe("mongo_customer");
    });

    it("finds it by slug, the routing key", () => {
        const registry = new MongoCollectionRegistry();
        registry.register(collection);
        expect(registry.getCollectionByPath("mongo_customer")?.slug).toBe("mongo_customer");
    });

    it("keeps answering to the display name it used to be keyed by", () => {
        const registry = new MongoCollectionRegistry();
        registry.register(collection);
        expect(registry.getCollectionByPath("Customers (MongoDB)")?.slug).toBe("mongo_customer");
    });

    it("does not answer for a name nobody registered", () => {
        const registry = new MongoCollectionRegistry();
        registry.register(collection);
        expect(registry.getCollectionByPath("orders")).toBeUndefined();
    });

    it("lists each collection once, however many keys it answers to", () => {
        const registry = new MongoCollectionRegistry();
        registry.register(collection);
        registry.register({ slug: "orders",
name: "Orders",
engine: "mongodb",
properties: {} });
        expect(registry.getCollections().map(c => c.slug)).toEqual(["mongo_customer", "orders"]);
    });
});
