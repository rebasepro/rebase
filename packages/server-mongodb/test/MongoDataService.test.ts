/**
 * MongoDataService Tests
 *
 * Tests for MongoDB snapshot CRUD operations using mongodb-memory-server.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { SnapshotReference } from "@rebasepro/types";
import { MongoDataService } from "../src/db/MongoDataService";

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
        it("should create a new snapshot without ID", async () => {
            const values = { name: "Test User",
email: "test@example.com" };
            const snapshot = await dataService.save("users", values);

            expect(snapshot.id).toBeDefined();
            expect(ObjectId.isValid(snapshot.id as string)).toBe(true);
            expect(snapshot.name).toBe("Test User");
            expect(snapshot.email).toBe("test@example.com");
        });

        it("should create a new snapshot with provided ID", async () => {
            const id = new ObjectId().toString();
            const values = { name: "Test User",
email: "test@example.com" };
            const snapshot = await dataService.save("users", values, id);

            expect(snapshot.id).toBe(id);
            expect(snapshot.name).toBe("Test User");
        });

        it("should update an existing snapshot", async () => {
            // Create snapshot
            const values = { name: "Original Name",
email: "test@example.com" };
            const created = await dataService.save("users", values);

            // Update snapshot
            const updated = await dataService.save(
                "users",
                { name: "Updated Name",
email: "test@example.com" },
                created.id
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
            const snapshot = await dataService.save("users", values);

            expect(snapshot.address).toEqual({
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
            const snapshot = await dataService.save("posts", values);

            expect(snapshot.tags).toEqual(["javascript", "mongodb", "testing"]);
        });

        it("should handle Date values", async () => {
            const now = new Date();
            const values = { name: "Test",
createdAt: now };
            const snapshot = await dataService.save("items", values);

            expect(snapshot.createdAt).toEqual(now);
        });
    });

    describe("SnapshotReference round-trip", () => {
        it("should round-trip a SnapshotReference, preserving driver/databaseId", async () => {
            const ref = new SnapshotReference({
                id: new ObjectId().toString(),
                path: "authors",
                driver: "firestore",
                databaseId: "analytics"
            });
            const created = await dataService.save("posts", { title: "Hi",
author: ref });

            const fetched = await dataService.fetchOne<{ title: string; author: SnapshotReference }>(
                "posts",
                created.id
            );

            const fetchedRef = fetched!.author;
            expect(fetchedRef).toBeInstanceOf(SnapshotReference);
            expect(fetchedRef.isSnapshotReference()).toBe(true);
            expect(fetchedRef.id).toBe(ref.id);
            expect(fetchedRef.path).toBe("authors");
            expect(fetchedRef.driver).toBe("firestore");
            expect(fetchedRef.databaseId).toBe("analytics");
        });

        it("should decode the legacy { id, path } shape into a SnapshotReference", async () => {
            // Simulate a reference written before the __type sentinel existed.
            const legacyId = new ObjectId();
            await db.collection("posts").insertOne({
                _id: legacyId,
                title: "Legacy",
                author: { id: "abc123",
path: "authors" }
            } as never);

            const fetched = await dataService.fetchOne<{ author: SnapshotReference }>(
                "posts",
                legacyId.toString()
            );

            const fetchedRef = fetched!.author;
            expect(fetchedRef).toBeInstanceOf(SnapshotReference);
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
            const fetched = await dataService.fetchOne<typeof values>("posts", created.id);

            expect(fetched!.location).not.toBeInstanceOf(SnapshotReference);
            expect(fetched!.location).toEqual({ id: "loc-1",
path: "/maps/somewhere",
label: "HQ" });
        });
    });

    describe("fetchOne", () => {
        it("should fetch a snapshot by ID", async () => {
            const values = { name: "Test User",
email: "test@example.com" };
            const created = await dataService.save("users", values);

            const fetched = await dataService.fetchOne("users", created.id);

            expect(fetched).toBeDefined();
            expect(fetched?.id).toBe(created.id);
            expect(fetched?.name).toBe("Test User");
        });

        it("should return undefined for non-existent snapshot", async () => {
            const nonExistentId = new ObjectId().toString();
            const snapshot = await dataService.fetchOne("users", nonExistentId);

            expect(snapshot).toBeUndefined();
        });

        it("should handle string IDs", async () => {
            // Insert with a custom string ID (non-ObjectId)
            await db.collection("items").insertOne({
                _id: "custom-string-id" as unknown as import("mongodb").ObjectId,
                name: "Custom ID Item"
            });

            const snapshot = await dataService.fetchOne("items", "custom-string-id");
            expect(snapshot?.id).toBe("custom-string-id");
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

        it("should fetch all snapshots in a collection", async () => {
            const snapshots = await dataService.fetchCollection("users", {});
            expect(snapshots).toHaveLength(5);
        });

        it("should apply limit", async () => {
            const snapshots = await dataService.fetchCollection("users", { limit: 2 });
            expect(snapshots).toHaveLength(2);
        });

        it("should apply ordering (ascending)", async () => {
            const snapshots = await dataService.fetchCollection("users", {
                orderBy: "age",
                order: "asc"
            });

            const ages = snapshots.map(e => e.age);
            expect(ages).toEqual([25, 28, 30, 35, 40]);
        });

        it("should apply ordering (descending)", async () => {
            const snapshots = await dataService.fetchCollection("users", {
                orderBy: "age",
                order: "desc"
            });

            const ages = snapshots.map(e => e.age);
            expect(ages).toEqual([40, 35, 30, 28, 25]);
        });

        it("should apply equality filter", async () => {
            const snapshots = await dataService.fetchCollection("users", {
                filter: { status: ["==", "active"] }
            });

            expect(snapshots).toHaveLength(3);
            snapshots.forEach(e => expect(e.status).toBe("active"));
        });

        it("should apply greater than filter", async () => {
            const snapshots = await dataService.fetchCollection("users", {
                filter: { age: [">", 30] }
            });

            expect(snapshots).toHaveLength(2);
            snapshots.forEach(e => expect(e.age).toBeGreaterThan(30));
        });

        it("should apply combined filters", async () => {
            const snapshots = await dataService.fetchCollection("users", {
                filter: {
                    status: ["==", "active"],
                    age: [">=", 30]
                }
            });

            expect(snapshots).toHaveLength(2);
            snapshots.forEach(e => {
                expect(e.status).toBe("active");
                expect(e.age).toBeGreaterThanOrEqual(30);
            });
        });

        it("should return empty array for no matches", async () => {
            const snapshots = await dataService.fetchCollection("users", {
                filter: { status: ["==", "nonexistent"] }
            });

            expect(snapshots).toEqual([]);
        });
    });

    describe("delete", () => {
        it("should delete an existing snapshot", async () => {
            const values = { name: "To Delete" };
            const created = await dataService.save("users", values);

            await dataService.delete("users", created.id);

            const fetched = await dataService.fetchOne("users", created.id);
            expect(fetched).toBeUndefined();
        });

        it("should not throw for non-existent snapshot", async () => {
            const nonExistentId = new ObjectId().toString();

            // Should not throw
            await expect(
                dataService.delete("users", nonExistentId)
            ).resolves.not.toThrow();
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

        it("should count all snapshots", async () => {
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

        it("should exclude specified snapshot from check", async () => {
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
            // Create snapshot in nested path
            const values = { content: "Test comment" };
            const snapshot = await dataService.save("posts/123/comments", values);

            expect(snapshot.content).toBe("Test comment");

            // The actual MongoDB collection should be "posts_123_comments"
            const collections = await db.listCollections().toArray();
            expect(collections.some(c => c.name === "posts_123_comments")).toBe(true);
        });
    });
});
