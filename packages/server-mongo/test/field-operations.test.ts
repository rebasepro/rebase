/**
 * Field operations — `{ views: { $inc: 1 } }` — on the MongoDB driver.
 *
 * REST's `PATCH` and the socket both accept them, and check them against the
 * collection's types, on the understanding that the driver applies them. This
 * one wrote them into the document as literal objects: `views` became
 * `{ "$inc": 1 }`, a 200 went back, and the counter was an object from then on
 * — the silent corruption `FIELD_OPERATORS` exists to rule out.
 *
 * The reference is the Postgres compiler (`field-op-sql.ts`): every operation
 * is NULL-safe, `$push`/`$pull` take a value or a list of them, `$pull`
 * removes every occurrence, and `$merge` is shallow.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import type { CollectionConfig } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoCollectionRegistry } from "../src/factory";

const posts: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    engine: "mongodb",
    properties: {
        title: { name: "Title", type: "string" },
        views: { name: "Views", type: "number" },
        tags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" } },
        meta: { name: "Meta", type: "map" }
    }
};

describe("MongoDB field operations", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let driver: MongoDriver;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_field_ops");
        const registry = new MongoCollectionRegistry();
        registry.register(posts);
        driver = new MongoDriver(db, undefined, undefined, registry);
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    const seed = async (doc: Record<string, unknown>): Promise<string> => {
        const inserted = await db.collection("posts").insertOne({ _id: new ObjectId(), ...doc });
        return inserted.insertedId.toString();
    };
    const stored = async (id: string) => db.collection("posts").findOne({ _id: new ObjectId(id) });
    const update = (id: string, values: Record<string, unknown>) =>
        driver.save({ path: "posts", id, values, collection: posts, status: "existing" });

    it("increments a counter, and starts an unset or null one from zero", async () => {
        const id = await seed({ views: 4 });
        const saved = await update(id, { views: { $inc: 1 } });
        expect(saved.views).toBe(5);
        expect((await stored(id))?.views).toBe(5);

        const unset = await seed({ title: "never viewed" });
        expect((await update(unset, { views: { $inc: 2 } })).views).toBe(2);
        const nulled = await seed({ views: null });
        expect((await update(nulled, { views: { $inc: 3 } })).views).toBe(3);
    });

    it("loses no increment to a concurrent one", async () => {
        const id = await seed({ views: 0 });
        await Promise.all(Array.from({ length: 10 }, () => update(id, { views: { $inc: 1 } })));
        expect((await stored(id))?.views).toBe(10);
    });

    it("pushes a value or a list of them, onto an array that may not exist yet", async () => {
        const id = await seed({ tags: ["a"] });
        await update(id, { tags: { $push: "b" } });
        await update(id, { tags: { $push: ["c", "d"] } });
        expect((await stored(id))?.tags).toEqual(["a", "b", "c", "d"]);

        const empty = await seed({ title: "untagged" });
        expect((await update(empty, { tags: { $push: "x" } })).tags).toEqual(["x"]);
    });

    it("pulls every occurrence of a value, or of each in a list", async () => {
        const id = await seed({ tags: ["a", "b", "a", "c"] });
        await update(id, { tags: { $pull: "a" } });
        expect((await stored(id))?.tags).toEqual(["b", "c"]);
        await update(id, { tags: { $pull: ["b", "c"] } });
        expect((await stored(id))?.tags).toEqual([]);
    });

    it("merges a map shallowly", async () => {
        const id = await seed({ meta: { a: 1, nested: { x: 1, y: 2 } } });
        await update(id, { meta: { $merge: { b: 2, nested: { x: 9 } } } });
        expect((await stored(id))?.meta).toEqual({ a: 1, b: 2, nested: { x: 9 } });
    });

    it("applies operations and plain values in one write, taking plain values literally", async () => {
        const id = await seed({ title: "old", views: 1 });
        // A string that looks like a field path is still a string: in an
        // update pipeline it would otherwise be read as `$views`.
        await update(id, { title: "$views", views: { $inc: 1 } });
        const doc = await stored(id);
        expect(doc?.title).toBe("$views");
        expect(doc?.views).toBe(2);
    });

    it("refuses an operation on a create, where there is no stored value to act on", async () => {
        await expect(driver.save({ path: "posts", values: { views: { $inc: 1 } }, collection: posts, status: "new" }))
            .rejects.toMatchObject({ statusCode: 400, code: "INVALID_FIELD_OPERATION" });
        expect(await db.collection("posts").countDocuments({ views: { $type: "object" } })).toBe(0);
    });

    it("refuses a misspelled operator instead of storing it", async () => {
        const id = await seed({ views: 1 });
        await expect(update(id, { views: { $increment: 1 } }))
            .rejects.toMatchObject({ statusCode: 400, code: "INVALID_FIELD_OPERATION" });
        expect((await stored(id))?.views).toBe(1);
    });
});
