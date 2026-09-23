/**
 * A write reaches every subscriber of the row it changed, whichever path each
 * of them addressed it by.
 *
 * `authors/1/posts` and `posts` are two addresses for the same rows, and the
 * app-level realtime (the path taken without CDC) matched subscriptions by the
 * written path's exact string. A post saved through `authors/1/posts` notified
 * that path and its parents, and never `posts` or `posts/43` — a list of all
 * posts, or an editor open on post 43, did not move. A post saved through
 * `posts` never reached a subscriber of `authors/1/posts`, whose list it may
 * just have joined or left.
 *
 * Every delivery is still a refetch under the subscriber's own scope; this is
 * only about *who is asked to refetch*.
 */
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import type { CollectionConfig } from "@rebasepro/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const mockFetchCollection = jest.fn().mockResolvedValue([{ id: 43, title: "Refetched" }]);
const mockFetchOne = jest.fn().mockResolvedValue({ id: 43, title: "Refetched" });

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: mockFetchCollection,
        fetchOneForRest: mockFetchOne,
        count: jest.fn().mockResolvedValue(1),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

class MockWebSocket {
    public readyState = 1;
    public send = jest.fn();
    public on = jest.fn();
}

const posts: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } }
    }
};

const authors: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        posts: { type: "relation", relation: { kind: "hasMany", target: () => posts, foreignKeyOnTarget: "author_id" } }
    }
};

describe("realtime over nested paths", () => {
    let realtime: RealtimeService;
    let ws: MockWebSocket;

    beforeEach(async () => {
        jest.useFakeTimers();
        const db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db))
        } as unknown as NodePgDatabase<Record<string, never>>;
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([authors, posts]);
        realtime = new RealtimeService(db, registry);

        ws = new MockWebSocket();
        realtime.addClient("client-1", ws as never);
        const subscribe = (type: "subscribe_collection" | "subscribe_one", payload: Record<string, unknown>) =>
            realtime.handleClientMessage("client-1", { type, payload });
        await subscribe("subscribe_collection", { path: "posts", subscriptionId: "all-posts" });
        await subscribe("subscribe_one", { path: "posts", id: "43", subscriptionId: "post-43" });
        await subscribe("subscribe_collection", { path: "authors/1/posts", subscriptionId: "ada-posts" });
        await subscribe("subscribe_one", { path: "authors/1/posts", id: "43", subscriptionId: "ada-post-43" });
        await subscribe("subscribe_one", { path: "posts", id: "44", subscriptionId: "post-44" });
        ws.send.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    /** The subscriptions that received a frame after the debounce. */
    async function refreshed(): Promise<string[]> {
        jest.advanceTimersByTime(350);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        return [...new Set(ws.send.mock.calls
            .map((call: unknown[]) => JSON.parse(String(call[0])) as { subscriptionId?: string })
            .map(frame => frame.subscriptionId)
            .filter((id): id is string => id !== undefined))].sort();
    }

    it("a write through the nested path reaches the root list and the row's own subscribers", async () => {
        await realtime.notifyUpdate("authors/1/posts", "43", { id: 43 }, undefined, false);
        expect(await refreshed()).toEqual(["ada-post-43", "ada-posts", "all-posts", "post-43"]);
    });

    it("a write through the root path reaches the nested list and the nested row subscriber", async () => {
        await realtime.notifyUpdate("posts", "43", { id: 43 }, undefined, false);
        expect(await refreshed()).toEqual(["ada-post-43", "ada-posts", "all-posts", "post-43"]);
    });

    it("with CDC on, the root-table echo of a nested write is not delivered a second time", async () => {
        // Switched on the way `enableCdc()` would, without a LISTEN connection.
        Reflect.set(realtime, "cdcTableMap", Reflect.apply(Reflect.get(realtime, "buildCdcTableMap"), realtime, []));
        Reflect.set(realtime, "cdcActive", true);

        await realtime.notifyUpdate("authors/1/posts", "43", { id: 43 }, undefined, true, "app");
        expect(await refreshed()).toContain("all-posts");
        const delivered = ws.send.mock.calls.length;

        // CDC reports the same commit under the table's own collection.
        await Reflect.apply(Reflect.get(realtime, "handleCdcEvent"), realtime, [
            { schema: "public", table: "posts", op: "UPDATE", row: { id: 43, title: "t" } }
        ]);
        await refreshed();
        expect(ws.send.mock.calls.length).toBe(delivered);
    });

    it("leaves a subscriber of another row alone", async () => {
        await realtime.notifyUpdate("posts", "43", { id: 43 }, undefined, false);
        expect(await refreshed()).not.toContain("post-44");
    });
});
