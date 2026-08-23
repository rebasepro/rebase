import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { MongoHistoryService, findChangedFields } from "../src/services/MongoHistoryService";

/**
 * Wait for the history collection to settle at `expected` rows for an entity.
 *
 * `recordHistory` fire-and-forgets `pruneHistory`, so the prune completes some
 * time after the call that triggered it resolves. These tests used to wait a
 * flat 100 ms, which is a bet on scheduler latency: on a loaded machine the
 * prune had not run yet and the assertion saw the pre-prune count — observed as
 * "Expected length: 2, Received length: 3" in a CI run where every other
 * assertion in the file passed.
 *
 * Polling asserts the same thing without the bet: fast when the prune is
 * prompt, and still correct when it is not. The timeout is what fails the test
 * if the prune genuinely never happens.
 */
async function historySettlesAt(
    db: Db,
    collectionName: string,
    entityId: string,
    expected: number,
    timeoutMs = 5000
): Promise<Record<string, unknown>[]> {
    const deadline = Date.now() + timeoutMs;
    let rows: Record<string, unknown>[] = [];
    for (;;) {
        rows = await db.collection(collectionName)
            .find({ entity_id: entityId }).sort({ updated_at: 1 }).toArray() as unknown as Record<string, unknown>[];
        if (rows.length === expected || Date.now() > deadline) return rows;
        await new Promise(r => setTimeout(r, 25));
    }
}


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
            const id = new ObjectId().toString();
            await historyService.recordHistory({
                action: "create",
                id,
                tableName: "users",
                values: { name: "Alice" }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: id }).toArray();
            expect(history).toHaveLength(1);
            expect(history[0].action).toBe("create");
            expect(history[0].table_name).toBe("users");
            expect(history[0].values).toEqual({ name: "Alice" });
            expect(history[0].changed_fields).toBeNull(); // create doesn't have changed fields usually, or it's empty
        });

        it("should record an update action and calculate changed fields", async () => {
            const id = new ObjectId().toString();
            await historyService.recordHistory({
                action: "update",
                id,
                tableName: "users",
                values: { name: "Alice Updated",
age: 30 },
                previousValues: { name: "Alice",
age: 30 }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: id }).toArray();
            expect(history).toHaveLength(1);
            expect(history[0].action).toBe("update");
            expect(history[0].changed_fields).toEqual(["name"]);
        });

        it("should not record an update if no fields changed", async () => {
            const id = new ObjectId().toString();
            await historyService.recordHistory({
                action: "update",
                id,
                tableName: "users",
                values: { name: "Alice" },
                previousValues: { name: "Alice" }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: id }).toArray();
            expect(history).toHaveLength(0); // Because it should abort early
        });

        it("should record a delete action", async () => {
            const id = new ObjectId().toString();
            await historyService.recordHistory({
                action: "delete",
                id,
                tableName: "users",
                previousValues: { name: "Alice" }
            });

            const history = await db.collection(COLLECTION_NAME).find({ entity_id: id }).toArray();
            expect(history).toHaveLength(1);
            expect(history[0].action).toBe("delete");
            expect(history[0].previous_values).toEqual({ name: "Alice" });
        });
    });

    describe("pruneHistory", () => {
        /**
         * Two prunes, interleaved at the point the old code broke.
         *
         * recordHistory fires pruneHistory without awaiting it, so a row
         * written twice in quick succession has two prunes in flight. The old
         * implementation read twice: countDocuments for HOW MANY, then
         * find().limit(that many) for WHICH. Between those two reads the other
         * prune could finish, so the quantity from one snapshot was applied to
         * a different one — the second prune deleted a row that was never
         * surplus and the history fell BELOW maxEntries. Silent data loss:
         * nothing errors, the rows are just gone.
         *
         * Firing writes concurrently does NOT reproduce it — verified: the
         * naive version of this test passes against the broken code, because
         * the two reads happen to stay adjacent. The interleaving has to be
         * forced, so the first prune's find is held open while the second runs
         * to completion.
         *
         * Under the fixed single-read prune the held prune resumes, re-reads,
         * sees nothing surplus and deletes nothing. Under the old one it
         * deletes "the oldest", which by then is a row that must survive.
         */
        it("does not prune below maxEntries when two prunes interleave", async () => {
            const id = new ObjectId().toString();
            const base = Date.now();
            await db.collection(COLLECTION_NAME).insertMany([1, 2, 3].map(n => ({
                _id: new ObjectId(),
                action: "update",
                entity_id: id,
                table_name: "users",
                values: { a: n },
                updated_at: new Date(base + n * 1000)
            })) as never);

            const real = db.collection(COLLECTION_NAME);
            let releaseGate!: () => void;
            let announceReached!: () => void;
            const gate = new Promise<void>(r => { releaseGate = r; });
            const reachedFind = new Promise<void>(r => { announceReached = r; });
            let firstFind = true;

            // Only the FIRST find is held; the second prune runs unimpeded.
            const gatedDb = {
                collection: () => new Proxy(real, {
                    get(target, prop, receiver) {
                        const value = Reflect.get(target, prop, receiver);
                        if (prop === "find" && firstFind) {
                            firstFind = false;
                            return (...args: unknown[]) => {
                                announceReached();
                                const cursor = (value as (...a: unknown[]) => unknown).apply(target, args) as Record<string, unknown>;
                                const toArray = cursor.toArray as () => Promise<unknown[]>;
                                cursor.toArray = async () => { await gate; return toArray.call(cursor); };
                                return cursor;
                            };
                        }
                        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
                    }
                })
            } as unknown as Db;

            const held = new MongoHistoryService(gatedDb, { maxEntries: 2, ttlDays: 30 });
            const plain = new MongoHistoryService(db, { maxEntries: 2, ttlDays: 30 });

            // Reaches into the private prune on purpose: recordHistory would
            // insert a row and change the very count under test.
            const first = (held as unknown as { pruneHistory(i: string, t: string): Promise<void> })
                .pruneHistory(id, "users");
            await reachedFind;
            await (plain as unknown as { pruneHistory(i: string, t: string): Promise<void> })
                .pruneHistory(id, "users");
            releaseGate();
            await first;

            const rows = await db.collection(COLLECTION_NAME)
                .find({ entity_id: id }).sort({ updated_at: 1 }).toArray();
            expect(rows).toHaveLength(2);
            expect(rows.map(r => (r.values as { a: number }).a)).toEqual([2, 3]);
        });

        it("should prune entries based on maxEntries config", async () => {
            const customHistoryService = new MongoHistoryService(db, {
                maxEntries: 2,
                ttlDays: 30
            });

            const id = new ObjectId().toString();

            // Insert 3 records
            await customHistoryService.recordHistory({ action: "create",
id,
tableName: "users",
values: { a: 1 } });
            // add some delay to ensure order
            await new Promise(r => setTimeout(r, 10));
            await customHistoryService.recordHistory({ action: "update",
id,
tableName: "users",
values: { a: 2 },
previousValues: { a: 1 } });
            await new Promise(r => setTimeout(r, 10));
            await customHistoryService.recordHistory({ action: "update",
id,
tableName: "users",
values: { a: 3 },
previousValues: { a: 2 } });

            // pruneHistory is fire-and-forget: poll rather than bet on a fixed delay.
            const history = await historySettlesAt(db, COLLECTION_NAME, id, 2);

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

            const id = new ObjectId().toString();

            // Insert manually to mock older date
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

            await db.collection(COLLECTION_NAME).insertMany([
                {
                    _id: new ObjectId(),
                    action: "create",
                    entity_id: id,
                    table_name: "users",
                    values: { a: 1 },
                    updated_at: twoDaysAgo
                },
                {
                    _id: new ObjectId(),
                    action: "update",
                    entity_id: id,
                    table_name: "users",
                    values: { a: 2 },
                    previous_values: { a: 1 },
                    updated_at: new Date()
                }
            ]);

            // Trigger prune by inserting a new one
            await customHistoryService.recordHistory({ action: "update",
id,
tableName: "users",
values: { a: 3 },
previousValues: { a: 2 } });

            const history = await historySettlesAt(db, COLLECTION_NAME, id, 2);

            // The record from twoDaysAgo should be deleted
            expect(history).toHaveLength(2);
            expect(history[0].values).toEqual({ a: 2 });
            expect(history[1].values).toEqual({ a: 3 });
        });
    });
});
