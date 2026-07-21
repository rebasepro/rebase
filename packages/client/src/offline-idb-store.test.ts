import "fake-indexeddb/auto";
import { IndexedDBOfflineStore, PendingMutation } from "./offline-store";
import { OfflineManager } from "./offline";
import { RebaseApiError } from "./transport";
import type { CollectionClient } from "./collection";

/**
 * The IndexedDB store against fake-indexeddb — the same structured-clone
 * semantics and key ordering as a real browser, without one. All tests share
 * one fake database (like real tabs share one), so each uses its own key
 * prefix; the prefix isolation test is exactly what makes that safe.
 */
describe("IndexedDBOfflineStore", () => {
    const store = new IndexedDBOfflineStore();

    function mutation(scope: string, seq: number, extra: Partial<PendingMutation> = {}): PendingMutation {
        return {
            seq,
            collection: "posts",
            type: "create",
            id: `id-${seq}`,
            data: { id: `id-${seq}` },
            queuedAt: Date.now(),
            ...extra
        };
    }

    function queueKey(scope: string, seq: number): string {
        return `${scope}|${String(seq).padStart(16, "0")}`;
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

    it("returns the queue in seq order even when written out of order", async () => {
        await store.enqueue(queueKey("t5", 2), mutation("t5", 2));
        await store.enqueue(queueKey("t5", 10), mutation("t5", 10));
        await store.enqueue(queueKey("t5", 1), mutation("t5", 1));

        const queue = await store.listQueue("t5|");
        expect(queue.map((m) => m.seq)).toEqual([1, 2, 10]);
    });

    it("dequeues a single mutation", async () => {
        await store.enqueue(queueKey("t6", 1), mutation("t6", 1));
        await store.enqueue(queueKey("t6", 2), mutation("t6", 2));
        await store.dequeue(queueKey("t6", 1));
        expect((await store.listQueue("t6|")).map((m) => m.seq)).toEqual([2]);
    });

    it("clear() removes one prefix's cache and queue and nothing else", async () => {
        await store.setCache("t7a|find|posts|", { value: 1, cachedAt: 1 });
        await store.enqueue(queueKey("t7a", 1), mutation("t7a", 1));
        await store.setCache("t7b|find|posts|", { value: 2, cachedAt: 2 });
        await store.enqueue(queueKey("t7b", 1), mutation("t7b", 1));

        await store.clear("t7a|");

        expect(await store.getCache("t7a|find|posts|")).toBeUndefined();
        expect(await store.listQueue("t7a|")).toHaveLength(0);
        expect(await store.getCache("t7b|find|posts|")).toBeDefined();
        expect(await store.listQueue("t7b|")).toHaveLength(1);
    });

    it("persists across store instances", async () => {
        await store.setCache("t8|find|posts|", { value: 42, cachedAt: 1 });
        await store.enqueue(queueKey("t8", 1), mutation("t8", 1));

        const reopened = new IndexedDBOfflineStore();
        expect((await reopened.getCache("t8|find|posts|"))?.value).toBe(42);
        expect(await reopened.listQueue("t8|")).toHaveLength(1);
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
