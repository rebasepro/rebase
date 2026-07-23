/**
 * Cross-instance channel broadcast and presence.
 *
 * The bug these cover: broadcast and presence fanned out from per-process maps,
 * so two clients on different replicas could not see each other — and nothing
 * failed, which is why it survived. Every test below therefore runs *two*
 * services wired to one fake bus, because a single service can never reproduce
 * it.
 */

import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { WebSocket } from "ws";
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "../src/services/channel-bus";
import { MemoryChannelBus, frameByteLength, isChannelBusInstance } from "../src/services/channel-bus";
import {
    parseChannelBusFrame,
    parseChannelBusPayload,
    PostgresChannelBus,
    PG_NOTIFY_MAX_PAYLOAD_BYTES
} from "../src/services/channel-bus/PostgresChannelBus";
import { resolveChannelBusSetting, createChannelBus } from "../src/services/channel-bus";

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(null),
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

class MockWebSocket {
    public readyState = WebSocket.OPEN;
    public send = jest.fn();
    public on = jest.fn();
}

/**
 * A third-party transport, written against the published `ChannelBus` contract
 * and nothing else — exactly what a separately shipped bus package would be. It
 * delivers every published frame to the other buses on the same wire, so the
 * "two instances" in each test are as separate as they are in production apart
 * from the transport itself.
 *
 * Its `kind` is deliberately not one of the built-ins: everything the service
 * does with a bus has to work for a transport it has never heard of, and this
 * whole file is the assertion that it does.
 */
class FakeBus implements ChannelBus {
    readonly kind = "test-transport";
    /** Borrowed from the Postgres bus so the size-limit paths are exercised. */
    maxFrameBytes = PG_NOTIFY_MAX_PAYLOAD_BYTES;
    handler?: ChannelBusHandler;
    published: ChannelBusFrame[] = [];
    failNextPublish = false;

    constructor(private readonly wire: FakeBus[]) {
        wire.push(this);
    }

    async start(handler: ChannelBusHandler): Promise<void> {
        this.handler = handler;
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        this.published.push(frame);
        if (this.failNextPublish) {
            this.failNextPublish = false;
            throw new Error("bus down");
        }
        for (const peer of this.wire) {
            if (peer === this) continue;
            await peer.handler?.(frame);
        }
    }

    async stop(): Promise<void> {
        this.handler = undefined;
    }
}

/** Postgres state shared by both services, so the roster really is shared. */
interface FakeDbState {
    presence: Map<string, { channel: string; clientId: string; instanceId: string; state: unknown; lastSeen: number }>;
    messages: Map<string, { seq: number; event: string; payload: unknown; senderId?: string }>;
}

/** Split a drizzle `sql` template into its literal text and its bound values. */
function readQuery(query: unknown): { text: string; params: unknown[] } {
    const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
    const isStringChunk = (c: unknown): c is { value: string[] } =>
        typeof c === "object" && c !== null && Array.isArray((c as { value?: unknown }).value);

    return {
        text: chunks.map(c => (isStringChunk(c) ? c.value.join("") : " ? ")).join(""),
        params: chunks.filter(c => !isStringChunk(c))
    };
}

function createService(state: FakeDbState) {
    // A tiny SQL-shaped interpreter over the shared `state`: enough to answer
    // the handful of statements the presence and history stores issue. It is
    // shared between both services precisely so the roster is one roster.
    const execute = jest.fn(async (query: unknown) => {
        const { text, params } = readQuery(query);

        if (text.includes("INSERT INTO rebase.channel_presence")) {
            const [channel, clientId, instanceId, presenceState] = params as [string, string, string, string];
            state.presence.set(`${channel}::${clientId}`, {
                channel, clientId, instanceId,
                state: JSON.parse(presenceState),
                lastSeen: Date.now()
            });
            return { rows: [] };
        }

        if (text.includes("DELETE FROM rebase.channel_presence")) {
            // The sweep: other instances' rows, older than the TTL, returned.
            if (text.includes("RETURNING")) {
                const [instanceId, ttlSeconds] = params as [string, number];
                const cutoff = Date.now() - ttlSeconds * 1000;
                const rows: Array<{ channel: string; client_id: string; state: unknown }> = [];
                for (const [key, row] of state.presence) {
                    if (row.instanceId !== instanceId && row.lastSeen < cutoff) {
                        rows.push({ channel: row.channel, client_id: row.clientId, state: row.state });
                        state.presence.delete(key);
                    }
                }
                return { rows };
            }
            if (text.includes("instance_id =")) {
                const [instanceId] = params as [string];
                for (const [key, row] of state.presence) {
                    if (row.instanceId === instanceId) state.presence.delete(key);
                }
                return { rows: [] };
            }
            if (text.includes("channel =")) {
                const [channel, clientId] = params as [string, string];
                state.presence.delete(`${channel}::${clientId}`);
                return { rows: [] };
            }
            const [clientId] = params as [string];
            for (const [key, row] of state.presence) {
                if (row.clientId === clientId) state.presence.delete(key);
            }
            return { rows: [] };
        }

        if (text.includes("SELECT client_id, state FROM rebase.channel_presence")) {
            const [channel] = params as [string];
            return {
                rows: [...state.presence.values()]
                    .filter(row => row.channel === channel)
                    .map(row => ({ client_id: row.clientId, state: row.state }))
            };
        }

        if (text.includes("FROM rebase.channel_messages") && text.includes("seq =")) {
            const [channel, seq] = params as [string, number];
            const row = state.messages.get(`${channel}::${seq}`);
            return {
                rows: row
                    ? [{ seq: row.seq, event: row.event, payload: row.payload, sender_id: row.senderId ?? null, created_at: new Date() }]
                    : []
            };
        }

        return { rows: [] };
    });

    const db = { execute } as unknown as NodePgDatabase<Record<string, unknown>>;
    const service = new RealtimeService(db, new PostgresCollectionRegistry());
    return { service, execute };
}

function connect(service: RealtimeService, clientId: string, channel: string): MockWebSocket {
    const ws = new MockWebSocket();
    service.addClient(clientId, ws as unknown as WebSocket);
    service.joinChannel(clientId, channel);
    return ws;
}

function sentMessages(ws: MockWebSocket): Array<Record<string, unknown>> {
    return ws.send.mock.calls.map(call => JSON.parse(call[0] as string));
}

describe("Channel bus — cross-instance broadcast & presence", () => {
    let state: FakeDbState;
    let wire: FakeBus[];
    let a: RealtimeService;
    let b: RealtimeService;

    beforeEach(async () => {
        state = { presence: new Map(), messages: new Map() };
        wire = [];
        ({ service: a } = createService(state));
        ({ service: b } = createService(state));
        await a.configureChannelBus(new FakeBus(wire));
        await b.configureChannelBus(new FakeBus(wire));
        // `snap:*` is retained, so it can use the pointer path; `doc:*` is
        // ephemeral, which is the case that has to refuse an oversized message.
        await a.configureChannelHistory([{ match: "snap:*", limit: 100 }]);
        await b.configureChannelHistory([{ match: "snap:*", limit: 100 }]);
    });

    afterEach(async () => {
        await a.destroy();
        await b.destroy();
        jest.clearAllMocks();
    });

    // =========================================================================
    // Broadcast
    // =========================================================================

    it("delivers a broadcast to a client on another instance", async () => {
        connect(a, "a1", "doc:1");
        const remote = connect(b, "b1", "doc:1");

        a.broadcastToChannel("a1", "doc:1", "op", { x: 1 });
        await flush();

        const frames = sentMessages(remote);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({ type: "broadcast", channel: "doc:1", event: "op", payload: { x: 1 } });
    });

    it("does not echo a frame back to the instance that published it", async () => {
        const sender = connect(a, "a1", "doc:1");
        const sameInstance = connect(a, "a2", "doc:1");

        a.broadcastToChannel("a1", "doc:1", "op", { x: 1 });
        await flush();

        // The sender is skipped, its neighbour is served exactly once (locally,
        // not again when the frame comes back around).
        expect(sender.send).not.toHaveBeenCalled();
        expect(sameInstance.send).toHaveBeenCalledTimes(1);
    });

    it("does not deliver to clients that are not in the channel", async () => {
        connect(a, "a1", "doc:1");
        const elsewhere = connect(b, "b1", "doc:2");

        a.broadcastToChannel("a1", "doc:1", "op", { x: 1 });
        await flush();

        expect(elsewhere.send).not.toHaveBeenCalled();
    });

    it("a failed publish does not break local delivery", async () => {
        const local = connect(a, "a2", "doc:1");
        connect(b, "b1", "doc:1");
        (wire[0] as FakeBus).failNextPublish = true;

        expect(() => a.broadcastToChannel("a1", "doc:1", "op", { x: 1 })).not.toThrow();
        await flush();

        expect(sentMessages(local)[0]).toMatchObject({ event: "op" });
    });

    // =========================================================================
    // The 8 KB NOTIFY ceiling
    // =========================================================================

    it("sends an oversized retained message by reference, and the receiver reads it back", async () => {
        const big = { blob: "x".repeat(PG_NOTIFY_MAX_PAYLOAD_BYTES) };
        state.messages.set("snap:1::7", { seq: 7, event: "snapshot", payload: big });

        connect(a, "a1", "snap:1");
        const remote = connect(b, "b1", "snap:1");

        // What persistAndFanOut publishes once the message is durable.
        (a as unknown as {
            publishBroadcast: (c: string, ch: string, e: string, p: unknown, seq?: number) => void
        }).publishBroadcast("a1", "snap:1", "snapshot", big, 7);
        await flush();

        expect((wire[0] as FakeBus).published[0]).toMatchObject({ kind: "broadcast_ref", seq: 7 });
        const frames = sentMessages(remote);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({ type: "broadcast", event: "snapshot", seq: 7, payload: big });
    });

    it("refuses an oversized ephemeral message rather than delivering it to half the cluster", async () => {
        const sender = connect(a, "a1", "doc:1");
        const remote = connect(b, "b1", "doc:1");

        a.broadcastToChannel("a1", "doc:1", "op", { blob: "x".repeat(PG_NOTIFY_MAX_PAYLOAD_BYTES) });
        await flush();

        // Nothing crossed the bus...
        expect((wire[0] as FakeBus).published).toHaveLength(0);
        expect(remote.send).not.toHaveBeenCalled();
        // ...and the sender was told, instead of being left to find out in prod.
        const error = sentMessages(sender).find(m => m.type === "error");
        expect(error).toMatchObject({ payload: { error: { code: "CHANNEL_BUS_PAYLOAD_TOO_LARGE" } } });
    });

    it("a retained message that has since been pruned is dropped, not delivered empty", async () => {
        const remote = connect(b, "b1", "snap:1");

        await (b as unknown as { handleBusFrame: (f: ChannelBusFrame) => Promise<void> }).handleBusFrame({
            kind: "broadcast_ref", sid: "other-instance", channel: "snap:1", from: "a1", seq: 999
        });

        expect(remote.send).not.toHaveBeenCalled();
    });

    // =========================================================================
    // Presence
    // =========================================================================

    it("presence_state answers with the global roster, not just this instance's clients", async () => {
        const asker = connect(a, "a1", "room:1");
        connect(b, "b1", "room:1");

        a.trackPresence("a1", "room:1", { name: "Alice" });
        b.trackPresence("b1", "room:1", { name: "Bob" });
        await flush();

        asker.send.mockClear();
        a.sendPresenceState("a1", "room:1");
        await flush();

        const state = sentMessages(asker).find(m => m.type === "presence_state");
        expect(state?.presences).toEqual({ a1: { name: "Alice" }, b1: { name: "Bob" } });
    });

    it("a join on one instance reaches clients on the other", async () => {
        connect(a, "a1", "room:1");
        const remote = connect(b, "b1", "room:1");

        a.trackPresence("a1", "room:1", { name: "Alice" });
        await flush();

        const diff = sentMessages(remote).find(m => m.type === "presence_diff");
        expect(diff).toMatchObject({ joins: { a1: { name: "Alice" } }, leaves: {} });
    });

    it("a heartbeat with unchanged state does not re-announce across the bus", async () => {
        connect(a, "a1", "room:1");
        const remote = connect(b, "b1", "room:1");

        a.trackPresence("a1", "room:1", { name: "Alice" });
        await flush();
        remote.send.mockClear();

        a.trackPresence("a1", "room:1", { name: "Alice" });   // the 20s heartbeat
        await flush();
        expect(remote.send).not.toHaveBeenCalled();

        a.trackPresence("a1", "room:1", { name: "Alice", cursor: 4 });  // a real change
        await flush();
        expect(remote.send).toHaveBeenCalledTimes(1);
    });

    it("a disconnect removes the client from the shared roster and tells the other instance", async () => {
        connect(a, "a1", "room:1");
        const remote = connect(b, "b1", "room:1");

        a.trackPresence("a1", "room:1", { name: "Alice" });
        await flush();
        remote.send.mockClear();

        await a.removeClient("a1");
        await flush();

        expect(sentMessages(remote).find(m => m.type === "presence_diff"))
            .toMatchObject({ leaves: { a1: { name: "Alice" } } });
        expect([...state.presence.keys()]).toEqual([]);
    });

    it("reaps presence left behind by an instance that stopped heartbeating", async () => {
        const local = connect(a, "a1", "room:1");
        const remote = connect(b, "b1", "room:1");

        // What a pod that died leaves behind: a row nobody is refreshing.
        state.presence.set("room:1::ghost", {
            channel: "room:1", clientId: "ghost", instanceId: "inst_dead",
            state: { name: "Ghost" }, lastSeen: Date.now() - 60_000
        });

        await (a as unknown as { sweepStalePresence: () => Promise<void> }).sweepStalePresence();
        await flush();

        expect(state.presence.has("room:1::ghost")).toBe(false);
        // Both instances' clients are told, from a single delete.
        expect(sentMessages(local).find(m => m.type === "presence_diff"))
            .toMatchObject({ leaves: { ghost: { name: "Ghost" } } });
        expect(sentMessages(remote).find(m => m.type === "presence_diff"))
            .toMatchObject({ leaves: { ghost: { name: "Ghost" } } });
    });

    it("leaves a live client's presence alone", async () => {
        connect(a, "a1", "room:1");
        connect(b, "b1", "room:1");
        b.trackPresence("b1", "room:1", { name: "Bob" });
        await flush();

        await (a as unknown as { sweepStalePresence: () => Promise<void> }).sweepStalePresence();

        expect(state.presence.has("room:1::b1")).toBe(true);
    });

    it("clears this instance's rows on shutdown rather than leaving ghosts for a TTL", async () => {
        connect(a, "a1", "room:1");
        a.trackPresence("a1", "room:1", { name: "Alice" });
        await flush();
        expect(state.presence.has("room:1::a1")).toBe(true);

        await a.destroy();

        expect(state.presence.has("room:1::a1")).toBe(false);
    });
});

describe("Channel bus — configuration", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("defaults to the memory bus, so a single instance behaves exactly as before", () => {
        delete process.env.REALTIME_CHANNEL_BUS;
        expect(resolveChannelBusSetting(undefined)).toEqual({ type: "memory" });
        expect(createChannelBus({ type: "memory" }, { db: {} as never }).kind).toBe("memory");
    });

    it("lets the environment override a named built-in", () => {
        process.env.REALTIME_CHANNEL_BUS = "postgres";
        expect(resolveChannelBusSetting({ type: "memory" })).toEqual({ type: "postgres" });
    });

    it("keeps configured options when the environment restates the same type", () => {
        process.env.REALTIME_CHANNEL_BUS = "postgres";
        expect(resolveChannelBusSetting({ type: "postgres", connectionString: "postgres://direct/db" }))
            .toEqual({ type: "postgres", connectionString: "postgres://direct/db" });
    });

    it("falls back to memory — rather than failing to boot — when a transport is unusable", () => {
        delete process.env.DATABASE_DIRECT_URL;
        expect(createChannelBus({ type: "postgres" }, { db: {} as never }).kind).toBe("memory");
    });

    it("ignores an unknown REALTIME_CHANNEL_BUS value instead of guessing", () => {
        process.env.REALTIME_CHANNEL_BUS = "redis";
        expect(resolveChannelBusSetting({ type: "postgres" })).toEqual({ type: "postgres" });
    });

    // ── The extension point: a transport that ships as its own package ──

    it("accepts a supplied transport instance and hands it back untouched", () => {
        const supplied = new FakeBus([]);
        expect(createChannelBus(supplied, { db: {} as never })).toBe(supplied);
    });

    it("does not let the environment discard a supplied instance", () => {
        // The env var can only name transports this package can construct, so
        // honouring it here would silently throw away the object the app built.
        process.env.REALTIME_CHANNEL_BUS = "memory";
        const supplied = new FakeBus([]);
        expect(resolveChannelBusSetting(supplied)).toBe(supplied);
    });

    it("recognises an instance structurally, so a separately-versioned package still works", () => {
        // A transport package carries its own copy of @rebasepro/types; an
        // `instanceof` check against ours would reject it. Duck-typing is the
        // point, not a shortcut.
        const foreign = {
            kind: "from-another-package",
            maxFrameBytes: Infinity,
            start: async () => { /* noop */ },
            publish: async () => { /* noop */ },
            stop: async () => { /* noop */ }
        };
        expect(isChannelBusInstance(foreign)).toBe(true);
        expect(isChannelBusInstance({ type: "postgres" })).toBe(false);
        expect(isChannelBusInstance(undefined)).toBe(false);
    });

    it("reports the active transport's own name, built-in or not", async () => {
        const state: FakeDbState = { presence: new Map(), messages: new Map() };
        const { service } = createService(state);
        await service.configureChannelBus(new FakeBus([]));
        expect(service.getChannelBusKind()).toBe("test-transport");
        await service.destroy();
    });

    it("degrades to memory when a supplied transport cannot start", async () => {
        const state: FakeDbState = { presence: new Map(), messages: new Map() };
        const { service } = createService(state);
        const broken: ChannelBus = {
            kind: "broken",
            maxFrameBytes: Infinity,
            start: async () => { throw new Error("cannot reach transport"); },
            publish: async () => { /* noop */ },
            stop: async () => { /* noop */ }
        };

        // Boot survives; cross-instance delivery is what is lost.
        await service.configureChannelBus(broken);
        expect(service.getChannelBusKind()).toBe("memory");
        await service.destroy();
    });
});

describe("Channel bus — frame parsing", () => {
    it("round-trips every frame kind", () => {
        const frames: ChannelBusFrame[] = [
            { kind: "broadcast", sid: "i1", channel: "c", event: "e", from: "x", seq: 3, payload: { a: 1 } },
            { kind: "broadcast_ref", sid: "i1", channel: "c", from: "x", seq: 3 },
            { kind: "presence_diff", sid: "i1", channel: "c", joins: { x: {} }, leaves: {} }
        ];
        for (const frame of frames) {
            expect(parseChannelBusFrame(JSON.stringify(frame))).toEqual(frame);
        }
    });

    it("returns null for anything malformed, so one bad payload cannot stop the listener", () => {
        for (const bad of ["", "{", "null", "[]", '{"kind":"broadcast"}', '{"kind":"nope","sid":"i","channel":"c"}']) {
            expect(parseChannelBusFrame(bad)).toBeNull();
        }
    });

    it("measures frames in bytes, not characters", () => {
        const frame: ChannelBusFrame = { kind: "broadcast", sid: "i", channel: "c", event: "e", payload: "é".repeat(10) };
        expect(frameByteLength(frame)).toBeGreaterThan(JSON.stringify(frame).length - 10);
    });
});

describe("Postgres bus — notify coalescing", () => {
    /** A bus over a db stub that records every payload it was asked to notify. */
    function createBus(batchWindowMs?: number) {
        const notified: string[] = [];
        const db = {
            execute: jest.fn(async (query: unknown) => {
                const { params } = readQuery(query);
                notified.push(String(params[params.length - 1]));
                return { rows: [] };
            })
        } as unknown as NodePgDatabase<Record<string, unknown>>;

        return { bus: new PostgresChannelBus(db, "postgres://unused", { batchWindowMs }), notified };
    }

    const frame = (n: number): ChannelBusFrame => ({
        kind: "broadcast", sid: "i1", channel: "bench", event: "cursor", payload: { n }
    });

    /** Frames carried by a payload, whichever wire shape it used. */
    const carried = (payload: string) => parseChannelBusPayload(payload);

    it("sends the first frame immediately — an idle channel pays no added latency", async () => {
        const { bus, notified } = createBus(20);
        await bus.publish(frame(1));

        expect(notified).toHaveLength(1);
        expect(carried(notified[0])).toHaveLength(1);
        await bus.stop();
    });

    it("coalesces a burst into one notify per window", async () => {
        const { bus, notified } = createBus(20);

        // 1 leading frame + 49 that arrive while the window is open.
        const sends = Array.from({ length: 50 }, (_, i) => bus.publish(frame(i)));
        // The leading frame has gone; the rest are still waiting.
        expect(notified).toHaveLength(1);

        await Promise.all(sends);

        // One query for the leading frame, one for the batch — not fifty.
        expect(notified).toHaveLength(2);
        expect(carried(notified[1])).toHaveLength(49);
        await bus.stop();
    });

    it("delivers every frame it coalesced, in publish order", async () => {
        const { bus, notified } = createBus(20);
        await Promise.all(Array.from({ length: 30 }, (_, i) => bus.publish(frame(i))));

        const delivered = notified.flatMap(carried);
        expect(delivered).toHaveLength(30);
        expect(delivered.map(f => (f.kind === "broadcast" ? (f.payload as { n: number }).n : -1)))
            .toEqual(Array.from({ length: 30 }, (_, i) => i));
        await bus.stop();
    });

    it("resolves a publish only once the frame has actually left", async () => {
        const { bus, notified } = createBus(20);
        await bus.publish(frame(0));                 // opens the window

        let settled = false;
        const queued = bus.publish(frame(1)).then(() => { settled = true; });

        expect(settled).toBe(false);                 // still waiting on the window
        expect(notified).toHaveLength(1);

        await queued;
        expect(settled).toBe(true);
        expect(notified).toHaveLength(2);
        await bus.stop();
    });

    it("keeps a batch under the NOTIFY ceiling by flushing early", async () => {
        const { bus, notified } = createBus(50);
        await bus.publish(frame(0));                 // opens the window

        // Each ~1 KB, so the 7500-byte ceiling forces several flushes rather
        // than one oversized payload that Postgres would reject outright.
        const big = (n: number): ChannelBusFrame => ({
            kind: "broadcast", sid: "i1", channel: "bench", event: "op",
            payload: { n, blob: "x".repeat(1000) }
        });
        await Promise.all(Array.from({ length: 20 }, (_, i) => bus.publish(big(i))));

        expect(notified.length).toBeGreaterThan(2);
        for (const payload of notified) {
            expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(PG_NOTIFY_MAX_PAYLOAD_BYTES);
        }
        // Nothing was dropped in the process.
        expect(notified.flatMap(carried)).toHaveLength(21);
        await bus.stop();
    });

    it("sends a lone frame unwrapped, so a mid-deploy older instance still reads it", async () => {
        const { bus, notified } = createBus(20);
        await bus.publish(frame(7));

        // The legacy single-frame parser must accept it as-is.
        expect(parseChannelBusFrame(notified[0])).toMatchObject({ kind: "broadcast", channel: "bench" });
        await bus.stop();
    });

    it("flushes what is queued on stop rather than dropping it", async () => {
        const { bus, notified } = createBus(10_000);   // a window that will not close on its own
        await bus.publish(frame(0));
        const queued = bus.publish(frame(1));

        expect(notified).toHaveLength(1);
        await bus.stop();
        await queued;

        expect(notified.flatMap(carried)).toHaveLength(2);
    });

    it("sends every frame on its own when coalescing is disabled", async () => {
        const { bus, notified } = createBus(0);
        await Promise.all(Array.from({ length: 5 }, (_, i) => bus.publish(frame(i))));

        expect(notified).toHaveLength(5);
        await bus.stop();
    });
});

describe("Postgres bus — payload parsing", () => {
    it("reads both wire shapes, so builds can mix during a rolling deploy", () => {
        const one: ChannelBusFrame = {
            kind: "broadcast", sid: "i1", channel: "c", event: "e", payload: { a: 1 }
        };
        expect(parseChannelBusPayload(JSON.stringify(one))).toEqual([one]);
        expect(parseChannelBusPayload(JSON.stringify({ batch: [one, one] }))).toEqual([one, one]);
    });

    it("drops the unreadable entries of a batch and keeps the rest", () => {
        const good: ChannelBusFrame = {
            kind: "broadcast", sid: "i1", channel: "c", event: "e", payload: null
        };
        const payload = JSON.stringify({ batch: [good, { kind: "nonsense" }, null, good] });
        expect(parseChannelBusPayload(payload)).toEqual([good, good]);
    });

    it("returns nothing for a payload it cannot read at all", () => {
        for (const bad of ["", "{", "null", "[]", '{"batch":"nope"}']) {
            expect(parseChannelBusPayload(bad)).toEqual([]);
        }
    });
});

describe("Channel bus — memory (default)", () => {
    it("publishes nowhere and starts nothing", async () => {
        const bus = new MemoryChannelBus();
        await expect(bus.start()).resolves.toBeUndefined();
        await expect(bus.publish()).resolves.toBeUndefined();
        await expect(bus.stop()).resolves.toBeUndefined();
        expect(bus.maxFrameBytes).toBe(Infinity);
    });
});

/** Let the fire-and-forget publish/roster promises settle. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
}
