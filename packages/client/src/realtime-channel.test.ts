import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * The channel surface, and specifically the two protocol details it exists to
 * hide: the roster is not pushed on join, and presence expires after 30s.
 */
import {
    RebaseRealtimeChannel,
    type BroadcastEvent,
    type ChannelTransport,
    type PresenceState
} from "./realtime-channel";

/** Stand-in socket that records what was sent and can push frames back. */
function fakeTransport() {
    const sent: Record<string, unknown>[] = [];
    let channelHandler: ((m: Record<string, unknown>) => void) | undefined;
    let reconnectHandler: (() => void) | undefined;

    const transport: ChannelTransport = {
        sendMessage: async (message) => { sent.push(message); return undefined; },
        onChannelMessage: (_channel, handler) => {
            channelHandler = handler;
            return () => { channelHandler = undefined; };
        },
        onReconnect: (handler) => {
            reconnectHandler = handler;
            return () => { reconnectHandler = undefined; };
        }
    };

    return {
        transport,
        sent,
        types: () => sent.map((m) => m.type),
        push: (message: Record<string, unknown>) => channelHandler?.(message),
        reconnect: () => reconnectHandler?.(),
        hasChannelHandler: () => channelHandler !== undefined
    };
}

describe("RebaseRealtimeChannel", () => {
    let fake: ReturnType<typeof fakeTransport>;
    let channel: RebaseRealtimeChannel;

    beforeEach(() => {
        jest.useFakeTimers();
        fake = fakeTransport();
        channel = new RebaseRealtimeChannel("doc:42", fake.transport);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // The server reads every channel message out of a `payload` envelope
    // (`payload?.channel`, `payload?.state`, `payload?.event` — see
    // server-postgres realtimeService). Sending those fields flat does not
    // error: `payload?.channel` reads as undefined, so the client is
    // registered into channel `undefined` with empty state and the echo comes
    // back with no `channel` for `onChannelMessage` to match. Presence and
    // broadcast then go silent with nothing logged anywhere.
    //
    // This shipped once. The tests below asserted only `m.type`, which is
    // identical under both shapes — so they passed while the feature did
    // nothing. These assert the envelope itself.
    describe("wire contract", () => {
        it("wraps every channel message in a payload envelope", async () => {
            await channel.join();
            await channel.track({ cursor: 1 });
            await channel.broadcast("ping", { n: 2 });
            await channel.untrack();
            await channel.leave();

            expect(fake.sent.length).toBeGreaterThan(0);
            for (const message of fake.sent) {
                expect(message).toHaveProperty("payload");
                // The channel name must travel inside the envelope, never beside it.
                expect((message.payload as Record<string, unknown>).channel).toBe("doc:42");
                expect(message).not.toHaveProperty("channel");
            }
        });

        it("carries presence state inside the envelope, not beside it", async () => {
            await channel.track({ name: "Ada" });

            const track = fake.sent.find((m) => m.type === "presence_track");
            expect(track).toMatchObject({
                type: "presence_track",
                payload: { channel: "doc:42", state: { name: "Ada" } }
            });
            // Losing state is the quiet half of the bug: presence still
            // "works", every peer just shows up empty.
            expect(track).not.toHaveProperty("state");
        });

        it("carries broadcast event and payload inside the envelope", async () => {
            await channel.broadcast("saved", { version: 3 });

            expect(fake.sent.find((m) => m.type === "broadcast")).toMatchObject({
                type: "broadcast",
                payload: { channel: "doc:42", event: "saved", payload: { version: 3 } }
            });
        });

        it("carries the catch-up cursor inside the envelope", async () => {
            // Same failure mode as the rest: `payload?.sinceSeq` read flat is
            // undefined, which the server would treat as "replay from zero" —
            // a client asking to resume would silently get the whole history
            // back and re-apply every operation it had already applied.
            const retained = new RebaseRealtimeChannel("doc:42", fake.transport, { history: true });
            await retained.join();

            const request = fake.sent.find((m) => m.type === "channel_history");
            expect(request).toMatchObject({
                type: "channel_history",
                payload: { channel: "doc:42", sinceSeq: 0 }
            });
            expect(request).not.toHaveProperty("sinceSeq");
        });
    });

    describe("history", () => {
        /**
         * A joined channel that asks for catch-up.
         *
         * `settle` answers the join-time history request the way a server does.
         * Without it the channel is legitimately still catching up, and holds
         * live messages back — which is the behaviour one test below asserts on
         * purpose.
         */
        async function retainedChannel({ settle = true } = {}) {
            const c = new RebaseRealtimeChannel("doc:42", fake.transport, { history: true });
            const received: BroadcastEvent[] = [];
            c.onBroadcast((e) => received.push(e));
            await c.join();
            // `onBroadcast` already started a join, so the `await` above returns
            // on the second (idempotent) call while the first is still working
            // through its sends. Let it finish, or the history request has not
            // been made yet and there is nothing for `settle` to answer.
            await jest.advanceTimersByTimeAsync(0);
            if (settle) {
                fake.push({ type: "channel_history", channel: "doc:42", retained: true, messages: [] });
            }
            return { channel: c, received };
        }

        it("asks for history on join, and only when asked to", async () => {
            await channel.join();
            expect(fake.types()).not.toContain("channel_history");

            fake.sent.length = 0;
            const { channel: retained } = await retainedChannel();
            expect(fake.types()).toContain("channel_history");
            expect(retained.sequence).toBe(0);
        });

        it("tracks the sequence of live messages", async () => {
            const { channel: retained, received } = await retainedChannel();

            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 1 }, seq: 1 });
            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 2 }, seq: 2 });

            expect(received.map((e) => e.seq)).toEqual([1, 2]);
            expect(retained.sequence).toBe(2);
        });

        it("delivers replayed messages through the same handlers, marked as replay", async () => {
            const { channel: retained, received } = await retainedChannel();

            fake.push({
                type: "channel_history",
                channel: "doc:42",
                retained: true,
                latestSeq: 2,
                messages: [
                    { seq: 1, event: "op", payload: { n: 1 } },
                    { seq: 2, event: "op", payload: { n: 2 } }
                ]
            });

            expect(received.map((e) => e.payload)).toEqual([{ n: 1 }, { n: 2 }]);
            expect(received.every((e) => e.replayed)).toBe(true);
            expect(retained.sequence).toBe(2);
        });

        it("never re-delivers a message it already saw", async () => {
            // Catch-up ranges overlap with what arrived live — the server
            // cannot know exactly what landed before the socket dropped. The
            // watermark is what makes replaying an overlap harmless.
            const { received } = await retainedChannel();

            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 1 }, seq: 1 });
            fake.push({
                type: "channel_history",
                channel: "doc:42",
                retained: true,
                messages: [
                    { seq: 1, event: "op", payload: { n: 1 } },
                    { seq: 2, event: "op", payload: { n: 2 } }
                ]
            });

            expect(received.map((e) => e.payload)).toEqual([{ n: 1 }, { n: 2 }]);
        });

        it("holds live messages back until the catch-up lands, then orders them", async () => {
            // The subtle one. A live message arriving mid-catch-up would
            // otherwise be delivered first AND advance the watermark past the
            // older messages still in flight — which the catch-up response
            // would then discard as already-seen. Those messages would be lost
            // silently, which is precisely the failure history exists to fix.
            const { channel: retained, received } = await retainedChannel({ settle: false });

            // seq 5 arrives while the replay of 1..4 is still on the wire.
            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 5 }, seq: 5 });
            expect(received).toHaveLength(0);

            fake.push({
                type: "channel_history",
                channel: "doc:42",
                retained: true,
                messages: [
                    { seq: 3, event: "op", payload: { n: 3 } },
                    { seq: 4, event: "op", payload: { n: 4 } }
                ]
            });

            expect(received.map((e) => e.seq)).toEqual([3, 4, 5]);
            expect(retained.sequence).toBe(5);
        });

        it("leaves unsequenced channels completely untouched", async () => {
            // An ephemeral channel retains nothing, so its broadcasts carry no
            // seq. They must not be buffered, deduped or reordered.
            const received: BroadcastEvent[] = [];
            channel.onBroadcast((e) => received.push(e));
            await channel.join();

            fake.push({ type: "broadcast", channel: "doc:42", event: "cursor", payload: { x: 1 } });
            fake.push({ type: "broadcast", channel: "doc:42", event: "cursor", payload: { x: 2 } });

            expect(received.map((e) => e.payload)).toEqual([{ x: 1 }, { x: 2 }]);
            expect(received.every((e) => e.seq === undefined)).toBe(true);
            expect(channel.sequence).toBe(0);
        });

        it("resumes from the last sequence on reconnect", async () => {
            const { channel: retained } = await retainedChannel();
            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 1 }, seq: 7 });
            fake.sent.length = 0;

            fake.reconnect();
            await jest.advanceTimersByTimeAsync(0);

            expect(fake.types()).toEqual(["join_channel", "presence_state", "channel_history"]);
            expect(fake.sent.at(-1)).toMatchObject({ payload: { channel: "doc:42", sinceSeq: 7 } });
            expect(retained.sequence).toBe(7);
        });

        it("stops holding messages back if the catch-up never arrives", async () => {
            // Buffering is only safe because the wait is bounded. A reply that
            // never comes would otherwise leave the channel silently swallowing
            // every edit from then on — worse than the problem replay solves.
            const { received } = await retainedChannel({ settle: false });

            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: { n: 1 }, seq: 1 });
            expect(received).toHaveLength(0);

            await jest.advanceTimersByTimeAsync(11_000);

            expect(received.map((e) => e.payload)).toEqual([{ n: 1 }]);
        });

        it("reports a channel that keeps no history, rather than an empty one", async () => {
            const { channel: retained } = await retainedChannel();

            const pending = retained.history();
            await jest.advanceTimersByTimeAsync(0);
            fake.push({ type: "channel_history", channel: "doc:42", retained: false, messages: [] });

            // The distinction matters: `retained: false` tells a client its
            // reconnect strategy has to be a full resync.
            await expect(pending).resolves.toEqual({
                messages: [], retained: false, latestSeq: undefined
            });
        });

        it("upgrades an existing channel when history is asked for later", async () => {
            // The client hands back the same object per name, so a later
            // `channel(name, { history: true })` has nothing new to configure.
            await channel.join();
            fake.sent.length = 0;

            channel.enableHistory();
            await jest.advanceTimersByTimeAsync(0);

            expect(fake.types()).toContain("channel_history");
        });

        it("forgets its position on leave, so a rejoin does not skip the past", async () => {
            const { channel: retained } = await retainedChannel();
            fake.push({ type: "broadcast", channel: "doc:42", event: "op", payload: {}, seq: 9 });
            expect(retained.sequence).toBe(9);

            await retained.leave();

            expect(retained.sequence).toBe(0);
        });
    });

    describe("joining", () => {
        it("asks for the roster, because joining does not push it", async () => {
            // A joining client's presence_diff contains only itself, so
            // without this request the channel believes it is alone until
            // somebody else happens to move.
            await channel.join();

            expect(fake.types()).toEqual(["join_channel", "presence_state"]);
        });

        it("joins only once across repeated calls", async () => {
            await channel.join();
            await channel.join();
            await channel.broadcast("ping", {});

            expect(fake.types().filter((t) => t === "join_channel")).toHaveLength(1);
        });
    });

    describe("presence", () => {
        it("reports the roster from a presence_state frame", async () => {
            const seen: PresenceState[] = [];
            channel.onPresence((state) => seen.push(state));
            await channel.join();

            fake.push({ type: "presence_state", channel: "doc:42", presences: { a: { name: "Ana" } } });

            expect(seen.at(-1)).toEqual({ a: { name: "Ana" } });
        });

        it("maintains the roster across diffs so callers never reassemble it", async () => {
            const seen: PresenceState[] = [];
            channel.onPresence((state) => seen.push(state));
            await channel.join();

            fake.push({ type: "presence_state", channel: "doc:42", presences: { a: { name: "Ana" } } });
            fake.push({ type: "presence_diff", channel: "doc:42", joins: { b: { name: "Bo" } }, leaves: {} });

            expect(seen.at(-1)).toEqual({ a: { name: "Ana" }, b: { name: "Bo" } });

            fake.push({ type: "presence_diff", channel: "doc:42", joins: {}, leaves: { a: { name: "Ana" } } });

            expect(seen.at(-1)).toEqual({ b: { name: "Bo" } });
        });

        it("passes the diff alongside the full state", async () => {
            let lastDiff: unknown;
            channel.onPresence((_state, diff) => { lastDiff = diff; });
            await channel.join();

            fake.push({ type: "presence_diff", channel: "doc:42", joins: { b: { x: 1 } }, leaves: {} });

            expect(lastDiff).toEqual({ joins: { b: { x: 1 } }, leaves: {} });
        });

        it("re-sends presence on a timer, because it expires after 30s", async () => {
            // Server-side PRESENCE_TIMEOUT_MS is 30s. A client that tracks once
            // and goes quiet vanishes from everyone else's roster while still
            // sitting in the document.
            await channel.track({ cursor: 1 });
            expect(fake.types().filter((t) => t === "presence_track")).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(21_000);
            expect(fake.types().filter((t) => t === "presence_track")).toHaveLength(2);

            await jest.advanceTimersByTimeAsync(21_000);
            expect(fake.types().filter((t) => t === "presence_track")).toHaveLength(3);
        });

        it("heartbeats within the expiry window", async () => {
            await channel.track({ cursor: 1 });
            const before = fake.types().filter((t) => t === "presence_track").length;

            // One beat must land comfortably before 30s, and with enough margin
            // that a single dropped frame is not a disappearance.
            await jest.advanceTimersByTimeAsync(25_000);

            expect(fake.types().filter((t) => t === "presence_track").length).toBeGreaterThan(before);
        });

        it("heartbeats the latest state after a re-track", async () => {
            await channel.track({ cursor: 1 });
            await channel.track({ cursor: 99 });

            await jest.advanceTimersByTimeAsync(21_000);

            const beats = fake.sent.filter((m) => m.type === "presence_track");
            expect(beats.at(-1)).toMatchObject({ payload: { channel: "doc:42", state: { cursor: 99 } } });
        });

        it("stops the heartbeat on untrack", async () => {
            await channel.track({ cursor: 1 });
            await channel.untrack();
            const after = fake.types().filter((t) => t === "presence_track").length;

            await jest.advanceTimersByTimeAsync(60_000);

            expect(fake.types().filter((t) => t === "presence_track")).toHaveLength(after);
        });
    });

    describe("broadcast", () => {
        it("delivers events to a handler", async () => {
            const received: unknown[] = [];
            channel.onBroadcast((e) => received.push(e));
            await channel.join();

            fake.push({ type: "broadcast", channel: "doc:42", event: "edit", payload: { at: 3 } });

            expect(received).toEqual([{ event: "edit", payload: { at: 3 } }]);
        });

        it("filters by event name when one is given", async () => {
            const received: unknown[] = [];
            channel.onBroadcast("edit", (payload) => received.push(payload));
            await channel.join();

            fake.push({ type: "broadcast", channel: "doc:42", event: "other", payload: { no: true } });
            fake.push({ type: "broadcast", channel: "doc:42", event: "edit", payload: { yes: true } });

            expect(received).toEqual([{ yes: true }]);
        });

        it("stops delivering after the returned unsubscribe", async () => {
            const received: unknown[] = [];
            const off = channel.onBroadcast((e) => received.push(e));
            await channel.join();
            off();

            fake.push({ type: "broadcast", channel: "doc:42", event: "edit", payload: {} });

            expect(received).toEqual([]);
        });
    });

    describe("reconnect", () => {
        it("re-joins, re-requests the roster and re-tracks", async () => {
            // A reconnect drops server-side membership and presence. Nothing
            // else notices: the socket returns and the client just stops
            // receiving.
            await channel.track({ cursor: 7 });
            fake.sent.length = 0;

            fake.reconnect();
            await jest.advanceTimersByTimeAsync(0);

            expect(fake.types()).toEqual(["join_channel", "presence_state", "presence_track"]);
            expect(fake.sent.at(-1)).toMatchObject({ payload: { channel: "doc:42", state: { cursor: 7 } } });
        });

        it("does not re-track when the client never tracked", async () => {
            await channel.join();
            fake.sent.length = 0;

            fake.reconnect();
            await jest.advanceTimersByTimeAsync(0);

            expect(fake.types()).toEqual(["join_channel", "presence_state"]);
        });
    });

    describe("anonymous callers", () => {
        it("sends channel frames without an account", async () => {
            // The motivating case, and one unit tests over a fake transport
            // cannot see: `doSendMessage` gated every non-AUTHENTICATE frame on
            // `ensureAuthenticated`, which throws "user not logged in" when
            // there is no token — so on an anonymous-first app every channel
            // operation failed client-side and the server never decided.
            // Presence in a public room needs no account.
            const { RebaseWebSocketClient } = await import("./websocket");

            const sent: Record<string, unknown>[] = [];
            class FakeWS {
                static readonly OPEN = 1;
                readyState = 1;
                onopen: (() => void) | null = null;
                onclose: (() => void) | null = null;
                onerror: (() => void) | null = null;
                onmessage: (() => void) | null = null;
                constructor(public url: string) {
                    setTimeout(() => this.onopen?.(), 0);
                }
                send(raw: string) { sent.push(JSON.parse(raw)); }
                close() { /* noop */ }
            }

            const ws = new RebaseWebSocketClient({
                websocketUrl: "ws://localhost:1234",
                WebSocket: FakeWS as unknown as typeof WebSocket,
                // Signed out: exactly what an anonymous visitor has.
                getAuthToken: async () => ""
            });

            const anonChannel = new RebaseRealtimeChannel("public:lobby", ws);
            // The frames queue until the socket opens, and under fake timers
            // the socket only opens when the clock is advanced — so awaiting
            // join() first would deadlock against the open it is waiting for.
            const joined = anonChannel.join();
            await jest.advanceTimersByTimeAsync(10);
            await joined;

            expect(sent.map((m) => m.type)).toEqual(["join_channel", "presence_state"]);
        });
    });

    describe("leave", () => {
        it("releases the socket handler, the timer and the listeners", async () => {
            const received: unknown[] = [];
            channel.onBroadcast((e) => received.push(e));
            await channel.track({ cursor: 1 });

            await channel.leave();

            expect(fake.types().at(-1)).toBe("leave_channel");
            expect(fake.hasChannelHandler()).toBe(false);

            const beats = fake.types().filter((t) => t === "presence_track").length;
            await jest.advanceTimersByTimeAsync(60_000);
            expect(fake.types().filter((t) => t === "presence_track")).toHaveLength(beats);
        });

        it("can rejoin after leaving", async () => {
            await channel.join();
            await channel.leave();
            fake.sent.length = 0;

            await channel.join();

            expect(fake.types()).toEqual(["join_channel", "presence_state"]);
        });
    });
});
