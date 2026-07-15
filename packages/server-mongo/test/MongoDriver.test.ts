/**
 * MongoDataDriver Tests
 *
 * Tests for the DataDriver implementation that integrates with Rebase.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { MongoDriver } from "../src/services/MongoDriver";
import { CollectionConfig } from "@rebasepro/types";

describe("MongoDriver", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let delegate: MongoDriver;

    const mockCollection: CollectionConfig = {
        name: "users",
        properties: {
            name: { dataType: "string" },
            email: { dataType: "string" },
            age: { dataType: "number" }
        }
    };

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        client = new MongoClient(uri);
        await client.connect();
        db = client.db("test");
        delegate = new MongoDriver(db);
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
    });

    describe("key and initialization", () => {
        it("should have key set to 'mongodb'", () => {
            expect(delegate.key).toBe("mongodb");
        });

        it("should be initialized", () => {
            expect(delegate.initialised).toBe(true);
        });

        it("should report as ready", () => {
            expect(delegate.isReady()).toBe(true);
        });
    });

    describe("generateId", () => {
        it("should generate a valid ObjectId string", () => {
            const id = delegate.generateId("users");
            expect(ObjectId.isValid(id)).toBe(true);
        });
    });

    describe("currentTime", () => {
        it("should return current timestamp", () => {
            const before = new Date();
            const time = delegate.currentTime();
            const after = new Date();

            expect(time.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(time.getTime()).toBeLessThanOrEqual(after.getTime());
        });
    });


    describe("fetchOne", () => {
        it("should fetch a entity", async () => {
            // Insert test data
            const result = await db.collection("users").insertOne({
                name: "Test User",
                email: "test@example.com"
            });

            const entity = await delegate.fetchOne({
                path: "users",
                id: result.insertedId.toString(),
                collection: mockCollection
            });

            expect(entity).toBeDefined();
            expect(entity?.name).toBe("Test User");
        });

        it("should return undefined for non-existent entity", async () => {
            const entity = await delegate.fetchOne({
                path: "users",
                id: new ObjectId().toString(),
                collection: mockCollection
            });

            expect(entity).toBeUndefined();
        });
    });

    describe("fetchCollection", () => {
        beforeEach(async () => {
            await db.collection("users").insertMany([
                { name: "Alice",
age: 25 },
                { name: "Bob",
age: 30 },
                { name: "Charlie",
age: 35 }
            ]);
        });

        it("should fetch all entities", async () => {
            const entities = await delegate.fetchCollection({
                path: "users",
                collection: mockCollection
            });

            expect(entities).toHaveLength(3);
        });

        it("should apply limit", async () => {
            const entities = await delegate.fetchCollection({
                path: "users",
                collection: mockCollection,
                limit: 2
            });

            expect(entities).toHaveLength(2);
        });

        it("should apply ordering", async () => {
            const entities = await delegate.fetchCollection({
                path: "users",
                collection: mockCollection,
                orderBy: "age",
                order: "desc"
            });

            const ages = entities.map(e => e.age);
            expect(ages).toEqual([35, 30, 25]);
        });
    });

    describe("save", () => {
        it("should create a new entity", async () => {
            const entity = await delegate.save({
                path: "users",
                values: { name: "New User",
email: "new@example.com" },
                collection: mockCollection,
                status: "new"
            });

            expect(entity.id).toBeDefined();
            expect(entity.name).toBe("New User");

            // Verify it was saved
            const fetched = await delegate.fetchOne({
                path: "users",
                id: entity.id,
                collection: mockCollection
            });
            expect(fetched?.name).toBe("New User");
        });

        it("should update an existing entity", async () => {
            // Create first
            const created = await delegate.save({
                path: "users",
                values: { name: "Original",
email: "test@example.com" },
                collection: mockCollection,
                status: "new"
            });

            // Update
            const updated = await delegate.save({
                path: "users",
                id: created.id,
                values: { name: "Updated",
email: "test@example.com" },
                collection: mockCollection,
                status: "existing"
            });

            expect(updated.id).toBe(created.id);
            expect(updated.name).toBe("Updated");
        });
    });

    describe("delete", () => {
        it("should delete a entity", async () => {
            // Create
            const entity = await delegate.save({
                path: "users",
                values: { name: "To Delete" },
                collection: mockCollection,
                status: "new"
            });

            // Delete — rows are flat, so the caller provides the collection path
            await delegate.delete({
                row: { id: entity.id as string, path: "users" },
                collection: mockCollection
            });

            // Verify deleted
            const fetched = await delegate.fetchOne({
                path: "users",
                id: entity.id,
                collection: mockCollection
            });
            expect(fetched).toBeUndefined();
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
            const count = await delegate.count({
                path: "users",
                collection: mockCollection
            });

            expect(count).toBe(3);
        });

        it("should count with filter", async () => {
            const count = await delegate.count({
                path: "users",
                collection: mockCollection,
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

        it("should return true for unique value", async () => {
            const isUnique = await delegate.checkUniqueField(
                "users",
                "email",
                "unique@example.com",
                undefined,
                mockCollection
            );

            expect(isUnique).toBe(true);
        });

        it("should return false for existing value", async () => {
            const isUnique = await delegate.checkUniqueField(
                "users",
                "email",
                "alice@example.com",
                undefined,
                mockCollection
            );

            expect(isUnique).toBe(false);
        });
    });

    describe("listenCollection", () => {
        it("should call onUpdate with initial data", (done) => {
            db.collection("users").insertMany([
                { name: "User 1" },
                { name: "User 2" }
            ]).then(() => {
                const unsubscribe = delegate.listenCollection({
                    path: "users",
                    collection: mockCollection,
                    onUpdate: (entities) => {
                        expect(entities).toHaveLength(2);
                        unsubscribe();
                        done();
                    },
                    onError: (error) => {
                        unsubscribe();
                        done(error);
                    }
                });
            });
        });

        it("should return unsubscribe function", () => {
            const unsubscribe = delegate.listenCollection({
                path: "users",
                collection: mockCollection,
                onUpdate: () => { },
                onError: () => { }
            });

            expect(typeof unsubscribe).toBe("function");
            unsubscribe();
        });
    });

    describe("listenOne", () => {
        it("should call onUpdate with initial data", (done) => {
            db.collection("users").insertOne({ name: "Test User" }).then((result) => {
                const id = result.insertedId.toString();

                const unsubscribe = delegate.listenOne({
                    path: "users",
                    id,
                    collection: mockCollection,
                    onUpdate: (entity) => {
                        expect(entity?.name).toBe("Test User");
                        unsubscribe();
                        done();
                    },
                    onError: (error) => {
                        unsubscribe();
                        done(error);
                    }
                });
            });
        });
    });

    describe("MongoDriver Hooks and storageSource", () => {
        it("should execute read, save, and delete hooks and pass storageSource", async () => {
            const mockStorage = { key: "mongoStorage" };
            delegate.client = {
                storage: mockStorage
            } as any;

            const afterReadSpy = jest.fn().mockImplementation(async ({ row }) => {
                row.hooked = true;
                return row;
            });
            const beforeSaveSpy = jest.fn().mockImplementation(async ({ values }) => {
                return { beforeSaved: true };
            });
            const afterSaveSpy = jest.fn();
            const beforeDeleteSpy = jest.fn();
            const afterDeleteSpy = jest.fn();

            const collectionWithHooks: CollectionConfig = {
                name: "hooked_users",
                properties: {
                    name: { dataType: "string" }
                },
                callbacks: {
                    afterRead: afterReadSpy,
                    beforeSave: beforeSaveSpy,
                    afterSave: afterSaveSpy,
                    beforeDelete: beforeDeleteSpy,
                    afterDelete: afterDeleteSpy
                }
            } as any;

            // 1. Test save
            const saved = await delegate.save({
                path: "hooked_users",
                values: { name: "John" },
                collection: collectionWithHooks,
                status: "new"
            });

            expect(beforeSaveSpy).toHaveBeenCalled();
            const saveArgs = beforeSaveSpy.mock.calls[0][0];
            expect(saveArgs.context.storageSource).toBe(mockStorage);
            expect(saveArgs.values.name).toBe("John");

            // Verifies updatedValues includes returned value from beforeSave callback
            expect(saved.beforeSaved).toBe(true);

            expect(afterSaveSpy).toHaveBeenCalled();
            const afterSaveArgs = afterSaveSpy.mock.calls[0][0];
            expect(afterSaveArgs.context.storageSource).toBe(mockStorage);

            // 2. Test fetchOne
            const fetched = await delegate.fetchOne({
                path: "hooked_users",
                id: saved.id,
                collection: collectionWithHooks
            });

            expect(fetched).toBeDefined();
            expect(fetched?.hooked).toBe(true);
            expect(afterReadSpy).toHaveBeenCalled();
            const readArgs = afterReadSpy.mock.calls[0][0];
            expect(readArgs.context.storageSource).toBe(mockStorage);

            // 3. Test delete
            await delegate.delete({
                row: { id: fetched!.id as string, path: "hooked_users", values: fetched! },
                collection: collectionWithHooks
            });

            expect(beforeDeleteSpy).toHaveBeenCalled();
            expect(beforeDeleteSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
            expect(afterDeleteSpy).toHaveBeenCalled();
            expect(afterDeleteSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
        });
    });
});
