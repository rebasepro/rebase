import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";

/**
 * Regression tests for subscriptions that never load.
 *
 * `subscribe_collection` / `subscribe_one` are fire-and-forget on the wire —
 * they carry no response envelope, so they are not covered by the
 * `pendingRequests` timeout that guards ordinary requests. That left three ways
 * for a view to spin forever with no error, all reproduced below:
 *
 *  1. the subscribe send itself failed (a token refresh losing a cold-load race
 *     rejects it), leaving a registration nothing would ever answer;
 *  2. every later listener for the same params attached to that dead
 *     registration and issued no subscribe of its own;
 *  3. a subscribe that reached the server but got no reply had no watchdog.
 *
 * Only a page reload cleared it, because the registration lives in memory.
 */

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    url: string;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: any) => void;
    onclose?: () => void;
    onerror?: (error: any) => void;
    sentMessages: string[] = [];

    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 10);
    }

    send(data: string) { this.sentMessages.push(data); }
    close() { this.readyState = MockWebSocket.CLOSED; if (this.onclose) this.onclose(); }
}

let createdClients: RebaseWebSocketClient[] = [];

function createClient(opts?: Partial<ConstructorParameters<typeof RebaseWebSocketClient>[0]>) {
    const client = new RebaseWebSocketClient({
        websocketUrl: "ws://localhost:1234",
        WebSocket: MockWebSocket as any,
        ...opts
    });
    createdClients.push(client);
    return client;
}

function getWs(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

/**
 * Let queued promise callbacks run without advancing the clock — the subscribe
 * send rejects on the microtask queue, and advancing timers here would trip the
 * watchdog under test.
 */
async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

function subscribeFrames(ws: MockWebSocket, type = "subscribe_collection") {
    return ws.sentMessages.map(m => JSON.parse(m)).filter(m => m.type === type);
}

/** Deliver the server's initial payload for a subscribe frame. */
function deliverRows(ws: MockWebSocket, subscriptionId: string, rows: Record<string, unknown>[]) {
    ws.onmessage!({ data: JSON.stringify({ type: "collection_update", subscriptionId, rows }) });
}

describe("Subscription resilience", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        createdClients = [];
        jest.useFakeTimers();
        jest.spyOn(console, "log").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "debug").mockImplementation(() => {});
    });

    afterEach(() => {
        createdClients.forEach(c => c.disconnect());
        createdClients = [];
        MockWebSocket.instances.forEach(ws => {
            ws.onclose = undefined;
            ws.onerror = undefined;
            ws.onmessage = undefined;
            ws.onopen = undefined;
            ws.close();
        });
        MockWebSocket.instances = [];
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // The reported bug: a view stuck loading until reload
    // -----------------------------------------------------------------------
    describe("a subscribe that never lands", () => {
        it("does not poison the params: a later listener re-subscribes and loads", async () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            // Mount #1 — force the subscribe to fail the way a lost auth race does.
            const onUpdate1 = jest.fn();
            const onError1 = jest.fn();
            ws.send = () => { throw new Error("send failed"); };
            const unsub1 = client.listenCollection({ path: "products" }, onUpdate1 as any, onError1 as any);
            await flush();

            expect(onError1).toHaveBeenCalled();
            unsub1();

            // Mount #2 — same params, healthy socket.
            ws.send = MockWebSocket.prototype.send.bind(ws);
            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "products" }, onUpdate2 as any);
            await flush();

            const frames = subscribeFrames(ws);
            expect(frames).toHaveLength(1); // it actually re-subscribed

            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "p1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "p1" }]);
        });

        it("reports the failure to every listener, not just the one that created it", async () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onErrorA = jest.fn();
            const onErrorB = jest.fn();

            // Two listeners share one registration; the send then fails.
            ws.send = () => { throw new Error("send failed"); };
            client.listenCollection({ path: "products" }, jest.fn() as any, onErrorA as any);
            client.listenCollection({ path: "products" }, jest.fn() as any, onErrorB as any);
            await flush();

            expect(onErrorA).toHaveBeenCalled();
            expect(onErrorB).toHaveBeenCalled();
        });

        it("still re-subscribes when the failed listener never unmounted", async () => {
            // The stuck view stays on screen; a second component mounting the
            // same collection must not silently attach to the dead entry.
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            ws.send = () => { throw new Error("send failed"); };
            client.listenCollection({ path: "products" }, jest.fn() as any, jest.fn() as any);
            await flush();

            ws.send = MockWebSocket.prototype.send.bind(ws);
            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "products" }, onUpdate2 as any);
            await flush();

            const frames = subscribeFrames(ws);
            expect(frames).toHaveLength(1);
            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "p1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "p1" }]);
        });
    });

    // -----------------------------------------------------------------------
    // Watchdog: a subscribe that reaches the server and gets no answer
    // -----------------------------------------------------------------------
    describe("subscribe watchdog", () => {
        it("errors instead of hanging when the initial payload never arrives", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onError = jest.fn();
            client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);

            expect(subscribeFrames(ws)).toHaveLength(1);
            expect(onError).not.toHaveBeenCalled(); // still legitimately loading

            jest.advanceTimersByTime(30000);

            expect(onError).toHaveBeenCalled();
            const error = onError.mock.calls[0][0] as any;
            expect(error.code).toBe("SUBSCRIPTION_TIMEOUT");
        });

        it("stands down once the initial payload arrives", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate = jest.fn();
            const onError = jest.fn();
            client.listenCollection({ path: "products" }, onUpdate as any, onError as any);

            const frames = subscribeFrames(ws);
            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "p1" }]);

            jest.advanceTimersByTime(60000);

            expect(onUpdate).toHaveBeenCalledTimes(1);
            expect(onError).not.toHaveBeenCalled(); // no spurious timeout
        });

        it("lets a later listener retry after a timed-out subscribe", async () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            client.listenCollection({ path: "products" }, jest.fn() as any, jest.fn() as any);
            jest.advanceTimersByTime(30000);

            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "products" }, onUpdate2 as any);
            await flush();

            const frames = subscribeFrames(ws);
            expect(frames).toHaveLength(2); // fresh attempt, not a dead attach
            deliverRows(ws, frames[1].payload.subscriptionId, [{ id: "p1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "p1" }]);
        });

        it("does not time out a subscribe that was queued before the socket opened", () => {
            // The frame sits in the queue until connect, and reconnect backoff can
            // outlast the timeout — starting the clock at request time would kill
            // a subscription that was never actually on the wire.
            const client = createClient();
            // No runAllTimers: the socket has not opened yet.
            const onError = jest.fn();
            client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);

            jest.advanceTimersByTime(29000); // still offline, must not count
            expect(onError).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1000); // socket opens, queue flushes
            const ws = getWs();
            const frames = subscribeFrames(ws);
            expect(frames).toHaveLength(1);
            expect(onError).not.toHaveBeenCalled();

            // The clock starts now.
            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "p1" }]);
            jest.advanceTimersByTime(60000);
            expect(onError).not.toHaveBeenCalled();
        });

        it("does not fire while the socket is down and reconnecting", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onError = jest.fn();
            client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);

            ws.onclose!(); // drop before the payload arrives
            jest.advanceTimersByTime(30000);

            // The reconnect path owns re-subscribing; the watchdog must not
            // tear the subscription down underneath it.
            expect(onError).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Server-reported subscription errors
    // -----------------------------------------------------------------------
    describe("server subscription errors", () => {
        it("surfaces the error and allows a later listener to retry", async () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onError = jest.fn();
            client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);

            const frames = subscribeFrames(ws);
            ws.onmessage!({ data: JSON.stringify({
                type: "error",
                subscriptionId: frames[0].payload.subscriptionId,
                payload: { error: { message: "Collection not found: 'products'", code: "NOT_FOUND" } },
                error: "Collection not found: 'products'"
            }) });

            expect(onError).toHaveBeenCalled();

            // A remount re-issues the subscribe rather than hanging.
            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "products" }, onUpdate2 as any);
            await flush();

            const after = subscribeFrames(ws);
            expect(after).toHaveLength(2);
            deliverRows(ws, after[1].payload.subscriptionId, [{ id: "p1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "p1" }]);
        });

        it("does not swallow a subscription error carrying a non-string payload", () => {
            // A malformed frame must still reach the listener: throwing inside
            // the message handler would be caught by the onmessage try/catch and
            // leave the view spinning with no error at all.
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onError = jest.fn();
            client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);

            const frames = subscribeFrames(ws);
            ws.onmessage!({ data: JSON.stringify({
                type: "ERROR",
                subscriptionId: frames[0].payload.subscriptionId,
                error: { message: "boom", code: "NOT_FOUND" }
            }) });

            expect(onError).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Existing behaviour that must not regress
    // -----------------------------------------------------------------------
    describe("healthy subscriptions are unaffected", () => {
        it("still deduplicates concurrent listeners into one subscribe", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onUpdate1 = jest.fn();
            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "users" }, onUpdate1 as any);
            client.listenCollection({ path: "users" }, onUpdate2 as any);

            // The second listener joins a subscribe genuinely in flight — it must
            // not issue a duplicate.
            expect(subscribeFrames(ws)).toHaveLength(1);

            const frames = subscribeFrames(ws);
            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "u1" }]);

            expect(onUpdate1).toHaveBeenCalledWith([{ id: "u1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "u1" }]);
        });

        it("still serves cached rows to a late joiner without re-subscribing", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            client.listenCollection({ path: "users" }, jest.fn() as any);
            const frames = subscribeFrames(ws);
            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "u1" }]);

            const late = jest.fn();
            client.listenCollection({ path: "users" }, late as any);

            expect(late).toHaveBeenCalledWith([{ id: "u1" }]);
            expect(subscribeFrames(ws)).toHaveLength(1); // no extra frame
        });

        it("still unsubscribes from the backend when the last listener leaves", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const unsub1 = client.listenCollection({ path: "users" }, jest.fn() as any);
            const unsub2 = client.listenCollection({ path: "users" }, jest.fn() as any);

            const frames = subscribeFrames(ws);
            deliverRows(ws, frames[0].payload.subscriptionId, [{ id: "u1" }]);

            unsub1();
            expect(ws.sentMessages.filter(m => m.includes("unsubscribe"))).toHaveLength(0);

            unsub2();
            expect(ws.sentMessages.filter(m => m.includes("unsubscribe"))).toHaveLength(1);
        });

        it("a stale unsubscribe does not tear down a newer registration", async () => {
            // Mount #1's subscribe fails and is dropped; mount #2 registers
            // afresh. Unmounting #1 afterwards must not delete #2's entry.
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            ws.send = () => { throw new Error("send failed"); };
            const unsub1 = client.listenCollection({ path: "products" }, jest.fn() as any, jest.fn() as any);
            await flush();

            ws.send = MockWebSocket.prototype.send.bind(ws);
            const onUpdate2 = jest.fn();
            client.listenCollection({ path: "products" }, onUpdate2 as any);
            await flush();

            unsub1(); // late teardown of the dead registration

            const frames = subscribeFrames(ws);
            deliverRows(ws, frames[frames.length - 1].payload.subscriptionId, [{ id: "p1" }]);
            expect(onUpdate2).toHaveBeenCalledWith([{ id: "p1" }]); // #2 survived
        });
    });

    // -----------------------------------------------------------------------
    // Row subscriptions share the machinery
    // -----------------------------------------------------------------------
    describe("listenOne", () => {
        it("does not poison the params after a failed subscribe", async () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            ws.send = () => { throw new Error("send failed"); };
            const onError1 = jest.fn();
            client.listenOne({ path: "products", id: "p1" } as any, jest.fn() as any, onError1 as any);
            await flush();
            expect(onError1).toHaveBeenCalled();

            ws.send = MockWebSocket.prototype.send.bind(ws);
            const onUpdate2 = jest.fn();
            client.listenOne({ path: "products", id: "p1" } as any, onUpdate2 as any);
            await flush();

            const frames = subscribeFrames(ws, "subscribe_one");
            expect(frames).toHaveLength(1);

            ws.onmessage!({ data: JSON.stringify({
                type: "single_update",
                subscriptionId: frames[0].payload.subscriptionId,
                row: { id: "p1" }
            }) });
            expect(onUpdate2).toHaveBeenCalledWith({ id: "p1" });
        });

        it("errors instead of hanging when the initial row never arrives", () => {
            const client = createClient();
            jest.runAllTimers();
            getWs();

            const onError = jest.fn();
            client.listenOne({ path: "products", id: "p1" } as any, jest.fn() as any, onError as any);

            jest.advanceTimersByTime(30000);

            expect(onError).toHaveBeenCalled();
            expect((onError.mock.calls[0][0] as any).code).toBe("SUBSCRIPTION_TIMEOUT");
        });
    });

    // -----------------------------------------------------------------------
    // Giving up on reconnection
    // -----------------------------------------------------------------------
    describe("when reconnection is abandoned", () => {
        it("fails subscriptions that never loaded instead of leaving them spinning", () => {
            const client = createClient();
            jest.runAllTimers();
            const ws = getWs();

            const onError = jest.fn();
            client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);

            // Burn through every reconnection attempt.
            for (let i = 0; i < 10; i++) {
                const current = getWs();
                if (current.onclose) current.onclose();
                jest.runAllTimers();
            }

            expect(onError).toHaveBeenCalled();
            void ws;
        });
    });
});
