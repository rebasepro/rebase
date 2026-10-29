import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";
import { RebaseRealtimeChannel, rejoinsAfter } from "../src/realtime-channel";
import { FaultServer, defaultResponder, type Frame } from "./support/fault-socket";

/**
 * A channels-only client whose sign-in did not go through.
 *
 * Under load the server's auth store could not answer (`ROLE_LOOKUP_FAILED`)
 * when a socket reconnected. The client logged it at debug level and carried
 * on unsigned, and every channel frame after that was refused
 * "Authentication required": the refusal went to the channel's `onError`, and
 * nothing signed the socket in again. In a load test two rooms stayed that way
 * for eight minutes. A join the server refused was not sent again either, so
 * every broadcast after it came back "not a member".
 */

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    for (const level of ["log", "debug", "error", "warn"] as const) jest.spyOn(console, level).mockImplementation(() => undefined);
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

function reply(server: FaultServer, frame: Frame, answer: Frame): void {
    const socket = server.sockets.find(k => k.written.includes(frame))!;
    queueMicrotask(() => socket.deliver(answer));
}

const busy = (frame: Frame): Frame => ({ type: "ERROR", requestId: frame.requestId, payload: { error: { code: "ROLE_LOOKUP_FAILED", message: "Could not verify your permissions. Please try again." } } });

describe("signing in again for channels", () => {
    it("retries a sign-in the server could not check, before the channels re-join", async () => {
        let refusals = 2;
        const server = new FaultServer((frame, s) => {
            if (frame.type === "AUTHENTICATE" && refusals > 0) { refusals--; reply(s, frame, busy(frame)); return []; }
            return defaultResponder(frame, s);
        });
        const client = new RebaseWebSocketClient({ websocketUrl: "ws://test/ws", WebSocket: server.WebSocket, getAuthToken: async () => "tok" });
        const channel = new RebaseRealtimeChannel("room", client);
        const joining = channel.join();
        await jest.advanceTimersByTimeAsync(10_000);
        await joining;

        expect(server.receivedOfType("AUTHENTICATE")).toHaveLength(3);
        // the join went out on the signed-in socket, after the third sign-in
        const order = server.received.map(f => f.type);
        expect(order.lastIndexOf("join_channel")).toBeGreaterThan(order.lastIndexOf("AUTHENTICATE"));
        client.disconnect(true);
    });

    it("closes and redials when the sign-in keeps failing, instead of staying unsigned", async () => {
        let refusals = 4;
        const server = new FaultServer((frame, s) => {
            if (frame.type === "AUTHENTICATE" && refusals > 0) { refusals--; reply(s, frame, busy(frame)); return []; }
            return defaultResponder(frame, s);
        });
        const client = new RebaseWebSocketClient({ websocketUrl: "ws://test/ws", WebSocket: server.WebSocket, getAuthToken: async () => "tok" });
        const channel = new RebaseRealtimeChannel("room", client);
        const joining = channel.join();
        await jest.advanceTimersByTimeAsync(60_000);
        await joining;

        expect(server.sockets.length).toBeGreaterThan(1);
        expect(server.current!.written.some(f => f.type === "AUTHENTICATE")).toBe(true);
        expect(server.current!.written.some(f => f.type === "join_channel")).toBe(true);
        client.disconnect(true);
    });

    it("signs in again when a channel frame is refused for not being signed in, and re-joins", async () => {
        let token: string | null = null;
        let refuseJoins = true;
        const server = new FaultServer((frame, s) => {
            if (frame.type === "join_channel" && refuseJoins) {
                reply(s, frame, { type: "ERROR", channel: "room", payload: { channel: "room", error: { code: "UNAUTHORIZED", message: "Authentication required" } } });
                return [];
            }
            return defaultResponder(frame, s);
        });
        const client = new RebaseWebSocketClient({ websocketUrl: "ws://test/ws", WebSocket: server.WebSocket, getAuthToken: async () => token });
        const channel = new RebaseRealtimeChannel("room", client);
        const errors: string[] = [];
        channel.onError((error) => errors.push(String((error as { code?: string }).code)));
        const joining = channel.join();
        await jest.advanceTimersByTimeAsync(1_000);
        await joining;
        expect(errors).toContain("UNAUTHORIZED");

        // the session is there now: the next refusal (a moment later: one attempt per refusal storm)
        // signs the socket in and re-joins
        await jest.advanceTimersByTimeAsync(2_500);
        token = "tok";
        refuseJoins = false;
        server.current!.deliver({ type: "ERROR", channel: "room", payload: { channel: "room", error: { code: "UNAUTHORIZED", message: "Authentication required" } } });
        await jest.advanceTimersByTimeAsync(5_000);

        expect(server.receivedOfType("AUTHENTICATE").length).toBeGreaterThan(0);
        const order = server.received.map(f => f.type);
        expect(order.lastIndexOf("join_channel")).toBeGreaterThan(order.lastIndexOf("AUTHENTICATE"));
        client.disconnect(true);
    });
});

describe("re-joining a refused channel", () => {
    it("sends the join again, backing off, when the server could not check permissions", async () => {
        let refuse = 2;
        const server = new FaultServer((frame, s) => {
            if (frame.type === "join_channel" && refuse > 0) {
                refuse--;
                reply(s, frame, { type: "ERROR", channel: "room", payload: { channel: "room", error: { code: "ROLE_LOOKUP_FAILED", message: "Could not verify your permissions." } } });
                return [];
            }
            return defaultResponder(frame, s);
        });
        const client = new RebaseWebSocketClient({ websocketUrl: "ws://test/ws", WebSocket: server.WebSocket });
        const channel = new RebaseRealtimeChannel("room", client);
        channel.onError(() => undefined);
        const joining = channel.join();
        await jest.advanceTimersByTimeAsync(500);
        await joining;
        expect(server.receivedOfType("join_channel")).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(1_000);
        expect(server.receivedOfType("join_channel")).toHaveLength(2);
        await jest.advanceTimersByTimeAsync(2_000);
        expect(server.receivedOfType("join_channel")).toHaveLength(3);
        await jest.advanceTimersByTimeAsync(30_000);
        expect(server.receivedOfType("join_channel")).toHaveLength(3);
        client.disconnect(true);
    });

    it("retries only what a retry can change", () => {
        expect(rejoinsAfter("ROLE_LOOKUP_FAILED", "")).toBe(true);
        expect(rejoinsAfter("DATABASE_UNAVAILABLE", "")).toBe(true);
        expect(rejoinsAfter("CHANNEL_FORBIDDEN", "Cannot broadcast: not a member of the channel")).toBe(true);
        expect(rejoinsAfter("CHANNEL_FORBIDDEN", "Not allowed to join this channel")).toBe(false);
        expect(rejoinsAfter("RATE_LIMITED", "")).toBe(false);
        expect(rejoinsAfter(undefined, "")).toBe(false);
    });
});
