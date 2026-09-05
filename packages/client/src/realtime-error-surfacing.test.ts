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

/**
 * The console warning was the floor, not the answer. The server now names the
 * channel on a refusal about one, which is all the client needed: channel
 * frames were already routed by name, so a named error reaches the channel it
 * is about and `channel.onError()` observes it.
 *
 * `broadcast()` still resolves on write. A collaborative app broadcasts sixty
 * times a second; making each one wait for an acknowledgement would turn a
 * fire-and-forget frame into a round trip, which is the reason it is
 * fire-and-forget in the first place.
 */
describe("the socket routes a named error to its channel", () => {
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

    it("delivers it to that channel's handlers and to no others", async () => {
        const { client, deliver } = await connect();
        const mine: unknown[] = [];
        const theirs: unknown[] = [];
        client.onChannelMessage("doc:42", (m) => mine.push(m));
        client.onChannelMessage("doc:99", (m) => theirs.push(m));

        deliver({
            type: "error",
            channel: "doc:42",
            payload: {
                error: { message: 'Refused broadcast on channel "doc:42": not a member', code: "CHANNEL_FORBIDDEN" },
                channel: "doc:42"
            }
        });

        expect(mine).toHaveLength(1);
        expect(theirs).toHaveLength(0);
        // Routed, so the catch-all warning does not also fire.
        expect(warn).not.toHaveBeenCalled();
    });

    it("still warns for an error that names no channel", async () => {
        // Including one from a server older than the change that names it.
        const { deliver } = await connect();

        deliver({
            type: "ERROR",
            payload: { error: { message: "Too many channel messages.", code: "RATE_LIMITED" } }
        });

        expect(warn).toHaveBeenCalledTimes(1);
    });
});

/**
 * The channel end of the same path, against the transport seam rather than a
 * socket — `ChannelTransport` is the interface `RebaseRealtimeChannel` is
 * written against.
 */
describe("channel.onError", () => {
    let warn: any;

    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    const openChannel = async (name: string) => {
        const { RebaseRealtimeChannel } = await import("./realtime-channel");
        let deliver: (message: Record<string, unknown>) => void = () => {};
        const transport = {
            sendMessage: jest.fn(async () => undefined),
            onChannelMessage: (_channel: string, handler: (m: Record<string, unknown>) => void) => {
                deliver = handler;
                return () => {};
            },
            onReconnect: () => () => {}
        };
        const channel = new RebaseRealtimeChannel(name, transport, {});
        await channel.join();
        return { channel, deliver: (m: Record<string, unknown>) => deliver(m) };
    };

    const refusal = {
        type: "error",
        channel: "doc:42",
        payload: {
            error: { message: 'Refused broadcast on channel "doc:42": not a member', code: "CHANNEL_FORBIDDEN" },
            channel: "doc:42"
        }
    };

    it("hands a CHANNEL_FORBIDDEN to the handler", async () => {
        const { channel, deliver } = await openChannel("doc:42");
        const seen: { message: string; code?: string }[] = [];
        channel.onError((e) => seen.push({ message: e.message, code: e.code }));

        deliver(refusal);

        expect(seen).toHaveLength(1);
        expect(seen[0].code).toBe("CHANNEL_FORBIDDEN");
        expect(seen[0].message).toContain("not a member");
        expect(warn).not.toHaveBeenCalled();
    });

    it("warns when nobody is watching, rather than dropping it", async () => {
        const { deliver } = await openChannel("doc:42");

        deliver(refusal);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("CHANNEL_FORBIDDEN");
        expect(String(warn.mock.calls[0][0])).toContain("onError");
    });

    it("stops delivering after unsubscribe", async () => {
        const { channel, deliver } = await openChannel("doc:42");
        const seen: unknown[] = [];
        const off = channel.onError((e) => seen.push(e));

        deliver(refusal);
        off();
        deliver(refusal);

        expect(seen).toHaveLength(1);
    });
});
