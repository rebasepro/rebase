import { jest } from "@jest/globals";
import { RebaseWebSocketClient } from "./websocket";

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
});
