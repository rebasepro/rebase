import { jest } from "@jest/globals";
import { DEFAULT_LIST_LIMIT } from "@rebasepro/types";
import { createCollectionClient } from "./collection";
import type { FindResult } from "@rebasepro/types";
import type { Transport } from "./transport";
import type { RebaseWebSocketClient } from "./websocket";

type Row = { id: string };

/**
 * `listen()` gets rows off the socket and has to describe the window they came
 * from itself. Everything it reports is therefore something it decided, and
 * these tests are about which of those decisions are claims it can support.
 */

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function createWs() {
    let push: ((rows: Record<string, unknown>[]) => void) | undefined;
    const ws = {
        listenCollection: (_p: unknown, onUpdate: (rows: Record<string, unknown>[]) => void) => {
            push = onUpdate;
            return () => { push = undefined; };
        }
    } as unknown as RebaseWebSocketClient;
    return { ws, push: (rows: Record<string, unknown>[]) => push?.(rows) };
}

function createTransport(count: () => Promise<unknown>): Transport {
    return {
        request: jest.fn<any>((url: string) => {
            if (url.includes("/count")) return count();
            return Promise.resolve({ data: [], meta: {} });
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

describe("listen() pagination metadata", () => {
    it("reports the page size the server actually applies when none was requested", async () => {
        const transport = createTransport(() => Promise.resolve({ count: 3 }));
        const { ws, push } = createWs();
        const client = createCollectionClient<Row>(transport, "products", ws);

        const updates: FindResult<Row>[] = [];
        const stop = client.listen!(undefined, (r) => updates.push(r));
        push([{ id: "1" }, { id: "2" }, { id: "3" }]);
        await flush();

        // Not 20. A caller who names no limit gets `DEFAULT_LIST_LIMIT` rows
        // from the REST layer, so any other number here describes a window the
        // rows did not come from.
        expect(updates.at(-1)?.meta.limit).toBe(DEFAULT_LIST_LIMIT);
        stop!();
    });

    it("does not shrink the total to one page when the count request fails", async () => {
        let counts = 0;
        const transport = createTransport(() => {
            counts += 1;
            return counts === 1
                ? Promise.resolve({ count: 500 })
                : Promise.reject(new Error("count unavailable"));
        });
        const { ws, push } = createWs();
        const client = createCollectionClient<Row>(transport, "products", ws);

        const updates: FindResult<Row>[] = [];
        const stop = client.listen!({ limit: 2 }, (r) => updates.push(r));

        push([{ id: "1" }, { id: "2" }]);
        await flush();
        expect(updates.at(-1)?.meta.total).toBe(500);

        // The collection did not lose 498 rows because a count request failed.
        push([{ id: "1" }, { id: "2" }]);
        await flush();
        expect(updates.at(-1)?.meta.total).toBe(500);
        expect(updates.at(-1)?.meta.hasMore).toBe(true);
        stop!();
    });

    it("never claims a total below the rows already skipped", async () => {
        const transport = createTransport(() => Promise.reject(new Error("nope")));
        const { ws, push } = createWs();
        const client = createCollectionClient<Row>(transport, "products", ws);

        const updates: FindResult<Row>[] = [];
        const stop = client.listen!({ limit: 2, offset: 10 }, (r) => updates.push(r));
        push([{ id: "11" }, { id: "12" }]);
        await flush();

        // With no count ever obtained the total is unknown, but it cannot be 2:
        // ten rows were paged past to reach these.
        expect(updates.at(-1)?.meta.total).toBe(12);
        stop!();
    });
});
