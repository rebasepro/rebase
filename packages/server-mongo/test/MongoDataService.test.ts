/**
 * MongoDataService Tests
 *
 * Tests for MongoDB entity CRUD operations using mongodb-memory-server.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { EntityReference } from "@rebasepro/types";
import { MongoDataService } from "../src/db/MongoDataService";
// The shared contract, run by the Postgres suite too. A relative path because
// `@rebasepro/server` does not export test scaffolding — see the kit's header.
import { assertDeleteContract } from "../../server/test/contract/delete-contract";

/**
 * `save` and `fetchOne` return flat rows typed `Record<string, unknown>` — the
 * primary key is a column like any other, so `row.id` is `unknown` and cannot
 * be fed straight back into an `id: string | number` parameter. Narrow it once,
 * loudly, rather than casting at every call site.
 */
function rowId(row: Record<string, unknown>): string | number {
    const id = row.id;
    if (typeof id !== "string" && typeof id !== "number") {
        throw new Error(`expected the row to carry a string or number id, got ${JSON.stringify(id)}`);
    }
    return id;
}

describe("MongoDataService", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let dataService: MongoDataService;

    beforeAll(async () => {
        // Start in-memory MongoDB
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        client = new MongoClient(uri);
        await client.connect();
        db = client.db("test");
        dataService = new MongoDataService(db);
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        // Clear all collections before each test
        const collections = await db.listCollections().toArray();
        for (const col of collections) {
            await db.dropCollection(col.name);
        }
    });

    describe("generateId", () => {
        it("should generate a valid ObjectId string", () => {
            const id = dataService.generateId();
            expect(ObjectId.isValid(id)).toBe(true);
            expect(id).toHaveLength(24);
        });

        it("should generate unique IDs", () => {
            const ids = new Set<string>();
            for (let i = 0; i < 100; i++) {
                ids.add(dataService.generateId());
            }
            expect(ids.size).toBe(100);
        });
    });

    describe("save", () => {
        it("should create a new entity without ID", async () => {
            const values = { name: "Test User",
email: "test@example.com" };
            const entity = await dataService.save("users", values);

            expect(entity.id).toBeDefined();
            // Mongo ids come back as the hex string form of the ObjectId
            expect(typeof entity.id).toBe("string");
            expect(ObjectId.isValid(String(entity.id))).toBe(true);
            expect(entity.name).toBe("Test User");
            expect(entity.email).toBe("test@example.com");
        });

        it("should create a new entity with provided ID", async () => {
            const id = new ObjectId().toString();
            const values = { name: "Test User",
email: "test@example.com" };
            const entity = await dataService.save("users", values, id);

            expect(entity.id).toBe(id);
            expect(entity.name).toBe("Test User");
        });

        it("should update an existing entity", async () => {
            // Create entity
            const values = { name: "Original Name",
email: "test@example.com" };
            const created = await dataService.save("users", values);

            // Update entity
            const updated = await dataService.save(
                "users",
                { name: "Updated Name",
email: "test@example.com" },
                rowId(created)
            );

            expect(updated.id).toBe(created.id);
            expect(updated.name).toBe("Updated Name");
        });

        it("should handle nested objects", async () => {
            const values = {
                name: "Test User",
                address: {
                    street: "123 Main St",
                    city: "Test City",
                    country: "Test Country"
                }
            };
            const entity = await dataService.save("users", values);

            expect(entity.address).toEqual({
                street: "123 Main St",
                city: "Test City",
                country: "Test Country"
            });
        });

        it("should handle arrays", async () => {
            const values = {
                name: "Test Post",
                tags: ["javascript", "mongodb", "testing"]
            };
            const entity = await dataService.save("posts", values);

            expect(entity.tags).toEqual(["javascript", "mongodb", "testing"]);
        });

        it("should handle Date values", async () => {
            const now = new Date();
            const values = { name: "Test",
createdAt: now };
            const entity = await dataService.save("items", values);

            expect(entity.createdAt).toEqual(now);
        });

        /**
         * A partial update sends only the fields that changed. Returning those
         * back was a partial row everywhere it went: the REST response, the
         * `afterSave` callback, the history entry a revert restores from, and
         * the row pushed to single-document subscribers. Postgres returns the
         * whole row here.
         */
        it("returns the stored row after a partial update, not the values sent", async () => {
            const created = await dataService.save("users", {
                name: "Original Name",
                email: "test@example.com",
                age: 30
            });

            const updated = await dataService.save("users", { name: "Updated Name" }, rowId(created));

            expect(updated).toEqual({
                id: created.id,
                name: "Updated Name",
                email: "test@example.com",
                age: 30
            });
        });
    });

    describe("EntityReference round-trip", () => {
        it("should round-trip a EntityReference, preserving driver/databaseId", async () => {
            const ref = new EntityReference({
                id: new ObjectId().toString(),
                path: "authors",
                driver: "firestore",
                databaseId: "analytics"
            });
            const created = await dataService.save("posts", { title: "Hi",
author: ref });

            // NB: `fetchOne`'s type parameter never reaches its return type, so
            // a type argument here would be decorative — the row comes back as
            // `Record<string, unknown>` and the reference is narrowed below.
            const fetched = await dataService.fetchOne(
                "posts",
                rowId(created)
            );

            const fetchedRef = fetched!.author;
            expect(fetchedRef).toBeInstanceOf(EntityReference);
            if (!(fetchedRef instanceof EntityReference)) throw new Error("author did not decode into an EntityReference");
            expect(fetchedRef.isEntityReference()).toBe(true);
            expect(fetchedRef.id).toBe(ref.id);
            expect(fetchedRef.path).toBe("authors");
            expect(fetchedRef.driver).toBe("firestore");
            expect(fetchedRef.databaseId).toBe("analytics");
        });

        it("should decode the legacy { id, path } shape into a EntityReference", async () => {
            // Simulate a reference written before the __type sentinel existed.
            const legacyId = new ObjectId();
            await db.collection("posts").insertOne({
                _id: legacyId,
                title: "Legacy",
                author: { id: "abc123",
path: "authors" }
            } as never);

            const fetched = await dataService.fetchOne(
                "posts",
                legacyId.toString()
            );

            const fetchedRef = fetched!.author;
            expect(fetchedRef).toBeInstanceOf(EntityReference);
            if (!(fetchedRef instanceof EntityReference)) throw new Error("author did not decode into an EntityReference");
            expect(fetchedRef.id).toBe("abc123");
            expect(fetchedRef.path).toBe("authors");
        });

        it("should NOT coerce an ordinary embedded object that merely contains id and path", async () => {
            // A real sub-document with extra keys must stay a plain object —
            // this is the regression the old `"id" in v && "path" in v` heuristic caused.
            const values = {
                title: "Post",
                location: { id: "loc-1",
path: "/maps/somewhere",
label: "HQ" }
            };
            const created = await dataService.save("posts", values);
            const fetched = await dataService.fetchOne("posts", rowId(created));

            expect(fetched!.location).not.toBeInstanceOf(EntityReference);
            expect(fetched!.location).toEqual({ id: "loc-1",
path: "/maps/somewhere",
label: "HQ" });
        });
    });

    describe("fetchOne", () => {
        it("should fetch a entity by ID", async () => {
            const values = { name: "Test User",
email: "test@example.com" };
            const created = await dataService.save("users", values);

            const fetched = await dataService.fetchOne("users", rowId(created));

            expect(fetched).toBeDefined();
            expect(fetched?.id).toBe(created.id);
            expect(fetched?.name).toBe("Test User");
        });

        it("should return undefined for non-existent entity", async () => {
            const nonExistentId = new ObjectId().toString();
            const entity = await dataService.fetchOne("users", nonExistentId);

            expect(entity).toBeUndefined();
        });

        it("should handle string IDs", async () => {
            // Insert with a custom string ID (non-ObjectId)
            await db.collection("items").insertOne({
                _id: "custom-string-id" as unknown as import("mongodb").ObjectId,
                name: "Custom ID Item"
            });

            const entity = await dataService.fetchOne("items", "custom-string-id");
            expect(entity?.id).toBe("custom-string-id");
        });

        it("keeps the canonical _id even when the document has a literal 'id' column", async () => {
            // Regression: the flat row is built as { ...columns, id } so the
            // canonical document id always wins over a user-defined `id` field.
            const realId = new ObjectId();
            await db.collection("legacy").insertOne({
                _id: realId,
                id: "stale-column-value",
                name: "Legacy Row"
            });

            const row = await dataService.fetchOne("legacy", realId.toString());
            expect(row?.id).toBe(realId.toString());
            expect(row?.name).toBe("Legacy Row");
        });
    });

    describe("fetchCollection", () => {
        beforeEach(async () => {
            // Insert test data
            const users = [
                { name: "Alice",
age: 25,
status: "active" },
                { name: "Bob",
age: 30,
status: "active" },
                { name: "Charlie",
age: 35,
status: "inactive" },
                { name: "David",
age: 40,
status: "active" },
                { name: "Eve",
age: 28,
status: "pending" }
            ];
            await db.collection("users").insertMany(users);
        });

        it("should fetch all entities in a collection", async () => {
            const entities = await dataService.fetchCollection("users", {});
            expect(entities).toHaveLength(5);
        });

        it("should apply limit", async () => {
            const entities = await dataService.fetchCollection("users", { limit: 2 });
            expect(entities).toHaveLength(2);
        });

        it("should apply ordering (ascending)", async () => {
            const entities = await dataService.fetchCollection("users", {
                orderBy: "age",
                order: "asc"
            });

            const ages = entities.map(e => e.age);
            expect(ages).toEqual([25, 28, 30, 35, 40]);
        });

        it("should apply ordering (descending)", async () => {
            const entities = await dataService.fetchCollection("users", {
                orderBy: "age",
                order: "desc"
            });

            const ages = entities.map(e => e.age);
            expect(ages).toEqual([40, 35, 30, 28, 25]);
        });

        it("should apply equality filter", async () => {
            const entities = await dataService.fetchCollection("users", {
                filter: { status: ["==", "active"] }
            });

            expect(entities).toHaveLength(3);
            entities.forEach(e => expect(e.status).toBe("active"));
        });

        it("should apply greater than filter", async () => {
            const entities = await dataService.fetchCollection("users", {
                filter: { age: [">", 30] }
            });

            expect(entities).toHaveLength(2);
            entities.forEach(e => expect(e.age).toBeGreaterThan(30));
        });

        it("should apply combined filters", async () => {
            const entities = await dataService.fetchCollection("users", {
                filter: {
                    status: ["==", "active"],
                    age: [">=", 30]
                }
            });

            expect(entities).toHaveLength(2);
            entities.forEach(e => {
                expect(e.status).toBe("active");
                expect(e.age).toBeGreaterThanOrEqual(30);
            });
        });

        it("should return empty array for no matches", async () => {
            const entities = await dataService.fetchCollection("users", {
                filter: { status: ["==", "nonexistent"] }
            });

            expect(entities).toEqual([]);
        });
    });

    describe("delete", () => {
        it("should delete an existing entity", async () => {
            const values = { name: "To Delete" };
            const created = await dataService.save("users", values);

            await dataService.delete("users", rowId(created));

            const fetched = await dataService.fetchOne("users", rowId(created));
            expect(fetched).toBeUndefined();
        });

        /**
         * This used to assert the opposite — "should not throw for non-existent
         * entity" — while the Postgres driver's suite asserted a 404 for the
         * same call. Both passed for as long as they existed, because each
         * described its own driver's habit rather than the contract, and the
         * REST layer's read-before-delete hid the disagreement from everyone
         * except in-process `rebase.data` callers.
         *
         * The rule now lives in `DataDriver.delete`'s docblock and is checked
         * by the shared kit below, which the Postgres suite runs too.
         */
        it("meets the DataDriver.delete contract", async () => {
            await assertDeleteContract(
                {
                    path: "users",
                    create: async () => String(rowId(await dataService.save("users", { name: "Contract" }))),
                    delete: (id) => dataService.delete("users", id),
                    exists: async (id) => (await dataService.fetchOne("users", id)) !== undefined,
                    // A well-formed ObjectId that names nothing: an arbitrary
                    // string would fail as a cast rather than as a miss.
                    missingId: () => new ObjectId().toString()
                },
                {
                    rejectsNotFound: async (promise, id) => {
                        await expect(promise).rejects.toMatchObject({
                            statusCode: 404,
                            message: expect.stringContaining(`"${id}"`)
                        });
                    }
                }
            );
        });
    });

    describe("count", () => {
        beforeEach(async () => {
            await db.collection("users").insertMany([
                { status: "active" },
                { status: "active" },
                { status: "inactive" }
            ]);
        });

        it("should count all entities", async () => {
            const count = await dataService.count("users", {});
            expect(count).toBe(3);
        });

        it("should count with filter", async () => {
            const count = await dataService.count("users", {
                filter: { status: ["==", "active"] }
            });
            expect(count).toBe(2);
        });
    });

    describe("checkUniqueField", () => {
        beforeEach(async () => {
            await db.collection("users").insertMany([
                { email: "alice@example.com" },
                { email: "bob@example.com" }
            ]);
        });

        it("should return true if value is unique", async () => {
            const isUnique = await dataService.checkUniqueField(
                "users",
                "email",
                "new@example.com"
            );
            expect(isUnique).toBe(true);
        });

        it("should return false if value exists", async () => {
            const isUnique = await dataService.checkUniqueField(
                "users",
                "email",
                "alice@example.com"
            );
            expect(isUnique).toBe(false);
        });

        it("should exclude specified entity from check", async () => {
            // Get Alice's ID
            const alice = await db.collection("users").findOne({ email: "alice@example.com" });

            // Should be unique when we exclude Alice
            const isUnique = await dataService.checkUniqueField(
                "users",
                "email",
                "alice@example.com",
                alice!._id.toString()
            );
            expect(isUnique).toBe(true);
        });
    });

    describe("nested collection paths", () => {
        it("should handle nested paths", async () => {
            // Create entity in nested path
            const values = { content: "Test comment" };
            const entity = await dataService.save("posts/123/comments", values);

            expect(entity.content).toBe("Test comment");

            // The actual MongoDB collection should be "posts_123_comments"
            const collections = await db.listCollections().toArray();
            expect(collections.some(c => c.name === "posts_123_comments")).toBe(true);
        });
    });
});
