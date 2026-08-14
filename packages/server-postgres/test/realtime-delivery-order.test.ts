import { CollectionConfig } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * What a subscriber is told last must be what is true last.
 *
 * Every update a subscription delivers is a full re-fetch, and more than one
 * thing starts one for the same subscription without coordinating: the initial
 * fetch at subscribe time, and a debounced refetch per notification. A fetch
 * that started earlier can finish later, and the delivery replaces everything
 * the subscriber has — so the subscriber goes back to the state before the
 * change and stays there, silently, until the next write to that collection.
 *
 * The debounce is not a fix for it. It collapses a burst into one refetch and
 * does nothing about two refetches that overlap: A's timer fires and starts
 * fetch A, B arrives while A is in flight, B's timer fires 300ms later and
 * starts fetch B regardless. The pre-await `has(subscriptionId)` check the
 * refetches ran answers neither that nor an unsubscribe *during* the fetch.
 * Class 44 in `docs/bug-classes.md`; the MongoDB half is
 * `packages/server-mongo/test/realtime-delivery-order.test.ts`.
 *
 * Deferred fetches rather than timing: the interleaving is chosen here, so
 * nothing depends on which one a real database would win. The seam is the two
 * private `fetch*WithAuth` helpers, because they *are* the awaited fetch these
 * deliveries sit behind — the injected driver is not it (`fetchCollectionWithAuth`
 * reads through a `DataService` built over the transaction).
 *
 * Unlike MongoDB, there is no synchronous delivery here: a deletion arrives as
 * a notification like any other and is answered by a refetch that finds no row,
 * so it claims a slot the ordinary way.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const defer = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
};

describe("Postgres realtime delivery order", () => {

    class MockWebSocket {
        public readyState = 1;
        public send = jest.fn();
        public on = jest.fn();
    }

    const notesCollection: CollectionConfig = {
        slug: "notes",
        name: "Notes",
        table: "notes",
        properties: {
            id: { type: "string",
isId: true },
            title: { type: "string" }
        },
        idField: "id"
    };

    let service: RealtimeService;
    let registry: PostgresCollectionRegistry;
    let ws: MockWebSocket;
    /** One deferred per `fetchCollectionWithAuth` call, in call order. */
    let collectionFetches: Deferred<Record<string, unknown>[]>[];
    /** One deferred per `fetchEntityWithAuth` call, in call order. */
    let entityFetches: Deferred<Record<string, unknown> | undefined>[];

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    const messagesOfType = (type: string) => ws.send.mock.calls
        .map(call => JSON.parse(call[0] as string))
        .filter(message => message.type === type);
    const collectionUpdates = () => messagesOfType("collection_update");
    const singleUpdates = () => messagesOfType("single_update");
    const lastSingleRow = () => singleUpdates()[singleUpdates().length - 1]?.row;

    /** Let the awaits inside an in-flight fetch run to completion. */
    const settle = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    /** Fire the debounce so a scheduled refetch actually starts its fetch. */
    const runDebounce = async () => {
        await jest.advanceTimersByTimeAsync(400);
        await settle();
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.restoreAllMocks();

        collectionFetches = [];
        entityFetches = [];

        const db = {
            execute: jest.fn().mockResolvedValue({ rows: [] })
        } as unknown as jest.Mocked<NodePgDatabase<Record<string, unknown>>>;
        (db as unknown as { transaction: unknown }).transaction =
            jest.fn((callback: (tx: unknown) => unknown) => callback(db));

        registry = new PostgresCollectionRegistry();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("notes") ? notesCollection : undefined);
        jest.spyOn(registry, "getTable").mockImplementation(name =>
            name === "notes" ? table("notes", ["id", "title"]) as never : undefined);

        service = new RealtimeService(
            db,
            registry,
            { defaultDatabaseName: "main" } as never,
            "test-instance",
            { accessTokenSecret: "secret" } as never
        );
        service.setDataDriver({
            fetchCollection: jest.fn().mockResolvedValue([]),
            fetchOne: jest.fn().mockResolvedValue(null)
        } as never);

        jest.spyOn(service as never, "fetchCollectionWithAuth")
            .mockImplementation(() => {
                const d = defer<Record<string, unknown>[]>();
                collectionFetches.push(d);
                return d.promise;
            });
        jest.spyOn(service as never, "fetchEntityWithAuth")
            .mockImplementation(() => {
                const d = defer<Record<string, unknown> | undefined>();
                entityFetches.push(d);
                return d.promise;
            });

        ws = new MockWebSocket();
        service.addClient("client-1", ws as never);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const subscribeCollection = (subscriptionId = "sub-1", filter?: Record<string, unknown>) =>
        service.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: { path: "notes",
subscriptionId,
filter }
        } as never);

    const subscribeOne = (subscriptionId = "sub-1") =>
        service.handleClientMessage("client-1", {
            type: "subscribe_one",
            payload: { path: "notes",
subscriptionId,
id: "n1" }
        } as never);

    const notify = (row: Record<string, unknown> | null = { id: "n1",
title: "changed" }) =>
        service.notifyUpdate("notes", "n1", row, undefined, false);

    it("does not let the initial fetch overwrite a newer refetch", async () => {
        // The subscription is registered before its own fetch runs, so a write
        // in that window produces two fetches with nothing ordering them.
        void subscribeCollection();
        await settle();
        expect(collectionFetches).toHaveLength(1);

        await notify();
        await runDebounce();
        expect(collectionFetches).toHaveLength(2);

        // The change-driven refetch answers first; the initial one straggles.
        collectionFetches[1].resolve([{ id: "n1",
title: "after the change" }]);
        await settle();
        collectionFetches[0].resolve([{ id: "n1",
title: "before the change" }]);
        await settle();

        const updates = collectionUpdates();
        expect(updates).toHaveLength(1);
        expect(updates[0].rows).toEqual([{ id: "n1",
title: "after the change" }]);
    });

    it("does not let an overlapping refetch overwrite a newer one", async () => {
        // The debounce coalesces a burst into one refetch; it does nothing
        // about two refetches that overlap, which is what this is.
        void subscribeCollection();
        await settle();
        collectionFetches[0].resolve([{ id: "n1",
title: "initial" }]);
        await settle();

        await notify();
        await runDebounce();
        expect(collectionFetches).toHaveLength(2); // fetch A, in flight

        await notify();
        await runDebounce();
        expect(collectionFetches).toHaveLength(3); // fetch B, started while A ran

        collectionFetches[2].resolve([{ id: "n1",
title: "B, the newer" }]);
        await settle();
        collectionFetches[1].resolve([{ id: "n1",
title: "A, the older" }]);
        await settle();

        const updates = collectionUpdates();
        expect(updates[updates.length - 1].rows).toEqual([{ id: "n1",
title: "B, the newer" }]);
        expect(updates.map(u => u.rows[0].title)).not.toContain("A, the older");
    });

    it("delivers nothing to a subscription cancelled while a fetch was in flight", async () => {
        void subscribeCollection();
        await settle();
        collectionFetches[0].resolve([{ id: "n1",
title: "initial" }]);
        await settle();
        ws.send.mockClear();

        await notify();
        await runDebounce();
        expect(collectionFetches).toHaveLength(2);

        // Unsubscribed *during* the fetch — the pre-await check cannot see this.
        await service.handleClientMessage("client-1", {
            type: "unsubscribe",
            subscriptionId: "sub-1"
        } as never);

        collectionFetches[1].resolve([{ id: "n1",
title: "too late" }]);
        await settle();

        expect(collectionUpdates()).toEqual([]);
    });

    it("does not deliver an old subscription's rows to a new one with the same id", async () => {
        void subscribeCollection("sub-1", { done: ["==", false] });
        await settle();
        expect(collectionFetches).toHaveLength(1);

        // Same id, different filter: the map entry is replaced, so the fetch
        // still in flight belongs to a subscription that no longer exists.
        void subscribeCollection("sub-1", { done: ["==", true] });
        await settle();
        expect(collectionFetches).toHaveLength(2);

        collectionFetches[0].resolve([{ id: "n1",
title: "matched the old filter" }]);
        await settle();
        expect(collectionUpdates()).toEqual([]);

        collectionFetches[1].resolve([{ id: "n2",
title: "matched the new filter" }]);
        await settle();

        const updates = collectionUpdates();
        expect(updates).toHaveLength(1);
        expect(updates[0].rows).toEqual([{ id: "n2",
title: "matched the new filter" }]);
    });

    it("does not resurrect a deleted row from a fetch still in flight", async () => {
        void subscribeOne();
        await settle();
        entityFetches[0].resolve({ id: "n1",
title: "first" });
        await settle();
        expect(singleUpdates()[0].row).toEqual({ id: "n1",
title: "first" });

        // An update starts a refetch; the row is deleted before it answers.
        await notify();
        await runDebounce();
        expect(entityFetches).toHaveLength(2);

        await notify(null);
        await runDebounce();
        expect(entityFetches).toHaveLength(3);

        entityFetches[2].resolve(undefined); // the deletion's own refetch
        await settle();
        expect(lastSingleRow()).toBeNull();

        entityFetches[1].resolve({ id: "n1",
title: "the row as it was" });
        await settle();

        expect(lastSingleRow()).toBeNull();
    });

    it("still delivers the ordinary case", async () => {
        void subscribeCollection();
        await settle();
        collectionFetches[0].resolve([{ id: "n1",
title: "initial" }]);
        await settle();

        await notify();
        await runDebounce();
        collectionFetches[1].resolve([
            { id: "n1",
title: "initial" },
            { id: "n2",
title: "added" }
        ]);
        await settle();

        expect(collectionUpdates().map(u => u.rows)).toEqual([
            [{ id: "n1",
title: "initial" }],
            [{ id: "n1",
title: "initial" }, { id: "n2",
title: "added" }]
        ]);
    });

    it("orders deliveries to DataDriver callbacks too", async () => {
        // The driver path has its own debounce and its own delivery, and had
        // the same missing check.
        const seen: unknown[] = [];
        service.registerDataDriverSubscription("drv-1", {
            clientId: "driver",
            type: "collection",
            path: "notes",
            collectionRequest: {}
        });
        service.addSubscriptionCallback("drv-1", rows => seen.push(rows));

        await notify();
        await runDebounce();
        expect(collectionFetches).toHaveLength(1);

        await notify();
        await runDebounce();
        expect(collectionFetches).toHaveLength(2);

        collectionFetches[1].resolve([{ id: "n1",
title: "newer" }]);
        await settle();
        collectionFetches[0].resolve([{ id: "n1",
title: "older" }]);
        await settle();

        expect(seen).toEqual([[{ id: "n1",
title: "newer" }]]);
    });
});
