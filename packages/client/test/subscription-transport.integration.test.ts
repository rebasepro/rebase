import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws";
import { RebaseWebSocketClient } from "../src/websocket";

/**
 * The same guarantees as `subscription-resilience.test.ts`, but over a real
 * socket: a real `ws` server, real frames, real async timing, no mocked
 * transport. The unit tests can only prove the client's bookkeeping is
 * self-consistent; these prove the bytes actually move and that a server which
 * accepts a subscribe and then says nothing does not hang the client.
 *
 * Real timers throughout, so the client's 30s watchdog is shortened via its
 * private field rather than by advancing a fake clock.
 */

type ServerHandle = {
    port: number;
    wss: WebSocketServer;
    /** Every frame the server received, parsed. */
    received: Record<string, any>[];
    close: () => Promise<void>;
};

/**
 * @param onSubscribe decides how the server answers a subscribe frame.
 */
async function startServer(
    onSubscribe: (socket: NodeWebSocket, frame: Record<string, any>) => void
): Promise<ServerHandle> {
    const wss = new WebSocketServer({ port: 0 });
    const received: Record<string, any>[] = [];

    wss.on("connection", socket => {
        socket.on("message", raw => {
            const frame = JSON.parse(raw.toString());
            received.push(frame);
            if (frame.type === "AUTHENTICATE") {
                socket.send(JSON.stringify({ requestId: frame.requestId, type: "AUTH_SUCCESS" }));
                return;
            }
            if (frame.type === "subscribe_collection" || frame.type === "subscribe_one") {
                onSubscribe(socket, frame);
            }
        });
    });

    await new Promise<void>(resolve => wss.on("listening", () => resolve()));
    const port = (wss.address() as any).port;

    return {
        port,
        wss,
        received,
        close: () => new Promise<void>(resolve => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => resolve());
        })
    };
}

function createClient(port: number, watchdogMs: number) {
    const client = new RebaseWebSocketClient({
        websocketUrl: `ws://127.0.0.1:${port}`,
        WebSocket: NodeWebSocket as any
    });
    // Keep the tests fast; the production default is 30s.
    (client as any).subscriptionTimeoutMs = watchdogMs;
    return client;
}

/**
 * @param what names the thing being waited for, and it is not decoration: this
 *   helper used to throw "timed out waiting for condition", which is the same
 *   sentence whether the watchdog failed to fire or the socket never connected.
 *   Those have opposite causes and one of them cost an afternoon.
 */
const waitFor = async (predicate: () => boolean, timeoutMs = 4000, what = "a condition") => {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
        }
        await new Promise(r => setTimeout(r, 10));
    }
};

let servers: ServerHandle[] = [];
let clients: RebaseWebSocketClient[] = [];

afterEach(async () => {
    clients.forEach(c => c.disconnect());
    clients = [];
    for (const s of servers) await s.close();
    servers = [];
    jest.restoreAllMocks();
});

async function setup(onSubscribe: (socket: NodeWebSocket, frame: Record<string, any>) => void, watchdogMs = 300) {
    jest.spyOn(console, "debug").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    const server = await startServer(onSubscribe);
    servers.push(server);
    const client = createClient(server.port, watchdogMs);
    clients.push(client);

    // Open the socket, and wait for it, before handing the client over.
    //
    // `ensureConnected` is public, idempotent and exactly this: the client is
    // lazy by design — it opens nothing until an operation needs a socket — so
    // waiting without asking first waits forever.
    //
    // Every test built on `setup` is about what happens to a subscribe that
    // REACHES the server, so a client that has not connected yet is not a
    // slower version of the same scenario — it is a different one, and it used
    // to be reported as a watchdog failure.
    //
    // The specific flake: when a connect fails (which localhost does under a
    // loaded machine, roughly once in 25 full-suite runs), `onclose` runs
    // `suspendSubscribeWatchdogs`, so the queued subscribe has no watchdog at
    // all, and `attemptReconnect` waits 2s before the first retry and 4s before
    // the second. A test budgeting 4s for a 300ms watchdog then failed on the
    // watchdog, which was never armed and was never the problem.
    //
    // Ten seconds because that covers two failed connects (2s + 4s of backoff)
    // and still fails fast against a server that is genuinely not there.
    client.ensureConnected();
    await waitFor(() => (client as any).isConnected === true, 10000, "the client to connect");
    return { server, client };
}

describe("Subscription resilience over a real socket", () => {
    it("delivers rows for a normal subscribe", async () => {
        const { client } = await setup((socket, frame) => {
            socket.send(JSON.stringify({
                type: "collection_update",
                subscriptionId: frame.payload.subscriptionId,
                rows: [{ id: "p1" }]
            }));
        });

        const onUpdate = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate as any);

        await waitFor(() => onUpdate.mock.calls.length > 0, 4000, "the first rows to arrive");
        expect(onUpdate.mock.calls[0][0]).toEqual([{ id: "p1" }]);
    });

    it("errors instead of hanging when the server accepts the subscribe and says nothing", async () => {
        // The exact production shape of the bug: the frame lands, the server
        // never answers, and before the fix the view span forever in silence.
        const { server, client } = await setup(() => { /* deliberate silence */ });

        const onUpdate = jest.fn();
        const onError = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate as any, onError as any);

        // The premise first, and separately: this test is about a subscribe the
        // server RECEIVED and ignored. If the frame never arrives, the watchdog
        // is not what went wrong, and a failure here says so in those words.
        await waitFor(
            () => server.received.some(f => f.type === "subscribe_collection"),
            4000,
            "the subscribe frame to reach the server"
        );
        await waitFor(() => onError.mock.calls.length > 0, 4000, "the subscribe watchdog to fire");

        expect(server.received.some(f => f.type === "subscribe_collection")).toBe(true);
        expect(onUpdate).not.toHaveBeenCalled();
        expect((onError.mock.calls[0][0] as any).code).toBe("SUBSCRIPTION_TIMEOUT");
    });

    it("lets a later listener load after an unanswered subscribe", async () => {
        // Poisoning check on a live connection: once the first attempt gives up,
        // a fresh listener must get its own subscribe and real data.
        let answer = false;
        const { server, client } = await setup((socket, frame) => {
            if (!answer) return; // first attempt: silence
            socket.send(JSON.stringify({
                type: "collection_update",
                subscriptionId: frame.payload.subscriptionId,
                rows: [{ id: "p1" }]
            }));
        });

        const onError = jest.fn();
        client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);
        await waitFor(() => onError.mock.calls.length > 0, 4000, "the first subscribe to give up");

        const framesBefore = server.received.filter(f => f.type === "subscribe_collection").length;

        answer = true;
        const onUpdate2 = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate2 as any);

        await waitFor(() => onUpdate2.mock.calls.length > 0, 4000, "the second listener to load");

        const framesAfter = server.received.filter(f => f.type === "subscribe_collection").length;
        expect(framesAfter).toBeGreaterThan(framesBefore); // it really re-subscribed
        expect(onUpdate2.mock.calls[0][0]).toEqual([{ id: "p1" }]);
    });

    it("does not time out a subscribe issued before the socket finished connecting", async () => {
        // The subscribe is queued while CONNECTING; the watchdog must start when
        // the frame goes out, not when it was requested.
        const server = await startServer((socket, frame) => {
            // Answer only after a delay longer than the watchdog would have been
            // had it started at request time.
            setTimeout(() => {
                socket.send(JSON.stringify({
                    type: "collection_update",
                    subscriptionId: frame.payload.subscriptionId,
                    rows: [{ id: "p1" }]
                }));
            }, 50);
        });
        servers.push(server);
        jest.spyOn(console, "debug").mockImplementation(() => {});

        const client = createClient(server.port, 400);
        clients.push(client);

        // Subscribe immediately — the socket is still CONNECTING here.
        const onUpdate = jest.fn();
        const onError = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate as any, onError as any);

        await waitFor(() => onUpdate.mock.calls.length > 0, 4000, "rows for a subscribe queued while connecting");
        expect(onError).not.toHaveBeenCalled();
        expect(onUpdate.mock.calls[0][0]).toEqual([{ id: "p1" }]);
    });

    it("re-subscribes and delivers rows after the connection drops", async () => {
        let dropped = false;
        const { client } = await setup((socket, frame) => {
            if (!dropped) {
                dropped = true;
                socket.close(); // drop before answering the first subscribe
                return;
            }
            socket.send(JSON.stringify({
                type: "collection_update",
                subscriptionId: frame.payload.subscriptionId,
                rows: [{ id: "p1" }]
            }));
        }, 5000); // watchdog long enough not to interfere with reconnect

        const onUpdate = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate as any);

        await waitFor(() => onUpdate.mock.calls.length > 0, 8000, "rows to arrive after the reconnect");
        expect(onUpdate.mock.calls[0][0]).toEqual([{ id: "p1" }]);
    }, 15000);

    it("surfaces a server-side subscription error to the listener", async () => {
        const { client } = await setup((socket, frame) => {
            const msg = "Collection not found: 'nope'";
            socket.send(JSON.stringify({
                type: "error",
                subscriptionId: frame.payload.subscriptionId,
                payload: { error: { message: msg, code: "NOT_FOUND" } },
                error: msg
            }));
        });

        const onError = jest.fn();
        client.listenCollection({ path: "nope" }, jest.fn() as any, onError as any);

        await waitFor(() => onError.mock.calls.length > 0, 4000, "the server's error to reach the listener");
        expect((onError.mock.calls[0][0] as any).message).toContain("Collection not found");
    });

    it("does not fire a subscribe watchdog after the caller disconnects", async () => {
        // `disconnect()` cleared the reconnect timer and nulled the socket's
        // handlers — including `onclose`, which is what would otherwise have run
        // `suspendSubscribeWatchdogs`. So an armed watchdog survived an explicit
        // disconnect and fired up to `subscriptionTimeoutMs` later.
        //
        // Both callers are hurt by that, differently. Sign-out
        // (`disconnect()`, not permanent) keeps the subscriptions on purpose so
        // a later subscribe resumes them; a watchdog firing in between tears one
        // down, so signing back in leaves it dead. `close()`
        // (`disconnect(true)`) is the caller saying they are done — and on Node
        // a 30s timer that is not unref'd holds the event loop open by itself,
        // which is the very thing `close()` exists to prevent.
        const { server, client } = await setup(() => { /* deliberate silence */ });

        const onError = jest.fn();
        client.listenCollection({ path: "products" }, jest.fn() as any, onError as any);
        await waitFor(
            () => server.received.some(f => f.type === "subscribe_collection"),
            4000,
            "the subscribe frame to reach the server"
        );

        client.disconnect();

        // Comfortably past the 300ms watchdog this client was built with.
        await new Promise(r => setTimeout(r, 900));
        expect(onError).not.toHaveBeenCalled();
    });

    it("delivers a row subscription and times out one that is ignored", async () => {
        const { client } = await setup((socket, frame) => {
            if (frame.payload.id === "answered") {
                socket.send(JSON.stringify({
                    type: "single_update",
                    subscriptionId: frame.payload.subscriptionId,
                    row: { id: "answered" }
                }));
            }
        });

        const onUpdate = jest.fn();
        client.listenOne({ path: "products", id: "answered" } as any, onUpdate as any);
        await waitFor(() => onUpdate.mock.calls.length > 0, 4000, "the answered row subscription to load");
        expect(onUpdate.mock.calls[0][0]).toEqual({ id: "answered" });

        const onError = jest.fn();
        client.listenOne({ path: "products", id: "ignored" } as any, jest.fn() as any, onError as any);
        await waitFor(() => onError.mock.calls.length > 0, 4000, "the ignored row subscription to time out");
        expect((onError.mock.calls[0][0] as any).code).toBe("SUBSCRIPTION_TIMEOUT");
    });
});
