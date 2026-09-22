/**
 * What a filter *means* on MongoDB, asserted against a real mongod.
 *
 * The shape tests in `MongoConditionBuilder.test.ts` check what the builder
 * emits; these check which rows come back, because a query that is shaped
 * plausibly and answers the wrong rows is the failure mode here. The reference
 * is the Postgres driver, which the REST layer and the SDK both assume: SQL's
 * three-valued logic, where a comparison against NULL is neither true nor
 * false, so `NOT (status = 'draft')` excludes a row whose status is NULL.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import type { CollectionConfig, FilterValues, LogicalCondition } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoCollectionRegistry } from "../src/factory";

const posts: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    engine: "mongodb",
    properties: {
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string" },
        views: { name: "Views", type: "number" }
    }
};

describe("MongoDB filter semantics", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let driver: MongoDriver;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_filter_semantics");
        const registry = new MongoCollectionRegistry();
        registry.register(posts);
        driver = new MongoDriver(db, undefined, undefined, registry);

        await db.collection("posts").insertMany([
            { _id: new ObjectId(), title: "a", status: "draft", views: 20 },
            { _id: new ObjectId(), title: "b", status: "published", views: 10 },
            { _id: new ObjectId(), title: "c", status: null, views: 30 },
            { _id: new ObjectId(), title: "d", views: 40 }
        ]);
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    /** Titles, sorted, for the rows a query returns — and the count must agree. */
    const titles = async (query: { filter?: FilterValues<string>; logical?: LogicalCondition }): Promise<string[]> => {
        const scoped = await driver.withAuth({
            uid: "u", roles: [], displayName: null, email: null, photoURL: null, providerId: "test", isAnonymous: false
        });
        const rows = await scoped.fetchCollection({ path: "posts", collection: posts, ...query });
        const count = await scoped.count!({ path: "posts", collection: posts, ...query });
        const found = rows.map(r => String(r.title)).sort();
        expect(count).toBe(found.length);
        return found;
    };

    describe("not(...)", () => {
        it("negates its condition rather than applying it", async () => {
            expect(await titles({
                logical: { type: "not", conditions: [{ column: "status", operator: "==", value: "draft" }] }
            })).toEqual(["b"]);
        });

        it("negates the conjunction of several conditions", async () => {
            // NOT (status = 'draft' AND views >= 20): a is excluded; b fails
            // the conjunction outright; c and d are unknown on the status half
            // but false on neither — so NOT(unknown AND true) stays unknown.
            expect(await titles({
                logical: {
                    type: "not",
                    conditions: [
                        { column: "status", operator: "==", value: "draft" },
                        { column: "views", operator: ">=", value: 20 }
                    ]
                }
            })).toEqual(["b"]);
            // NOT (status = 'draft' AND views >= 35): false for everyone with a
            // views under 35, whatever their status, so c joins b.
            expect(await titles({
                logical: {
                    type: "not",
                    conditions: [
                        { column: "status", operator: "==", value: "draft" },
                        { column: "views", operator: ">=", value: 35 }
                    ]
                }
            })).toEqual(["a", "b", "c"]);
        });

        it("applies De Morgan through a nested or(...)", async () => {
            expect(await titles({
                logical: {
                    type: "not",
                    conditions: [{
                        type: "or",
                        conditions: [
                            { column: "status", operator: "==", value: "draft" },
                            { column: "views", operator: ">", value: 35 }
                        ]
                    }]
                }
            })).toEqual(["b"]);
        });

        it("cancels out when doubled", async () => {
            expect(await titles({
                logical: {
                    type: "not",
                    conditions: [{ type: "not", conditions: [{ column: "status", operator: "==", value: "draft" }] }]
                }
            })).toEqual(["a"]);
        });

        it("reads is-null as a test that is never unknown", async () => {
            expect(await titles({
                logical: { type: "not", conditions: [{ column: "status", operator: "is-null", value: null }] }
            })).toEqual(["a", "b"]);
        });
    });
});
