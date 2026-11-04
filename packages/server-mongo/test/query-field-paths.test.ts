/**
 * A filter or sort that reaches into a withheld field by a dotted path.
 *
 * Mongo reads `address.city` as the `city` of the document's `address`, so a
 * caller who may not read `address` learned which rows have a withheld city
 * equal to a guess, or got them in its order: the readable-field check
 * compared the whole name against the withheld ones, and `address.city` is not
 * among them. The refusal comes before any query is sent, so no server is
 * needed to see it.
 */

import { MongoClient } from "mongodb";
import type { CollectionConfig, User } from "@rebasepro/types";
import { AuthenticatedMongoDriver, MongoDriver } from "../src/services/MongoDriver";
import { MongoCollectionRegistry } from "../src/factory";

const people: CollectionConfig = {
    slug: "people",
    name: "People",
    engine: "mongodb",
    properties: {
        name: { name: "Name", type: "string" },
        address: {
            name: "Address",
            type: "map",
            access: { read: ["hr"], write: ["hr"] },
            properties: { city: { name: "City", type: "string" } }
        }
    }
};

const anon: User = {
    uid: "anonymous",
    roles: ["anon"],
    displayName: null,
    email: null,
    photoURL: null,
    providerId: "test",
    isAnonymous: false
};

describe("MongoDB readable-field check on dotted paths", () => {
    // Never connected: every case is refused before a query is sent.
    const client = new MongoClient("mongodb://127.0.0.1:1", { serverSelectionTimeoutMS: 1 });
    const registry = new MongoCollectionRegistry();
    registry.register(people);
    const driver = new MongoDriver(client.db("unused"), undefined, undefined, registry);

    afterAll(async () => {
        await client.close();
    });

    it("refuses a filter on a path inside a field the caller cannot read", async () => {
        const scoped = new AuthenticatedMongoDriver(driver, anon);
        await expect(scoped.fetchCollection({
            path: "people",
            collection: people,
            filter: { "address.city": ["==", "Lisbon"] }
        })).rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
        await expect(scoped.count({
            path: "people",
            collection: people,
            logical: { type: "or", conditions: [{ column: "address.city", operator: "==", value: "Lisbon" }] }
        })).rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
    });

    it("refuses a sort on a path inside a field the caller cannot read", async () => {
        const scoped = new AuthenticatedMongoDriver(driver, anon);
        await expect(scoped.fetchCollection({
            path: "people",
            collection: people,
            orderBy: "address.city",
            order: "asc"
        })).rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
    });
});
