/**
 * Row security on the MongoDB realtime paths.
 *
 * Subscriptions reach the data through a different door than HTTP reads, and
 * both of the doors were unlocked: `notifyUpdate` pushed the row exactly as
 * saved to every single-document subscriber, and a subscription without an auth
 * context re-fetched through the repository — below the driver, where no rule is
 * applied — which is the fallback branch granting more than the primary one.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { CollectionConfig, User } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";

const notes: CollectionConfig = {
    slug: "notes",
    name: "Notes (MongoDB)",
    engine: "mongodb",
    properties: {
        title: { name: "Title",
type: "string" },
        owner_id: { name: "Owner",
type: "string" }
    },
    securityRules: [{ name: "own_notes",
operations: ["all"],
ownerField: "owner_id" }]
};

const alice = { uid: "alice",
roles: [] } as unknown as User;

/**
 * Let the fire-and-forget fetches inside a subscribe/notify call settle.
 *
 * `subscribeToOne` dispatches its initial fetch without awaiting it, so a
 * single tick is not enough — the fetch is a round trip to MongoDB.
 */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

describe("MongoDB realtime row authorization", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtimeService: MongoRealtimeService;
    let driver: MongoDriver;
    let aliceNoteId: string;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_realtime_auth");
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        for (const col of await db.listCollections().toArray()) {
            await db.dropCollection(col.name);
        }
        const registry = new MongoCollectionRegistry();
        registry.register(notes);
        realtimeService = new MongoRealtimeService(db);
        driver = new MongoDriver(db, realtimeService, undefined, registry);

        const inserted = await db.collection("notes").insertMany([
            { _id: new ObjectId(), title: "Alice's", owner_id: "alice" },
            // A row the subscriber must never see. Without it, "returns every
            // row" and "returns the one row you own" are the same assertion.
            { _id: new ObjectId(), title: "Bob's", owner_id: "bob" }
        ]);
        aliceNoteId = inserted.insertedIds[0].toString();
    });

    afterEach(async () => {
        await realtimeService.closeAll();
    });

    it("does not push a document to a subscriber the rule excludes", async () => {
        const received: (Record<string, unknown> | null)[] = [];
        realtimeService.subscribeToOne(
            "sub-bob",
            { clientId: "c1", path: "notes", id: aliceNoteId, authContext: { uid: "bob", roles: [] } },
            (row) => received.push(row)
        );
        await settle();

        // The push after a save. It used to hand over the row verbatim.
        await realtimeService.notifyUpdate("notes", aliceNoteId, {
            id: aliceNoteId, title: "Alice's", owner_id: "alice"
        });
        await settle();

        expect(received.every(r => r === null)).toBe(true);
    });

    it("still pushes the document to its owner", async () => {
        const received: (Record<string, unknown> | null)[] = [];
        realtimeService.subscribeToOne(
            "sub-alice",
            { clientId: "c1", path: "notes", id: aliceNoteId, authContext: { uid: "alice", roles: [] } },
            (row) => received.push(row)
        );
        await settle();

        await realtimeService.notifyUpdate("notes", aliceNoteId, {
            id: aliceNoteId, title: "Alice's", owner_id: "alice"
        });
        await settle();

        expect(received.some(r => r?.title === "Alice's")).toBe(true);
    });

    it("still reports a deletion, which carries no row to authorize", async () => {
        const received: (Record<string, unknown> | null)[] = [];
        realtimeService.subscribeToOne(
            "sub-alice-delete",
            { clientId: "c1", path: "notes", id: aliceNoteId, authContext: { uid: "alice", roles: [] } },
            (row) => received.push(row)
        );
        await settle();

        await realtimeService.notifyUpdate("notes", aliceNoteId, null);
        await settle();

        expect(received[received.length - 1]).toBeNull();
    });

    it("applies the rules to a subscription that carries no auth context", async () => {
        const received: Record<string, unknown>[][] = [];
        realtimeService.subscribeToCollection(
            "sub-anon",
            { clientId: "c1", path: "notes" },
            (rows) => received.push(rows)
        );
        await settle();

        expect(received).toEqual([[]]);
    });

    it("carries the acting user from the driver into the subscription", async () => {
        // The wrapper used to stamp `authContext` onto the `Subscription`
        // object; every fetch reads `config.authContext`, so the subscription
        // re-fetched as nobody — and the initial fetch had already gone out.
        const scoped = await driver.withAuth(alice);
        // `listenCollection` is optional on the driver interface. If scoping
        // ever drops it, the subscription this test is about cannot be made at
        // all — so say that, rather than asserting it away with `!`.
        if (!scoped.listenCollection) throw new Error("withAuth() returned a driver with no listenCollection");
        const seen: Record<string, unknown>[][] = [];
        const unsubscribe = scoped.listenCollection({
            path: "notes",
            collection: notes,
            onUpdate: (rows) => seen.push(rows),
            onError: () => undefined
        });
        await settle();
        unsubscribe();

        expect(seen[0]?.map(r => r.title)).toEqual(["Alice's"]);
    });
});
