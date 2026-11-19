import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";
import { FaultServer, FaultSocket } from "./support/fault-socket";

/**
 * A socket that goes half-open is noticed, when the server can say so.
 *
 * A browser cannot send a WebSocket ping or see one. When a NAT forgets the
 * connection or a laptop sleeps through a network change, the socket stays
 * "connected" on this side forever: no close, no error, and no frame — every
 * live view silently stops updating. The client now opts into heartbeats on
 * its URL; a server that agrees says `hello` and beats every `heartbeatMs`,
 * and two missed beats make the client drop the socket and redial, which
 * re-subscribes everything.
 *
 * Both directions of a version mismatch keep the old behaviour: a server that
 * sends no `hello` is never judged on heartbeats.
 */

let clients: RebaseWebSocketClient[] = [];

function connect(server: FaultServer): RebaseWebSocketClient {
    const client = new RebaseWebSocketClient({ websocketUrl: "ws://test/ws", WebSocket: server.WebSocket });
    client.ensureConnected();
    clients.push(client);
    return client;
}

const HEARTBEAT_MS = 1_000;

/** Say hello as a server that agreed to heartbeats. */
function hello(server: FaultServer): void {
    server.current!.deliver({ type: "hello", capabilities: ["heartbeat"], heartbeatMs: HEARTBEAT_MS });
}

describe("heartbeats", () => {
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

    it("asks for them on the socket URL", async () => {
        const server = new FaultServer();
        connect(server);
        await jest.advanceTimersByTimeAsync(20);
        const url = new URL(server.current!.url);
        expect(url.pathname).toBe("/ws");
        expect(url.searchParams.get("rebase_caps")?.split(",")).toEqual(expect.arrayContaining(["heartbeat", "channel_seq"]));
    });

    it("redials after two missed beats, and the subscription is sent again", async () => {
        const server = new FaultServer();
        server.setRows("posts", [{ id: "1" }]);
        const client = connect(server);
        client.listenOne({ path: "posts", id: "1" }, () => undefined);
        await jest.advanceTimersByTimeAsync(20);
        hello(server);
        expect(server.sockets).toHaveLength(1);
        expect(server.receivedOfType("subscribe_one")).toHaveLength(1);

        const states: string[] = [];
        client.onStateChange((state) => states.push(state));
        server.halfOpen();
        // One beat late is not yet two missed.
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
        expect(server.sockets).toHaveLength(1);
        expect(states).not.toContain("reconnecting");

        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
        // Given up on: what a close would have done, without waiting for one.
        // Read as a transition, not the state at this instant: the redial's
        // jittered delay can land inside the same advance, and the client is
        // then already connected again.
        expect(states).toContain("reconnecting");
        await jest.advanceTimersByTimeAsync(5_000);
        expect(server.sockets.length).toBeGreaterThanOrEqual(2);
        expect(client.state).toBe("connected");
        expect(server.receivedOfType("subscribe_one").length).toBeGreaterThanOrEqual(2);
    });

    it("a socket that keeps beating is kept", async () => {
        const server = new FaultServer();
        connect(server);
        await jest.advanceTimersByTimeAsync(20);
        hello(server);
        for (let i = 0; i < 20; i++) {
            await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
            server.current!.deliver({ type: "heartbeat" });
        }
        expect(server.sockets).toHaveLength(1);
        // Neither frame is anything else's business.
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("against a server that sends no hello, a silent socket is left alone, as before", async () => {
        const server = new FaultServer();
        server.setRows("posts", [{ id: "1" }]);
        const client = connect(server);
        client.listenOne({ path: "posts", id: "1" }, () => undefined);
        await jest.advanceTimersByTimeAsync(20);
        server.halfOpen();
        await jest.advanceTimersByTimeAsync(10 * 60_000);
        expect(server.sockets).toHaveLength(1);
        expect(client.hasServerOptIn("heartbeat")).toBe(false);
    });

    it("what one socket agreed to is forgotten when it closes", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);
        server.current!.deliver({ type: "hello", capabilities: ["heartbeat", "channel_seq"], heartbeatMs: HEARTBEAT_MS, clientId: "client_1" });
        expect(client.hasServerOptIn("channel_seq")).toBe(true);
        expect(client.socketClientId).toBe("client_1");
        server.current!.drop();
        expect(client.hasServerOptIn("channel_seq")).toBe(false);
        expect(client.socketClientId).toBeUndefined();
    });
});

/**
 * A page that sleeps is not a socket that died.
 *
 * A phone that locks, a tab the browser freezes, a laptop that sleeps: none
 * runs timers or reads frames. On waking, the liveness interval fired before
 * the frames waiting on the socket were read, saw a minute of silence and
 * dropped a socket the server had kept open the whole time (it answers the
 * server's pings below the page) — a disconnect on every wake, for every app
 * on the socket. A tick that comes late is a wake: the socket is asked.
 */
describe("heartbeats across a sleep", () => {
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

    /** The page sleeps for `ms`: the clock moves, no timer runs, no frame is read. */
    function sleep(ms: number): void {
        jest.setSystemTime(Date.now() + ms);
    }

    it("keeps a healthy socket when the page wakes from a sleep longer than the deadline", async () => {
        const server = new FaultServer();
        const client = connect(server);
        const drops: unknown[] = [];
        client.on("disconnect", (info) => drops.push(info));
        await jest.advanceTimersByTimeAsync(20);
        hello(server);

        sleep(120_000);
        // The first tick after waking, then the frame that was waiting.
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS / 2);
        server.current!.deliver({ type: "heartbeat" });
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);

        expect(drops).toEqual([]);
        expect(server.sockets).toHaveLength(1);
        expect(client.state).toBe("connected");
    });

    it("asks a server that offers ping, and keeps the socket when it answers", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);
        server.current!.deliver({ type: "hello", capabilities: ["heartbeat", "ping"], heartbeatMs: HEARTBEAT_MS });

        sleep(120_000);
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS / 2);
        expect(server.current!.written.filter(f => f.type === "ping")).toHaveLength(1);
        server.current!.deliver({ type: "heartbeat" });
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);

        expect(server.sockets).toHaveLength(1);
        expect(client.state).toBe("connected");
    });

    it("drops a socket that does not answer the ping after waking, and says why", async () => {
        const server = new FaultServer();
        const client = connect(server);
        const drops: unknown[] = [];
        client.on("disconnect", (info) => drops.push(info));
        await jest.advanceTimersByTimeAsync(20);
        // A long heartbeat, so only the probe can be what gives up on it.
        server.current!.deliver({ type: "hello", capabilities: ["heartbeat", "ping"], heartbeatMs: 30_000 });

        server.halfOpen();
        sleep(120_000);
        await jest.advanceTimersByTimeAsync(15_000);
        expect(drops).toEqual([]);
        await jest.advanceTimersByTimeAsync(15_000);

        expect(drops).toEqual([expect.objectContaining({ cause: "probe" })]);
    });
});

describe("the disconnect event", () => {
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

    it("carries the close code and reason when the server closed the socket", async () => {
        const server = new FaultServer();
        const client = connect(server);
        const drops: unknown[] = [];
        client.on("disconnect", (info) => drops.push(info));
        await jest.advanceTimersByTimeAsync(20);
        await jest.advanceTimersByTimeAsync(5_000);

        const socket = server.current!;
        socket.readyState = FaultSocket.CLOSED;
        socket.onclose?.({ code: 1001, reason: "Server shutting down" });

        expect(drops).toEqual([expect.objectContaining({ code: 1001, reason: "Server shutting down", cause: "server" })]);
        expect((drops[0] as { openForMs: number }).openForMs).toBeGreaterThanOrEqual(5_000);
    });

    it("says it was the heartbeat watchdog that gave up", async () => {
        const server = new FaultServer();
        const client = connect(server);
        const drops: unknown[] = [];
        client.on("disconnect", (info) => drops.push(info));
        await jest.advanceTimersByTimeAsync(20);
        hello(server);
        server.halfOpen();
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS * 4);

        expect(drops[0]).toMatchObject({ cause: "heartbeat" });
        expect((drops[0] as { silentForMs: number }).silentForMs).toBeGreaterThan(HEARTBEAT_MS * 2);
    });
});
