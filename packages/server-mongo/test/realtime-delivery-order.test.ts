/**
 * What a subscriber is told last must be what is true last.
 *
 * Every update a MongoDB subscription delivers is a full re-fetch, and three
 * things start one for the same subscription independently: the initial fetch
 * at subscribe time, the change stream, and `notifyUpdate` after a save. None
 * of them waited for the others, so a fetch that started earlier could finish
 * later — and the callback replaces the client's whole list, so the client went
 * back to the state before the change and stayed there until something else
 * happened to that collection.
 *
 * Two neighbours of the same shape: a fetch in flight when the subscription is
 * cancelled still delivered (to a client that stopped listening), and because
 * `subscribeToCollection` unsubscribes before re-registering, the same id could
 * name a *different* subscription by the time an old fetch landed — delivering
 * the previous filter's rows to the new subscriber.
 *
 * Deferred fetches rather than timing: the interleaving is chosen by the test,
 * so nothing here depends on which one a real database would win.
 */
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const defer = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
};

/** A change stream whose events the test fires by hand. */
const makeChangeStream = () => {
    const handlers: Record<string, ((arg: any) => void)[]> = {};
    return {
        on(event: string, handler: (arg: any) => void) {
            (handlers[event] ??= []).push(handler);
            return this;
        },
        close: async () => undefined,
        fire(event: string, arg?: any) {
            for (const h of handlers[event] ?? []) h(arg);
        }
    };
};

const setup = () => {
    const changeStream = makeChangeStream();
    const db = { collection: () => ({ watch: () => changeStream }) };

    const collectionFetches: Deferred<Record<string, unknown>[]>[] = [];
    const oneFetches: Deferred<Record<string, unknown> | null>[] = [];

    const scoped = {
        fetchCollection: () => {
            const d = defer<Record<string, unknown>[]>();
            collectionFetches.push(d);
            return d.promise;
        },
        fetchOne: () => {
            const d = defer<Record<string, unknown> | null>();
            oneFetches.push(d);
            return d.promise;
        }
    };
    const driver = {
        registry: { getCollectionByPath: () => undefined },
        withAuth: () => scoped
    };

    const service = new MongoRealtimeService(db as any);
    service.setDataDriver(driver as any);

    return { service, changeStream, collectionFetches, oneFetches };
};

/** Let the awaits inside a fire-and-forget fetch run to completion. */
const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("MongoDB realtime delivery order", () => {

    it("does not let the initial fetch overwrite a newer one", async () => {
        const { service, changeStream, collectionFetches } = setup();
        const seen: Record<string, unknown>[][] = [];

        service.subscribeToCollection("s1", { path: "notes" } as any, rows => seen.push(rows));
        await settle();
        changeStream.fire("change", { operationType: "update" });
        await settle();

        expect(collectionFetches).toHaveLength(2);

        // The change-driven fetch answers first; the initial one straggles.
        collectionFetches[1].resolve([{ title: "after the change" }]);
        await settle();
        collectionFetches[0].resolve([{ title: "before the change" }]);
        await settle();

        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual([{ title: "after the change" }]);
    });

    it("delivers nothing to a subscription cancelled while a fetch was in flight", async () => {
        const { service, collectionFetches } = setup();
        const seen: unknown[] = [];

        service.subscribeToCollection("s1", { path: "notes" } as any, rows => seen.push(rows));
        await settle();
        service.unsubscribe("s1");

        collectionFetches[0].resolve([{ title: "too late" }]);
        await settle();

        expect(seen).toEqual([]);
    });

    it("does not deliver an old subscription's rows to a new one with the same id", async () => {
        const { service, collectionFetches } = setup();
        const first: unknown[] = [];
        const second: unknown[] = [];

        service.subscribeToCollection("s1", { path: "notes", filter: { done: ["==", false] } } as any,
            rows => first.push(rows));
        await settle();
        // Same id, different filter — `subscribeToCollection` unsubscribes first.
        service.subscribeToCollection("s1", { path: "notes", filter: { done: ["==", true] } } as any,
            rows => second.push(rows));
        await settle();

        collectionFetches[0].resolve([{ title: "matched the old filter" }]);
        await settle();

        expect(first).toEqual([]);
        expect(second).toEqual([]);

        collectionFetches[1].resolve([{ title: "matched the new filter" }]);
        await settle();

        expect(second).toEqual([[{ title: "matched the new filter" }]]);
    });

    it("does not resurrect a deleted row from a fetch still in flight", async () => {
        const { service, changeStream, oneFetches } = setup();
        const seen: unknown[] = [];

        service.subscribeToOne("s1", { path: "notes", id: "n1" } as any, row => seen.push(row));
        await settle();
        oneFetches[0].resolve({ id: "n1", title: "first" });
        await settle();
        expect(seen).toEqual([{ id: "n1", title: "first" }]);

        // An update starts a re-fetch; the row is deleted before it answers.
        changeStream.fire("change", { operationType: "update" });
        await settle();
        expect(oneFetches).toHaveLength(2);

        changeStream.fire("change", { operationType: "delete" });
        await settle();
        expect(seen[seen.length - 1]).toBeNull();

        oneFetches[1].resolve({ id: "n1", title: "the row as it was" });
        await settle();

        expect(seen[seen.length - 1]).toBeNull();
    });

    it("still delivers the ordinary case", async () => {
        const { service, changeStream, collectionFetches } = setup();
        const seen: unknown[] = [];

        service.subscribeToCollection("s1", { path: "notes" } as any, rows => seen.push(rows));
        await settle();
        collectionFetches[0].resolve([{ title: "initial" }]);
        await settle();

        changeStream.fire("change", { operationType: "insert" });
        await settle();
        collectionFetches[1].resolve([{ title: "initial" }, { title: "added" }]);
        await settle();

        expect(seen).toEqual([
            [{ title: "initial" }],
            [{ title: "initial" }, { title: "added" }]
        ]);
    });
});
