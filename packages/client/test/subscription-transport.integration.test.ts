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

const waitFor = async (predicate: () => boolean, timeoutMs = 4000) => {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
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

        await waitFor(() => onUpdate.mock.calls.length > 0);
        expect(onUpdate.mock.calls[0][0]).toEqual([{ id: "p1" }]);
    });

    it("errors instead of hanging when the server accepts the subscribe and says nothing", async () => {
        // The exact production shape of the bug: the frame lands, the server
        // never answers, and before the fix the view span forever in silence.
        const { server, client } = await setup(() => { /* deliberate silence */ });

        const onUpdate = jest.fn();
        const onError = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate as any, onError as any);

        await waitFor(() => onError.mock.calls.length > 0);

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
        await waitFor(() => onError.mock.calls.length > 0);

        const framesBefore = server.received.filter(f => f.type === "subscribe_collection").length;

        answer = true;
        const onUpdate2 = jest.fn();
        client.listenCollection({ path: "products" }, onUpdate2 as any);

        await waitFor(() => onUpdate2.mock.calls.length > 0);

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

        await waitFor(() => onUpdate.mock.calls.length > 0);
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

        await waitFor(() => onUpdate.mock.calls.length > 0, 8000);
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

        await waitFor(() => onError.mock.calls.length > 0);
        expect((onError.mock.calls[0][0] as any).message).toContain("Collection not found");
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
        await waitFor(() => onUpdate.mock.calls.length > 0);
        expect(onUpdate.mock.calls[0][0]).toEqual({ id: "answered" });

        const onError = jest.fn();
        client.listenOne({ path: "products", id: "ignored" } as any, jest.fn() as any, onError as any);
        await waitFor(() => onError.mock.calls.length > 0);
        expect((onError.mock.calls[0][0] as any).code).toBe("SUBSCRIPTION_TIMEOUT");
    });
});
