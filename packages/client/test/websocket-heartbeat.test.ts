import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";
import { FaultServer } from "./support/fault-socket";

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
