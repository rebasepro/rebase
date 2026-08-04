import { jest } from "@jest/globals";
import { createCollectionClient, type LiveResult } from "./collection";
import type { Transport } from "./transport";
import type { RebaseWebSocketClient } from "./websocket";

type Row = { id: string; name: string };

/**
 * `observe()` on a client without the offline layer is two sources feeding one
 * callback: a one-shot `find()` and a realtime subscription. Neither of these
 * tests is about the sources — they are about what the callback is allowed to
 * be told, which is the part an app actually depends on.
 */

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Let every already-queued microtask run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function createTransport(handlers: {
    find?: () => Promise<unknown>;
    count?: () => Promise<unknown>;
}): Transport {
    return {
        request: jest.fn<any>((url: string) => {
            if (url.includes("/count")) return handlers.count?.() ?? Promise.resolve({ count: 0 });
            return handlers.find?.() ?? Promise.resolve({ data: [], meta: {} });
        }),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        baseUrl: "http://localhost:3000",
        apiPath: "/api",
        fetchFn: globalThis.fetch,
        getHeaders: () => ({}),
        resolveToken: jest.fn<any>().mockResolvedValue(null)
    } as unknown as Transport;
}

/** A socket whose collection updates this test drives by hand. */
function createWs() {
    let push: ((rows: Record<string, unknown>[]) => void) | undefined;
    const ws = {
        listenCollection: (
            _props: unknown,
            onUpdate: (rows: Record<string, unknown>[]) => void
        ) => {
            push = onUpdate;
            return () => { push = undefined; };
        }
    } as unknown as RebaseWebSocketClient;
    return {
        ws,
        push: (rows: Record<string, unknown>[]) => push?.(rows)
    };
}

describe("observe() without the offline layer", () => {
    it("does not replace a live update with the initial fetch that resolved after it", async () => {
        // The initial `find()` is in flight for the whole test; the socket
        // answers first. This is not exotic — `listenCollection` replays cached
        // rows synchronously when another observer already holds the same
        // subscription, so a second component observing the same query hits it
        // every time.
        const find = deferred<unknown>();
        const transport = createTransport({
            find: () => find.promise,
            count: () => Promise.resolve({ count: 1 })
        });
        const { ws, push } = createWs();
        const client = createCollectionClient<Row>(transport, "products", ws);

        const results: LiveResult<Row>[] = [];
        const stop = client.observe(undefined, (r) => results.push(r));

        push([{ id: "1", name: "live" }]);
        await flush();

        find.resolve({ data: [{ id: "1", name: "stale" }], meta: { total: 1 } });
        await flush();

        expect(results.at(-1)?.data).toEqual([{ id: "1", name: "live" }]);
        stop();
    });

    it("de-duplicates emissions, as the contract on observe() states", async () => {
        const transport = createTransport({
            find: () => Promise.resolve({ data: [{ id: "1", name: "a" }], meta: { total: 1 } }),
            count: () => Promise.resolve({ count: 1 })
        });
        const { ws, push } = createWs();
        const client = createCollectionClient<Row>(transport, "products", ws);

        const results: LiveResult<Row>[] = [];
        const stop = client.observe(undefined, (r) => results.push(r));
        await flush();

        const afterInitial = results.length;

        // Two socket updates carrying exactly the rows the app already has.
        push([{ id: "1", name: "a" }]);
        await flush();
        push([{ id: "1", name: "a" }]);
        await flush();

        expect(results.length).toBe(afterInitial);

        // A real change still gets through.
        push([{ id: "1", name: "b" }]);
        await flush();
        expect(results.length).toBe(afterInitial + 1);
        expect(results.at(-1)?.data).toEqual([{ id: "1", name: "b" }]);
        stop();
    });

    it("stops emitting once unsubscribed, including for a fetch still in flight", async () => {
        const find = deferred<unknown>();
        const transport = createTransport({ find: () => find.promise });
        const client = createCollectionClient<Row>(transport, "products");

        const results: LiveResult<Row>[] = [];
        const stop = client.observe(undefined, (r) => results.push(r));
        stop();

        find.resolve({ data: [{ id: "1", name: "a" }], meta: { total: 1 } });
        await flush();

        expect(results).toHaveLength(0);
    });
});
