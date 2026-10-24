import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";
import { FaultServer, defaultResponder, type Frame } from "./support/fault-socket";

/**
 * A socket the server refuses for `REALTIME_MAX_SOCKETS_PER_USER`.
 *
 * The server refuses only after the socket opened: it answers AUTHENTICATE
 * with `ERROR TOO_MANY_SOCKETS`, then closes with 4002. The client reset its
 * backoff and its outage state on `open`, before authentication could fail,
 * so an over-cap tab redialled at the first backoff step forever — a TLS
 * handshake and a token verification every second or two — flipped between
 * connected and reconnecting, and never told its views they were not live.
 */

describe("a socket refused for the per-user socket ceiling", () => {
    let warn: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
        // The fault server answers in microtasks, which jest would otherwise
        // hold until the next timer fires.
        jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
        for (const level of ["log", "debug", "error"] as const) jest.spyOn(console, level).mockImplementation(() => undefined);
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    /** A server past its ceiling until `admit` is set. */
    function ceilingServer() {
        const state = { admit: false };
        const server = new FaultServer((frame: Frame, s) => {
            if (frame.type === "AUTHENTICATE" && !state.admit) {
                const socket = s.sockets.find(k => k.written.includes(frame))!;
                queueMicrotask(() => {
                    socket.deliver({
                        type: "ERROR",
                        requestId: frame.requestId,
                        payload: { error: { code: "TOO_MANY_SOCKETS", message: "This user already has 3 realtime connections open" } }
                    });
                    queueMicrotask(() => socket.drop());
                });
                return [];
            }
            return defaultResponder(frame, s);
        });
        return { server, state };
    }

    it("backs off on a growing schedule and tells its views, once", async () => {
        const { server, state } = ceilingServer();
        const client = new RebaseWebSocketClient({ websocketUrl: "ws://test/ws", WebSocket: server.WebSocket, getAuthToken: async () => "tok" });
        const errors: { code?: string }[] = [];
        const lost: unknown[] = [];
        client.onConnectionLost((error) => lost.push(error));
        client.listenCollection({ path: "posts" }, () => undefined, (error) => errors.push(error as { code?: string }));

        await jest.advanceTimersByTimeAsync(120_000);

        // Uncapped it was a dial every 0.25–2 s: about a hundred in two minutes.
        expect(server.sockets.length).toBeLessThan(20);
        // Told once per registration, without waiting for an outage timer.
        expect(errors).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect(client.state).toBe("disconnected");
        // And the console says why, once.
        expect(warn.mock.calls.filter(call => String(call[0]).includes("TOO_MANY_SOCKETS"))).toHaveLength(1);
        // No subscription went out on a refused socket.
        expect(server.receivedOfType("subscribe_collection")).toHaveLength(0);

        // Another tab closes: the next dial gets in, and the view recovers.
        state.admit = true;
        await jest.advanceTimersByTimeAsync(60_000);
        expect(server.receivedOfType("subscribe_collection").length).toBeGreaterThan(0);
        expect(client.state).toBe("connected");
        client.disconnect(true);
    });
});
