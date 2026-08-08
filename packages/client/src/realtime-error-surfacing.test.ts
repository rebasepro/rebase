import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

/**
 * Server errors about channel frames used to be discarded by the client.
 *
 * Channel messages are fire-and-forget by design: the SDK deliberately
 * registers no `pendingRequests` waiter for them, because their answers come
 * back addressed by channel rather than in a response envelope. The consequence
 * was that an `ERROR` frame — `RATE_LIMITED`, `CHANNEL_FORBIDDEN`,
 * `CHANNEL_HISTORY_WRITE_FAILED` — matched no waiter, no channel and no
 * subscription, fell through every branch of `handleWebSocketMessage`, and was
 * dropped. `await channel.broadcast(...)` resolved as if it had been sent.
 */
function fakeSocket() {
    const sockets: FakeWS[] = [];

    class FakeWS {
        static readonly OPEN = 1;
        readyState = 1;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;

        constructor(public url: string) {
            sockets.push(this);
            setTimeout(() => this.onopen?.(), 0);
        }

        send() { /* nothing here needs the outgoing frames */ }
        close() { /* noop */ }
    }

    const instance = () => sockets[sockets.length - 1];

    return {
        FakeWS: FakeWS as unknown as typeof WebSocket,
        deliver: (frame: unknown) => instance()?.onmessage?.({ data: JSON.stringify(frame) })
    };
}

describe("unmatched realtime error frames", () => {
    let warn: any;

    beforeEach(() => {
        jest.useFakeTimers();
        warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
        jest.useRealTimers();
    });

    const connect = async () => {
        const { RebaseWebSocketClient } = await import("./websocket");
        const { FakeWS, deliver } = fakeSocket();
        const client = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:3000",
            WebSocket: FakeWS
        });
        client.ensureConnected();
        await jest.advanceTimersByTimeAsync(1);
        return { client, deliver };
    };

    it("surfaces a channel rate-limit refusal that matches no waiter", async () => {
        const { deliver } = await connect();

        deliver({
            type: "ERROR",
            requestId: "req-the-client-never-registered",
            payload: { error: { message: "Too many channel messages. Please slow down.", code: "RATE_LIMITED" } }
        });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("RATE_LIMITED");
        expect(String(warn.mock.calls[0][0])).toContain("Too many channel messages");
    });

    it("surfaces a refused channel action", async () => {
        const { deliver } = await connect();

        // What the server now sends for a broadcast into a channel the sender
        // never joined — `sendError` addresses it by neither requestId nor
        // channel, so nothing else in the client will ever see it.
        deliver({
            type: "error",
            payload: { error: { message: "Refused broadcast on channel \"doc:42\"", code: "CHANNEL_FORBIDDEN" } },
            error: "Refused broadcast on channel \"doc:42\""
        });

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("CHANNEL_FORBIDDEN");
    });

    it("stays quiet for frames that are not errors", async () => {
        const { deliver } = await connect();

        deliver({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 1 } });
        deliver({ type: "presence_state", channel: "doc:42", presences: {} });

        expect(warn).not.toHaveBeenCalled();
    });
});
