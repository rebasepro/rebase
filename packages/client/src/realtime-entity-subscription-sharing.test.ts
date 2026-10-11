import { jest } from "@jest/globals";
import { RebaseWebSocketClient } from "./websocket";
import { createCollectionClient } from "./collection";

/**
 * A table's reference and relation cells each watch the record they point at
 * (`useFetch` → `listenById`), so a column where 30 rows point at 3 customers
 * asks 30 times. That must stay 3 server subscriptions, not 30: the socket
 * shares one subscription per record and hands its latest row to every
 * listener. This pins it, because the per-cell call site makes it look as if
 * each cell paid for its own.
 */

function fakeSocket() {
    const sent: Record<string, unknown>[] = [];

    class FakeWS {
        static readonly OPEN = 1;
        readyState = 1;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;

        constructor(public url: string) {
            setTimeout(() => this.onopen?.(), 0);
        }

        send(raw: string) {
            const message = JSON.parse(raw) as Record<string, unknown>;
            sent.push(message);
            if (message.type === "AUTHENTICATE") {
                setTimeout(() => this.onmessage?.({
                    data: JSON.stringify({ type: "AUTH_SUCCESS", requestId: message.requestId })
                }), 0);
            }
        }

        close() { /* noop */ }
    }

    return { FakeWS: FakeWS as unknown as typeof WebSocket, sent };
}

describe("record subscriptions shared across listeners", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("opens one server subscription per record, however many cells watch it", async () => {
        const { FakeWS, sent } = fakeSocket();
        const client = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:1234",
            WebSocket: FakeWS,
            getAuthToken: async () => "token"
        });

        const ids = ["c1", "c2", "c3"];
        const unsubscribes = Array.from({ length: 30 }, (_, row) =>
            client.listenOne({ path: "customers", id: ids[row % ids.length] } as never, () => undefined));
        await jest.advanceTimersByTimeAsync(50);

        expect(sent.filter(m => m.type === "subscribe_one")).toHaveLength(3);

        // The server subscription goes when the last cell watching it does.
        unsubscribes.forEach((unsubscribe, row) => {
            if (ids[row % ids.length] === "c1") unsubscribe();
        });
        await jest.advanceTimersByTimeAsync(50);
        expect(sent.filter(m => m.type === "unsubscribe")).toHaveLength(1);
    });

    it("asks for the relations a listener names, and shares a subscription only between listeners that name the same", async () => {
        const { FakeWS, sent } = fakeSocket();
        const client = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:1234",
            WebSocket: FakeWS,
            getAuthToken: async () => "token"
        });

        client.listenOne({ path: "posts", id: "1" }, () => undefined);
        client.listenOne({ path: "posts", id: "1", include: ["tags"] }, () => undefined);
        client.listenOne({ path: "posts", id: "1", include: ["tags"] }, () => undefined);
        await jest.advanceTimersByTimeAsync(50);

        const subscribes = sent.filter(m => m.type === "subscribe_one").map(m => (m.payload as { include?: unknown }).include);
        expect(subscribes).toHaveLength(2);
        expect(subscribes).toContainEqual(["tags"]);
        expect(subscribes).toContainEqual(undefined);
    });
});

describe("a collection client's row listener", () => {
    it("hands the relations it is asked for to the socket, and a row read sends them as ?include=", async () => {
        const listenOne = jest.fn((..._args: unknown[]) => () => undefined);
        const request = jest.fn(async (..._args: unknown[]) => ({ id: 1 }));
        const collection = createCollectionClient({ request } as never, "posts", { listenOne } as never);

        collection.listenById(1, () => undefined, undefined, { include: ["tags"] });
        await collection.findById(1, { include: ["tags"] });

        expect(listenOne.mock.calls[0][0]).toEqual({ path: "posts", id: "1", include: ["tags"] });
        expect(request.mock.calls[0][0]).toBe("/data/posts/1?include=tags");
    });
});
