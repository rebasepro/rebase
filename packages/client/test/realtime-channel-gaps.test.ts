import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { ChannelHistoryEntry, ChannelMessage } from "@rebasepro/types";
import { RebaseRealtimeChannel, type BroadcastEvent, type ChannelTransport } from "../src/realtime-channel";

/**
 * A hole in a retained channel's sequence is filled, not stepped over.
 *
 * Every retained message is numbered densely. The client kept a watermark and
 * dropped anything at or below it, so a message that reached it after a later
 * one — or never — was gone for good: a frame lost between instances, or two
 * instances on a bus that does not order, left collaborators' documents
 * silently diverged. A jump past `lastSeq + 1` now holds the message back and
 * asks the server for what lies between.
 *
 * A hole only means "missed" when the client's own messages leave none: the
 * server never echoes a broadcast to its sender. So it is checked only against
 * a server that agreed to `channel_seq`, which sends the sender a
 * `broadcast_ack` with the number its message took. Against any other server
 * the old behaviour stands.
 */

const CHANNEL = "doc:1";

function fakeTransport(optIns: string[], socketClientId?: string) {
    const sent: Record<string, unknown>[] = [];
    let channelHandler: ((m: ChannelMessage) => void) | undefined;
    const transport: ChannelTransport = {
        sendMessage: async (message) => {
            sent.push(message);
            return undefined;
        },
        onChannelMessage: (_channel, handler) => {
            channelHandler = handler;
            return () => {
                channelHandler = undefined;
            };
        },
        onReconnect: () => () => undefined,
        hasServerOptIn: (name) => optIns.includes(name),
        socketClientId
    };
    return {
        transport,
        historyAsks: () => sent.filter((m) => m.type === "channel_history").map((m) => (m.payload as { sinceSeq: number }).sinceSeq),
        push: (message: ChannelMessage) => channelHandler?.(message)
    };
}

const live = (seq: number, event = "op"): ChannelMessage => ({ type: "broadcast", channel: CHANNEL, event, payload: { seq }, seq });
const entry = (seq: number, senderId = "someone"): ChannelHistoryEntry => ({ seq, event: "op", payload: { seq }, senderId, at: "2026-10-13T00:00:00Z" });

describe("gaps on a retained channel", () => {
    let received: BroadcastEvent[];

    beforeEach(() => {
        jest.useFakeTimers();
        received = [];
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    async function joinedChannel(optIns: string[], socketClientId?: string) {
        const fake = fakeTransport(optIns, socketClientId);
        const channel = new RebaseRealtimeChannel(CHANNEL, fake.transport);
        channel.onBroadcast((event) => received.push(event));
        await channel.join();
        return { fake, channel };
    }

    it("a message past a hole waits for the hole to be filled, and all arrive in order", async () => {
        const { fake } = await joinedChannel(["channel_seq"]);
        fake.push(live(1));
        fake.push(live(3));
        // 3 is held back, and what lies after 1 is asked for.
        expect(received.map((e) => e.seq)).toEqual([1]);
        expect(fake.historyAsks()).toEqual([1]);

        fake.push({ type: "channel_history", channel: CHANNEL, messages: [entry(2), entry(3)], retained: true, latestSeq: 3 });
        expect(received.map((e) => e.seq)).toEqual([1, 2, 3]);
        expect(received[1].replayed).toBe(true);
    });

    it("its own message, acknowledged, is not a hole", async () => {
        const { fake } = await joinedChannel(["channel_seq"], "me");
        fake.push(live(1));
        fake.push({ type: "broadcast_ack", channel: CHANNEL, seq: 2 });
        fake.push(live(3));
        expect(received.map((e) => e.seq)).toEqual([1, 3]);
        expect(fake.historyAsks()).toEqual([]);
    });

    it("an acknowledgement that overtakes a missed message fills the hole too, and its own message is not delivered back", async () => {
        const { fake } = await joinedChannel(["channel_seq"], "me");
        fake.push(live(1));
        fake.push({ type: "broadcast_ack", channel: CHANNEL, seq: 3 });
        expect(fake.historyAsks()).toEqual([1]);
        fake.push({ type: "channel_history", channel: CHANNEL, messages: [entry(2), entry(3, "me")], retained: true, latestSeq: 3 });
        expect(received.map((e) => e.seq)).toEqual([1, 2]);
        fake.push(live(4));
        expect(received.map((e) => e.seq)).toEqual([1, 2, 4]);
    });

    it("after a reconnect, its own message from the previous socket is not replayed back to it", async () => {
        // The ack for a broadcast sent just before the socket dropped was
        // lost; the catch-up on the new socket replays it from history under
        // the old socket's id, and the sender applied its own op twice.
        let socketId = "me-1";
        let reconnect: (() => void) | undefined;
        const sent: Record<string, unknown>[] = [];
        let handler: ((m: ChannelMessage) => void) | undefined;
        const transport: ChannelTransport = {
            sendMessage: async (message) => { sent.push(message); return undefined; },
            onChannelMessage: (_channel, h) => { handler = h; return () => { handler = undefined; }; },
            onReconnect: (h) => { reconnect = h; return () => undefined; },
            hasServerOptIn: (name) => name === "channel_seq",
            get socketClientId() { return socketId; }
        };
        const channel = new RebaseRealtimeChannel(CHANNEL, transport);
        channel.onBroadcast((event) => received.push(event));
        await channel.join();
        handler?.(live(1));
        await channel.broadcast("op", { mine: true });

        socketId = "me-2";
        reconnect?.();
        await Promise.resolve();
        handler?.({ type: "broadcast_ack", channel: CHANNEL, seq: 4 });
        handler?.({ type: "channel_history", channel: CHANNEL, messages: [entry(2, "me-1"), entry(3), entry(4, "me-2")], retained: true, latestSeq: 4 });

        expect(received.map((e) => e.seq)).toEqual([1, 3]);
    });

    it("against a server that does not number the sender's messages, a jump is delivered as before", async () => {
        const { fake } = await joinedChannel([]);
        fake.push(live(1));
        fake.push(live(3));
        expect(received.map((e) => e.seq)).toEqual([1, 3]);
        expect(fake.historyAsks()).toEqual([]);
    });

    it("the first message a client sees is a position, not a hole", async () => {
        const { fake } = await joinedChannel(["channel_seq"]);
        fake.push(live(7));
        expect(received.map((e) => e.seq)).toEqual([7]);
        expect(fake.historyAsks()).toEqual([]);
    });
});
