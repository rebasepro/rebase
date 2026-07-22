import "fake-indexeddb/auto";
import { IndexedDBOfflineStore, PendingMutation } from "./offline-store";
import { OfflineManager } from "./offline";
import { RebaseApiError } from "./transport";
import { dehydrateRow, hydrateRow } from "./offline-codec";
import { EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/types";
import type { CollectionClient } from "./collection";

/**
 * The IndexedDB store against fake-indexeddb — the same structured-clone
 * semantics and key ordering as a real browser, without one. All tests share
 * one fake database (like real tabs share one), so each uses its own key
 * prefix; the prefix isolation test is exactly what makes that safe.
 */
describe("IndexedDBOfflineStore", () => {
    const store = new IndexedDBOfflineStore();

    function mutation(seq: number, extra: Partial<PendingMutation> = {}): PendingMutation {
        return {
            mutationId: String(seq).padStart(10, "0"),
            collection: "posts",
            type: "create",
            id: `id-${seq}`,
            data: { id: `id-${seq}` },
            queuedAt: Date.now(),
            ...extra
        };
    }

    function queueKey(scope: string, seq: number): string {
        return `${scope}|${String(seq).padStart(10, "0")}`;
    }

    it("round-trips cache entries, including Date values", async () => {
        const createdAt = new Date("2026-07-01T12:00:00Z");
        await store.setCache("t1|find|posts|", { value: { data: [{ id: "p1", createdAt }] }, cachedAt: 111 });

        const entry = await store.getCache("t1|find|posts|");
        expect(entry?.cachedAt).toBe(111);
        const row = (entry?.value as { data: { id: string; createdAt: Date }[] }).data[0];
        // Not toBeInstanceOf: fake-indexeddb clones through another realm, so
        // the constructor identity differs while the value is a real Date.
        expect(Object.prototype.toString.call(row.createdAt)).toBe("[object Date]");
        expect(row.createdAt.toISOString()).toBe(createdAt.toISOString());
    });

    it("returns undefined for a missing cache key", async () => {
        expect(await store.getCache("t2|nope")).toBeUndefined();
    });

    it("lists only the keys under a prefix, with their write times", async () => {
        await store.setCache("t3|find|posts|a", { value: 1, cachedAt: 10 });
        await store.setCache("t3|find|posts|b", { value: 2, cachedAt: 20 });
        await store.setCache("t3|find|users|a", { value: 3, cachedAt: 30 });

        const listed = await store.listCache("t3|find|posts|");
        expect(listed.map((e) => e.key).sort()).toEqual(["t3|find|posts|a", "t3|find|posts|b"]);
        expect(listed.find((e) => e.key.endsWith("|a"))?.cachedAt).toBe(10);
    });

    it("deletes several cache keys at once", async () => {
        await store.setCache("t4|x", { value: 1, cachedAt: 1 });
        await store.setCache("t4|y", { value: 2, cachedAt: 2 });
        await store.deleteCache(["t4|x", "t4|y"]);
        expect(await store.getCache("t4|x")).toBeUndefined();
        expect(await store.getCache("t4|y")).toBeUndefined();
    });

    it("returns the queue in mutation-id order even when written out of order", async () => {
        await store.enqueue(queueKey("t5", 2), mutation(2));
        await store.enqueue(queueKey("t5", 10), mutation(10));
        await store.enqueue(queueKey("t5", 1), mutation(1));

        const queue = await store.listQueue("t5|");
        expect(queue.map((m) => m.id)).toEqual(["id-1", "id-2", "id-10"]);
    });

    it("dequeues a single mutation", async () => {
        await store.enqueue(queueKey("t6", 1), mutation(1));
        await store.enqueue(queueKey("t6", 2), mutation(2));
        await store.dequeue(queueKey("t6", 1));
        expect((await store.listQueue("t6|")).map((m) => m.id)).toEqual(["id-2"]);
    });

    it("clear() removes one prefix's cache and queue and nothing else", async () => {
        await store.setCache("t7a|find|posts|", { value: 1, cachedAt: 1 });
        await store.enqueue(queueKey("t7a", 1), mutation(1));
        await store.setCache("t7b|find|posts|", { value: 2, cachedAt: 2 });
        await store.enqueue(queueKey("t7b", 1), mutation(1));

        await store.clear("t7a|");

        expect(await store.getCache("t7a|find|posts|")).toBeUndefined();
        expect(await store.listQueue("t7a|")).toHaveLength(0);
        expect(await store.getCache("t7b|find|posts|")).toBeDefined();
        expect(await store.listQueue("t7b|")).toHaveLength(1);
    });

    it("persists across store instances", async () => {
        await store.setCache("t8|find|posts|", { value: 42, cachedAt: 1 });
        await store.enqueue(queueKey("t8", 1), mutation(1));

        const reopened = new IndexedDBOfflineStore();
        expect((await reopened.getCache("t8|find|posts|"))?.value).toBe(42);
        expect(await reopened.listQueue("t8|")).toHaveLength(1);
    });

    it("writes a batch in one transaction and reads the values back by prefix", async () => {
        await store.setCacheMany([
            { key: "t9|row|posts|a", entry: { value: { id: "a", n: 1 }, cachedAt: 5 } },
            { key: "t9|row|posts|b", entry: { value: { id: "b", n: 2 }, cachedAt: 6 } },
            { key: "t9|row|users|c", entry: { value: { id: "c" }, cachedAt: 7 } }
        ]);

        const entries = await store.listCacheEntries("t9|row|posts|");
        expect(entries.map((e) => e.key)).toEqual(["t9|row|posts|a", "t9|row|posts|b"]);
        expect(entries.map((e) => (e.value as { n: number }).n)).toEqual([1, 2]);
        expect(entries[1].cachedAt).toBe(6);
    });
});

describe("row codec round-trip", () => {
    /**
     * Both stores move values by structured clone, which keeps `Date` but
     * flattens class instances. A row read back from the cache has to be
     * indistinguishable from the same row read from the network, or an app
     * that calls `row.point.latitude` works online and throws offline.
     */
    it("survives the store as the same shapes it went in as", async () => {
        const store = new IndexedDBOfflineStore();
        const row = {
            id: "r1",
            at: new Date("2026-07-01T00:00:00Z"),
            point: new GeoPoint(41.4, 2.2),
            embedding: new Vector([0.1, 0.2]),
            author: new EntityReference({ id: "u1", path: "users" }),
            tag: new EntityRelation("t1", "tags"),
            nested: { deep: [new GeoPoint(1, 2)] },
            plain: "text"
        };

        await store.setCache("codec|row|things|r1", { value: dehydrateRow(row), cachedAt: 1 });
        const back = hydrateRow((await store.getCache("codec|row|things|r1"))!.value as Record<string, unknown>);

        expect(back.point).toBeInstanceOf(GeoPoint);
        expect((back.point as GeoPoint).latitude).toBe(41.4);
        expect(back.embedding).toBeInstanceOf(Vector);
        expect((back.embedding as Vector).value).toEqual([0.1, 0.2]);
        expect(back.author).toBeInstanceOf(EntityReference);
        expect((back.author as EntityReference).pathWithId).toBe("users/u1");
        expect(back.tag).toBeInstanceOf(EntityRelation);
        expect(((back.nested as { deep: GeoPoint[] }).deep[0])).toBeInstanceOf(GeoPoint);
        expect(Object.prototype.toString.call(back.at)).toBe("[object Date]");
        expect(back.plain).toBe("text");
    });
});

describe("two tabs over one database", () => {
    /** BroadcastChannel delivery is asynchronous; give it a macrotask or two. */
    const settle = async () => {
        for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    };

    function createServer() {
        const table = new Map<string, Record<string, unknown>>();
        const state = { online: true };
        const client = {
            async find() {
                if (!state.online) throw new TypeError("fetch failed");
                const data = [...table.values()];
                return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
            },
            async findById(id: string | number) {
                if (!state.online) throw new TypeError("fetch failed");
                return table.get(String(id));
            },
            async create(data: Record<string, unknown>) {
                if (!state.online) throw new TypeError("fetch failed");
                table.set(String(data.id), data);
                return data;
            },
            async createMany() { throw new RebaseApiError("unused", { status: 500 }); },
            async update() { throw new RebaseApiError("unused", { status: 500 }); },
            async delete() { throw new RebaseApiError("unused", { status: 500 }); },
            async count() { return table.size; }
        } as unknown as CollectionClient<Record<string, unknown>>;
        return { table, state, client };
    }

    /**
     * Web Locks is how two tabs avoid replaying the same queue at the same
     * time. Node has no implementation, so this is the browser's — a plain
     * mutex keyed by name, which is all the manager asks of it.
     */
    function installWebLocks(): () => void {
        const held = new Map<string, Promise<unknown>>();
        const locks = {
            request: (name: string, fn: () => Promise<unknown>) => {
                const previous = held.get(name) ?? Promise.resolve();
                const next = previous.then(fn, fn);
                held.set(name, next.then(() => undefined, () => undefined));
                return next;
            }
        };
        Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
        return () => { delete (globalThis.navigator as { locks?: unknown }).locks; };
    }

    it("shows one tab's offline write in the other, and queues it only once", async () => {
        const uninstall = installWebLocks();
        const server = createServer();
        const tabA = new OfflineManager({ store: new IndexedDBOfflineStore(), syncIntervalMs: 0 }, () => server.client);
        const tabB = new OfflineManager({ store: new IndexedDBOfflineStore(), syncIntervalMs: 0 }, () => server.client);
        const postsA = tabA.wrap("xtab", server.client);
        const postsB = tabB.wrap("xtab", server.client);

        await postsA.find();
        await postsB.find();

        server.state.online = false;
        await postsA.create({ title: "from tab A" }, "xt1");
        await settle();

        // Without cross-tab propagation this tab would be showing a list that
        // is already wrong, and would keep showing it until a refetch.
        expect((await postsB.find()).data.map((r) => r.id)).toContain("xt1");
        expect(await tabB.api.pending()).toHaveLength(1);

        // Both tabs share the queue, so the write must reach the server once —
        // the lock serialises them, and the loser re-reads a drained queue.
        server.state.online = true;
        const [a, b] = await Promise.all([tabA.sync(), tabB.sync()]);
        expect(a.flushed + b.flushed).toBe(1);
        expect(server.table.get("xt1")).toMatchObject({ title: "from tab A" });

        tabA.dispose();
        tabB.dispose();
        uninstall();
    });
});

describe("OfflineManager over IndexedDB", () => {
    it("queues offline writes in one manager and replays them from a fresh one", async () => {
        const table = new Map<string, Record<string, unknown>>();
        const state = { online: true };
        const fakeClient = {
            async find() {
                if (!state.online) throw new TypeError("fetch failed");
                const data = [...table.values()];
                return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
            },
            async findById(id: string | number) {
                if (!state.online) throw new TypeError("fetch failed");
                return table.get(String(id));
            },
            async create(data: Record<string, unknown>) {
                if (!state.online) throw new TypeError("fetch failed");
                table.set(String(data.id), data);
                return data;
            },
            async createMany() { throw new RebaseApiError("unused", { status: 500 }); },
            async update() { throw new RebaseApiError("unused", { status: 500 }); },
            async delete() { throw new RebaseApiError("unused", { status: 500 }); },
            async count() { return table.size; }
        } as unknown as CollectionClient<Record<string, unknown>>;

        const first = new OfflineManager(
            { store: new IndexedDBOfflineStore(), syncIntervalMs: 0 },
            () => fakeClient
        );
        state.online = false;
        const posts = first.wrap("posts", fakeClient);
        const row = await posts.create({ title: "persisted offline" });
        expect(await posts.findById(row.id as string)).toMatchObject({ title: "persisted offline" });
        first.dispose();

        state.online = true;
        const second = new OfflineManager(
            { store: new IndexedDBOfflineStore(), syncIntervalMs: 0 },
            () => fakeClient
        );
        expect(await second.sync()).toEqual({ flushed: 1, remaining: 0 });
        expect(table.get(String(row.id))).toMatchObject({ title: "persisted offline" });
        second.dispose();
    });
});
