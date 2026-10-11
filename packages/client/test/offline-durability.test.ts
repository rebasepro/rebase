import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { OfflineManager } from "../src/offline";
import { IndexedDBOfflineStore, MemoryOfflineStore, QUEUE_SCHEMA_VERSION, type PendingMutation } from "../src/offline-store";
import { fakeServer, restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

/**
 * What the offline database does to survive: the browser evicting it, an older
 * build opening it, an older build finding writes it cannot read
 * (docs/audits/34-offline-sync.md, M8).
 */

afterEach(() => {
    restoreNavigator();
    jest.restoreAllMocks();
});

describe("the browser keeping the offline database (M8)", () => {
    it("is asked once, when the first write is queued, and the answer is on the status", async () => {
        const persist = jest.fn(async () => false);
        Object.defineProperty(globalThis, "navigator", {
            value: { onLine: false, storage: { persist } },
            configurable: true,
            writable: true
        });
        const server = fakeServer();
        const offline = new OfflineManager({ store: new IndexedDBOfflineStore(), syncIntervalMs: 0, crossTab: false }, () => server.client);
        const posts = offline.wrap("posts", server.client);
        expect(persist).not.toHaveBeenCalled();

        await posts.create({ title: "a" });
        await posts.create({ title: "b" });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(persist).toHaveBeenCalledTimes(1);
        expect(offline.api.status().persisted).toBe(false);
    });
});

describe("a database written by a newer version (M8)", () => {
    it("is left alone, and this page keeps working in memory", async () => {
        // A newer build upgraded the database past this one's version.
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("rebase-offline", 99);
            request.onsuccess = () => { request.result.close(); resolve(); };
            request.onerror = () => reject(request.error);
        });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const store = new IndexedDBOfflineStore();

        await store.setCache("anon|row|posts|1", { value: { id: "1" }, cachedAt: 1 });
        await expect(store.getCache("anon|row|posts|1")).resolves.toEqual({ value: { id: "1" }, cachedAt: 1 });
        await store.listQueue("anon|");
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("a queued write in a layout from a newer version (M8)", () => {
    it("is not replayed, and holds back what was queued after it", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "a" });
        const store = new MemoryOfflineStore();
        const newer: PendingMutation = {
            mutationId: "0000000001-0001-aaaaaaaa",
            collection: "posts",
            type: "update",
            id: "1",
            data: { title: "from the future" },
            queuedAt: 1,
            schemaVersion: QUEUE_SCHEMA_VERSION + 1
        };
        await store.enqueue(`anon|${newer.mutationId}`, newer);
        const offline = new OfflineManager({ store, syncIntervalMs: 0 }, () => server.client);
        const posts = offline.wrap("posts", server.client);
        setNavigatorOnLine(false);
        await posts.update("1", { title: "b" });
        setNavigatorOnLine(true);

        expect(await offline.sync()).toEqual({ flushed: 0, remaining: 2 });
        expect(server.calls.filter((call) => call.op === "update")).toEqual([]);
        expect(offline.api.status().lastError).toContain("newer version");
    });

    it("this version's own entries carry the version they were written in", async () => {
        const server = fakeServer();
        const store = new MemoryOfflineStore();
        const offline = new OfflineManager({ store, syncIntervalMs: 0 }, () => server.client);
        const posts = offline.wrap("posts", server.client);
        setNavigatorOnLine(false);
        await posts.create({ title: "a" });
        const [queued] = await store.listQueue("anon|");
        expect(queued.schemaVersion).toBe(QUEUE_SCHEMA_VERSION);
    });
});
