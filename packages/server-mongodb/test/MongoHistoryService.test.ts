import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { MongoHistoryService, findChangedFields } from "../src/services/MongoHistoryService";

describe("MongoHistoryService", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let historyService: MongoHistoryService;

    const COLLECTION_NAME = "__rebase_history";

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        client = new MongoClient(uri);
        await client.connect();
        db = client.db("test");
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        const collections = await db.listCollections().toArray();
        for (const col of collections) {
            await db.dropCollection(col.name);
        }
        historyService = new MongoHistoryService(db);
    });

    describe("changedFields detection", () => {
        it("should correctly identify added, modified, and removed fields", () => {
            const previous = { a: 1,
b: 2,
c: 3 };
            const current = { a: 1,
b: 20,
d: 4 };

            // Calling findChangedFields internally happens in recordHistory,
            const changed = findChangedFields(previous, current)!;

            expect(changed).toContain("b");
            expect(changed).toContain("c");
            expect(changed).toContain("d");
            expect(changed).not.toContain("a");
        });

        it("should ignore dunder properties", () => {
            const previous = { a: 1,
__rebase_meta: "foo" };
            const current = { a: 1,
__rebase_meta: "bar" };

            const changed = findChangedFields(previous, current);
            expect(changed).toBeNull();
        });

        it("should return empty array if objects are deeply equal", () => {
            const previous = { a: 1,
b: { nested: true } };
            const current = { a: 1,
b: { nested: true } };

            const changed = findChangedFields(previous, current);
            expect(changed).toBeNull();
        });
    });

    describe("recordHistory", () => {
        it("should record a create action", async () => {
            const entityId = new ObjectId().toString();
            await historyService.recordHistory({
                action: "create",
                entityId,
                tableName: "users",
                values: { name: "Alice" }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: entityId }).toArray();
            expect(history).toHaveLength(1);
            expect(history[0].action).toBe("create");
            expect(history[0].table_name).toBe("users");
            expect(history[0].values).toEqual({ name: "Alice" });
            expect(history[0].changed_fields).toBeNull(); // create doesn't have changed fields usually, or it's empty
        });

        it("should record an update action and calculate changed fields", async () => {
            const entityId = new ObjectId().toString();
            await historyService.recordHistory({
                action: "update",
                entityId,
                tableName: "users",
                values: { name: "Alice Updated",
age: 30 },
                previousValues: { name: "Alice",
age: 30 }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: entityId }).toArray();
            expect(history).toHaveLength(1);
            expect(history[0].action).toBe("update");
            expect(history[0].changed_fields).toEqual(["name"]);
        });

        it("should not record an update if no fields changed", async () => {
            const entityId = new ObjectId().toString();
            await historyService.recordHistory({
                action: "update",
                entityId,
                tableName: "users",
                values: { name: "Alice" },
                previousValues: { name: "Alice" }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: entityId }).toArray();
            expect(history).toHaveLength(0); // Because it should abort early
        });

        it("should record a delete action", async () => {
            const entityId = new ObjectId().toString();
            await historyService.recordHistory({
                action: "delete",
                entityId,
                tableName: "users",
                previousValues: { name: "Alice" }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: entityId }).toArray();
            expect(history).toHaveLength(1);
            expect(history[0].action).toBe("delete");
            expect(history[0].previous_values).toEqual({ name: "Alice" });
        });
    });

    describe("pruneHistory", () => {
        it("should prune entries based on maxEntries config", async () => {
            const customHistoryService = new MongoHistoryService(db, {
                maxEntries: 2,
                ttlDays: 30
            });

            const entityId = new ObjectId().toString();

            // Insert 3 records
            await customHistoryService.recordHistory({ action: "create",
entityId,
tableName: "users",
values: { a: 1 } });
            // add some delay to ensure order
            await new Promise(r => setTimeout(r, 10));
            await customHistoryService.recordHistory({ action: "update",
entityId,
tableName: "users",
values: { a: 2 },
previousValues: { a: 1 } });
            await new Promise(r => setTimeout(r, 10));
            await customHistoryService.recordHistory({ action: "update",
entityId,
tableName: "users",
values: { a: 3 },
previousValues: { a: 2 } });

            // Since it fire-and-forgets pruneHistory, we might need to wait slightly
            await new Promise(r => setTimeout(r, 100));

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: entityId }).sort({ updated_at: 1 }).toArray();

            // Only the latest 2 should be kept
            expect(history).toHaveLength(2);
            expect(history[0].values).toEqual({ a: 2 });
            expect(history[1].values).toEqual({ a: 3 });
        });

        it("should prune entries older than ttlDays", async () => {
            const customHistoryService = new MongoHistoryService(db, {
                maxEntries: 10,
                ttlDays: 1 // 1 day
            });

            const entityId = new ObjectId().toString();

            // Insert manually to mock older date
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

            await db.collection(COLLECTION_NAME).insertMany([
                {
                    _id: new ObjectId(),
                    action: "create",
                    entity_id: entityId,
                    table_name: "users",
                    values: { a: 1 },
                    updated_at: twoDaysAgo
                },
                {
                    _id: new ObjectId(),
                    action: "update",
                    entity_id: entityId,
                    table_name: "users",
                    values: { a: 2 },
                    previous_values: { a: 1 },
                    updated_at: new Date()
                }
            ]);

            // Trigger prune by inserting a new one
            await customHistoryService.recordHistory({ action: "update",
entityId,
tableName: "users",
values: { a: 3 },
previousValues: { a: 2 } });

            await new Promise(r => setTimeout(r, 100));

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: entityId }).sort({ updated_at: 1 }).toArray();

            // The record from twoDaysAgo should be deleted
            expect(history).toHaveLength(2);
            expect(history[0].values).toEqual({ a: 2 });
            expect(history[1].values).toEqual({ a: 3 });
        });
    });
});
