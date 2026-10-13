import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { isUnsupported } from "@rebasepro/types";
import { RebaseWebSocketClient } from "../src/websocket";
import { createCollectionClient } from "../src/collection";
import type { Transport } from "../src/transport";
import { FaultServer, type Frame, type Responder } from "./support/fault-socket";

/**
 * `listenCount()`: a collection's count, live.
 *
 * A count was a one-shot read, so a list's total and a "select all N" offer
 * went stale as soon as anyone else added or removed a row. The SDK now
 * subscribes to the count itself: `subscribe_collection` with `countOnly`,
 * which a server that knows it answers without reading any rows — `rows: []`
 * and `meta.total`. An older server ignores the key and answers the `limit: 1`
 * the SDK also sends, with the same `meta`; one older still, with no `meta`,
 * is asked with `count()` instead.
 */

let clients: RebaseWebSocketClient[] = [];

function transportCounting(total: number): { transport: Transport; counted: jest.Mock } {
    const counted = jest.fn();
    const request: Transport["request"] = async (path) => {
        counted(path);
        return { count: total } as never;
    };
    const transport: Transport = {
        request,
        baseUrl: "http://localhost",
        apiPath: "/api",
        fetchFn: globalThis.fetch,
        setToken: () => undefined,
        setAuthTokenGetter: () => undefined,
        getHeaders: () => ({}),
        resolveToken: async () => null
    };
    return { transport, counted };
}

function setup(responder: Responder, restTotal = 0) {
    const server = new FaultServer(responder);
    const ws = new RebaseWebSocketClient({ websocketUrl: "ws://test", WebSocket: server.WebSocket });
    clients.push(ws);
    const { transport, counted } = transportCounting(restTotal);
    const posts = createCollectionClient<Record<string, unknown>>(transport, "posts", ws);
    return { server, posts, counted };
}

/** A server that knows `countOnly`: no rows, the total in `meta`. */
const countingServer = (total: () => number): Responder => (frame) => frame.type === "subscribe_collection"
    ? [{
        type: "collection_update",
        subscriptionId: String(frame.payload?.subscriptionId),
        rows: frame.payload?.countOnly === true ? [] : [{ id: "1" }],
        meta: { total: total(), limit: 1, offset: 0, hasMore: total() > 1 }
    }]
    : [];

const subscribeFrames = (server: FaultServer): Frame[] => server.receivedOfType("subscribe_collection");

describe("listenCount", () => {
    beforeEach(() => {
        clients = [];
        jest.useFakeTimers();
        for (const level of ["log", "debug", "warn", "error"] as const) {
            jest.spyOn(console, level).mockImplementation(() => undefined);
        }
    });

    afterEach(() => {
        for (const client of clients) client.disconnect(true);
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("asks for the count alone, and reports each new total once", async () => {
        let total = 5;
        const { server, posts } = setup(countingServer(() => total));
        const totals: number[] = [];
        posts.listenCount({ where: { status: ["==", "active"] }, searchString: "x", limit: 20, orderBy: "title" }, (n) => totals.push(n));
        await jest.advanceTimersByTimeAsync(50);

        expect(subscribeFrames(server)[0].payload).toMatchObject({
            path: "posts", filter: { status: ["==", "active"] }, searchString: "x", limit: 1, countOnly: true
        });
        // The window and the sort do not change a count.
        expect(subscribeFrames(server)[0].payload).not.toHaveProperty("orderBy");
        expect(totals).toEqual([5]);

        const subscriptionId = String(subscribeFrames(server)[0].payload?.subscriptionId);
        const push = (n: number) => server.broadcast({ type: "collection_update", subscriptionId, rows: [], meta: { total: n, limit: 1, offset: 0, hasMore: true } });
        push(6);
        push(6);
        total = 7;
        push(7);
        await jest.advanceTimersByTimeAsync(10);
        expect(totals).toEqual([5, 6, 7]);
    });

    it("against a server that ignores countOnly, the one row it reads carries the same total", async () => {
        const oldServer: Responder = (frame) => frame.type === "subscribe_collection"
            ? [{ type: "collection_update", subscriptionId: String(frame.payload?.subscriptionId), rows: [{ id: "1" }], meta: { total: 12, limit: 1, offset: 0, hasMore: true } }]
            : [];
        const { posts } = setup(oldServer);
        const totals: number[] = [];
        posts.listenCount(undefined, (n) => totals.push(n));
        await jest.advanceTimersByTimeAsync(50);
        expect(totals).toEqual([12]);
    });

    it("against a server whose frames carry no meta, it counts over REST on each frame", async () => {
        const noMeta: Responder = (frame) => frame.type === "subscribe_collection"
            ? [{ type: "collection_update", subscriptionId: String(frame.payload?.subscriptionId), rows: [{ id: "1" }] }]
            : [];
        const { posts, counted } = setup(noMeta, 9);
        const totals: number[] = [];
        posts.listenCount(undefined, (n) => totals.push(n));
        await jest.advanceTimersByTimeAsync(50);
        expect(counted).toHaveBeenCalled();
        expect(totals).toEqual([9]);
    });

    it("keeps the last total when a frame's count failed", async () => {
        const { server, posts } = setup(countingServer(() => 3));
        const totals: number[] = [];
        posts.listenCount(undefined, (n) => totals.push(n));
        await jest.advanceTimersByTimeAsync(50);
        const subscriptionId = String(subscribeFrames(server)[0].payload?.subscriptionId);
        server.broadcast({ type: "collection_update", subscriptionId, rows: [], meta: { limit: 1, offset: 0, hasMore: false, partial: true } });
        await jest.advanceTimersByTimeAsync(10);
        expect(totals).toEqual([3]);
    });

    it("is a stub that says why on a client with no socket", () => {
        const { transport } = transportCounting(0);
        const posts = createCollectionClient<Record<string, unknown>>(transport, "posts");
        expect(isUnsupported(posts.listenCount)).toBe(true);
    });
});
