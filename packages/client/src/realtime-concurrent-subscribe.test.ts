import { jest } from "@jest/globals";

/**
 * A socket that opens on the next tick and answers `AUTHENTICATE` the way the
 * server does: one `AUTH_SUCCESS` carrying the frame's own `requestId`.
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
                    data: JSON.stringify({ type: "AUTH_SUCCESS",
requestId: message.requestId })
                }), 0);
            }
        }

        close() { /* noop */ }
    }

    return { FakeWS: FakeWS as unknown as typeof WebSocket,
sent };
}

describe("concurrent subscriptions on a cold socket", () => {

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("sends every subscribe when several are queued before authentication", async () => {
        // The Kanban board's shape: one subscription per column, all created in
        // the same tick, all queued because the socket is still connecting.
        //
        // `ensureAuthenticated` read its in-flight guard, then awaited
        // `getAuthToken()` before publishing it — so every caller that arrived
        // during that gap saw no attempt in progress and started one of its
        // own. Each attempt registered under `auth_${Date.now()}`, with no
        // random suffix, so within a millisecond they collided in the
        // `pendingRequests` map and only the last registration was ever
        // settled. The rest awaited forever, and the `subscribe_collection`
        // frames behind them were never sent: the board's columns reported
        // "Subscription timed out" thirty seconds later.
        const { RebaseWebSocketClient } = await import("./websocket");
        const { FakeWS, sent } = fakeSocket();

        // The socket authenticates itself on open, which would settle auth
        // before anything queued got a chance to race. In a real page load the
        // auth controller is still restoring the session at that point, so the
        // first read yields nothing and the queued frames are what end up
        // driving authentication — each of them separately.
        let firstRead = true;
        const getAuthToken = async () => {
            if (firstRead) {
                firstRead = false;
                return null;
            }
            // Reading a token is asynchronous — this is the window during
            // which concurrent callers used to each start their own attempt.
            await new Promise(resolve => setTimeout(resolve, 5));
            return "token";
        };

        const client = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:1234",
            WebSocket: FakeWS,
            getAuthToken
        });

        const columns = ["open", "in_progress", "waiting", "resolved", "closed"];
        for (const column of columns) {
            client.listenCollection(
                { path: "tickets",
filter: { status: ["==", column] } } as never,
                () => undefined,
                () => undefined
            );
        }

        await jest.advanceTimersByTimeAsync(50);

        const subscribed = sent.filter(m => m.type === "subscribe_collection");
        expect(subscribed).toHaveLength(columns.length);

        // And exactly one authentication for all of them.
        expect(sent.filter(m => m.type === "AUTHENTICATE")).toHaveLength(1);
    });
});
