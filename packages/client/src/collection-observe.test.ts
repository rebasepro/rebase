import { jest } from "@jest/globals";
import { createCollectionClient, type CollectionRealtime, type LiveResult } from "./collection";
import { fakeTransport, type RequestAnswer } from "../test/support/fake-transport";

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
}) {
    const request = jest.fn<RequestAnswer>((url: string) => {
        if (url.includes("/count")) return handlers.count?.() ?? Promise.resolve({ count: 0 });
        return handlers.find?.() ?? Promise.resolve({ data: [], meta: {} });
    });
    return { transport: fakeTransport(request, { baseUrl: "http://localhost:3000" }), request };
}

/** A listener the test does not drive. */
const silent = () => () => undefined;

/** A socket whose collection updates this test drives by hand. */
function createWs() {
    let push: ((rows: Record<string, unknown>[]) => void) | undefined;
    const ws: CollectionRealtime = {
        listenCollection: (_props, onUpdate) => {
            push = onUpdate;
            return () => { push = undefined; };
        },
        listenOne: silent
    };
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
        const { transport, request } = createTransport({
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
        const { transport, request } = createTransport({
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
        const { transport, request } = createTransport({ find: () => find.promise });
        const client = createCollectionClient<Row>(transport, "products");

        const results: LiveResult<Row>[] = [];
        const stop = client.observe(undefined, (r) => results.push(r));
        stop();

        find.resolve({ data: [{ id: "1", name: "a" }], meta: { total: 1 } });
        await flush();

        expect(results).toHaveLength(0);
    });
});

/**
 * A socket that already holds a query's rows hands them to every new
 * subscriber synchronously (`listenCollection`/`listenOne` replay their cached
 * frame). The `find()` an observer used to send beside the subscription could
 * then only be dropped — `deliver` ignores a fetch once the socket has spoken —
 * yet it still went out, and the server ran the query and its `COUNT(*)` for
 * it. Ten components on one query cost ten discarded GETs per mount.
 */
describe("observe() does not fetch what the socket already answered", () => {
    /** A socket holding `rows` for every query and every row, replayed on subscribe. */
    function createReplayingWs(rows: Record<string, unknown>[]) {
        let subscribes = 0;
        const ws: CollectionRealtime = {
            listenCollection: (_props, onUpdate) => {
                subscribes++;
                onUpdate(rows, { total: rows.length, hasMore: false, limit: 20, offset: 0 });
                return () => undefined;
            },
            listenOne: (_props, onUpdate) => {
                subscribes++;
                onUpdate(rows[0] ?? null);
                return () => undefined;
            }
        };
        return { ws, subscribes: () => subscribes };
    }

    it("sends no GET for observers the socket replays to", async () => {
        const { transport, request } = createTransport({
            find: () => Promise.resolve({ data: [{ id: "1", name: "a" }], meta: { total: 1 } })
        });
        const { ws, subscribes } = createReplayingWs([{ id: "1", name: "a" }]);
        const client = createCollectionClient<Row>(transport, "products", ws);

        const results: LiveResult<Row>[][] = Array.from({ length: 10 }, () => []);
        const stops = results.map((into) => client.observe({ limit: 20 }, (r) => into.push(r)));
        await flush();

        expect(subscribes()).toBe(10);
        expect(request).not.toHaveBeenCalled();
        for (const into of results) {
            expect(into).toHaveLength(1);
            expect(into[0].data).toEqual([{ id: "1", name: "a" }]);
        }
        stops.forEach((stop) => stop());
    });

    it("sends no GET for observeById when the socket replays the row", async () => {
        const { transport, request } = createTransport({});
        const { ws } = createReplayingWs([{ id: "1", name: "a" }]);
        const client = createCollectionClient<Row>(transport, "products", ws);

        const rows: (Row | undefined)[][] = Array.from({ length: 10 }, () => []);
        const stops = rows.map((into) => client.observeById("1", (row) => into.push(row)));
        await flush();

        expect(request).not.toHaveBeenCalled();
        for (const into of rows) expect(into).toEqual([{ id: "1", name: "a" }]);
        stops.forEach((stop) => stop());
    });

    it("still fetches when the socket has nothing yet", async () => {
        // The first observer of a query: the subscription is new, so the fetch
        // is the fast path to a first answer and races the subscribe.
        const { transport, request } = createTransport({
            find: () => Promise.resolve({ data: [{ id: "1", name: "a" }], meta: { total: 1 } })
        });
        const { ws } = createWs();
        const client = createCollectionClient<Row>(transport, "products", ws);

        const results: LiveResult<Row>[] = [];
        const stop = client.observe({ limit: 20 }, (r) => results.push(r));
        await flush();

        expect(request).toHaveBeenCalledTimes(1);
        expect(results.map((r) => r.data)).toEqual([[{ id: "1", name: "a" }]]);
        stop();
    });

    it("still fetches when realtime is off", async () => {
        const { transport, request } = createTransport({
            find: () => Promise.resolve({ data: [{ id: "1", name: "a" }], meta: { total: 1 } })
        });
        const { ws } = createReplayingWs([{ id: "1", name: "a" }]);
        const client = createCollectionClient<Row>(transport, "products", ws);

        const results: LiveResult<Row>[] = [];
        const stop = client.observe({ limit: 20 }, (r) => results.push(r), undefined, { realtime: false });
        await flush();

        expect(request).toHaveBeenCalledTimes(1);
        expect(results).toHaveLength(1);
        stop();
    });
});

/**
 * `observeById` reads the row twice — a one-shot `findById` and a `listenById`
 * subscription — and both have to load the same relations. Without `include`
 * a to-many relation was absent from the row, and a form built on it saved
 * the relation as empty.
 */
describe("observeById({ include })", () => {
    it("loads the relations on both the fetch and the subscription", async () => {
        const { transport, request } = createTransport({});
        request.mockImplementation(() => Promise.resolve({ id: "1", name: "a", tags: [] }));
        const listened: unknown[] = [];
        const ws: CollectionRealtime = {
            listenCollection: silent,
            listenOne: (props) => {
                listened.push(props);
                return () => undefined;
            }
        };
        const client = createCollectionClient<Row>(transport, "products", ws);

        const seen: (Row | undefined)[] = [];
        const stop = client.observeById("1", (row) => seen.push(row), undefined, { include: ["tags"] });
        await flush();

        expect(listened).toEqual([{ path: "products", id: "1", include: ["tags"] }]);
        const url = request.mock.calls[0][0];
        expect(decodeURIComponent(url)).toContain("include=tags");
        expect(seen).toEqual([{ id: "1", name: "a", tags: [] }]);
        stop();
    });

    it("loads them on the fetch when realtime is off", async () => {
        const { transport, request } = createTransport({});
        request.mockImplementation(() => Promise.resolve({ id: "1", name: "a" }));
        const client = createCollectionClient<Row>(transport, "products");

        const stop = client.observeById("1", () => undefined, undefined, { include: ["tags"], realtime: false });
        await flush();

        const url = request.mock.calls[0][0];
        expect(decodeURIComponent(url)).toContain("include=tags");
        stop();
    });
});
