/**
 * Channel history: retention matching, and the broadcast path it changes.
 *
 * The SQL itself is proven against a real Postgres in
 * `test/e2e/channel-history-e2e.test.ts` — sequence allocation under concurrent
 * senders and pruning are not things a mocked `execute` can tell you anything
 * about. What is worth pinning down here is the gating: which channels pay for
 * history, which are refused, and that an unretained channel goes down exactly
 * the code path it went down before this feature existed.
 */

import { RealtimeService } from "../src/services/realtimeService";
import { ChannelHistoryStore, channelMatchesRule, parseTtlMs } from "../src/services/channel-history";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { WebSocket } from "ws";

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
    parsed() {
        return this.send.mock.calls.map(([raw]) => JSON.parse(raw as string));
    }
}

/**
 * A db double that answers the append CTE with an incrementing sequence, so
 * the service's ordering and fan-out can be observed without a database.
 */
function createDb() {
    let seq = 0;
    const execute = jest.fn(async (query: unknown) => {
        if (sqlTextOf(query).includes("INSERT INTO rebase.channel_cursors")) {
            seq += 1;
            return { rows: [{ seq, created_at: new Date("2026-07-20T00:00:00Z") }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    });
    return { execute } as unknown as NodePgDatabase<Record<string, unknown>>;
}

/**
 * Recover the literal SQL from a Drizzle template.
 *
 * The chunks are `StringChunk` objects wrapping a `value: string[]`; joining
 * them directly yields `[object Object]`, which silently matches nothing.
 */
function sqlTextOf(query: unknown): string {
    const chunks = (query as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks;
    if (!Array.isArray(chunks)) return "";
    return chunks
        .map(chunk => (Array.isArray(chunk?.value) ? chunk.value.join("") : ""))
        .join(" ");
}

describe("parseTtlMs", () => {
    it("accepts short duration strings", () => {
        expect(parseTtlMs("500ms")).toBe(500);
        expect(parseTtlMs("30s")).toBe(30_000);
        expect(parseTtlMs("15m")).toBe(900_000);
        expect(parseTtlMs("24h")).toBe(86_400_000);
        expect(parseTtlMs("7d")).toBe(604_800_000);
    });

    it("accepts a raw millisecond count", () => {
        expect(parseTtlMs(1234)).toBe(1234);
    });

    it("refuses what it cannot parse rather than guessing", () => {
        // A misspelt duration silently becoming an aggressive one would delete
        // history the operator meant to keep.
        expect(parseTtlMs("1 week")).toBeUndefined();
        expect(parseTtlMs("soon")).toBeUndefined();
        expect(parseTtlMs("")).toBeUndefined();
        expect(parseTtlMs(0)).toBeUndefined();
        expect(parseTtlMs(-5)).toBeUndefined();
        expect(parseTtlMs(undefined)).toBeUndefined();
    });
});

describe("channelMatchesRule", () => {
    it("matches exactly by default", () => {
        expect(channelMatchesRule("doc:42", { match: "doc:42" })).toBe(true);
        expect(channelMatchesRule("doc:43", { match: "doc:42" })).toBe(false);
    });

    it("treats a trailing star as a prefix", () => {
        expect(channelMatchesRule("doc:42", { match: "doc:*" })).toBe(true);
        expect(channelMatchesRule("doc:", { match: "doc:*" })).toBe(true);
        expect(channelMatchesRule("cursors:42", { match: "doc:*" })).toBe(false);
    });

    it("matches everything on a bare star", () => {
        expect(channelMatchesRule("anything", { match: "*" })).toBe(true);
    });

    it("does not treat a star anywhere else as a wildcard", () => {
        // Deliberately not a glob: a pattern whose reach is not obvious at a
        // glance is the wrong shape for deciding what reaches disk.
        expect(channelMatchesRule("doc:42:live", { match: "doc:*:live" })).toBe(false);
    });
});

describe("ChannelHistoryStore — gating", () => {
    it("is inert with no rules", () => {
        const store = new ChannelHistoryStore(createDb(), []);
        expect(store.enabled).toBe(false);
        expect(store.retentionFor("doc:42")).toBeUndefined();
    });

    it("refuses a rule that would retain forever", () => {
        // Unbounded retention is almost never intended and cannot be walked
        // back once the table has grown.
        const store = new ChannelHistoryStore(createDb(), [{ match: "doc:*" }]);
        expect(store.enabled).toBe(false);
        expect(store.retentionFor("doc:42")).toBeUndefined();
    });

    it("resolves the first matching rule", () => {
        const store = new ChannelHistoryStore(createDb(), [
            { match: "doc:draft:*", limit: 10 },
            { match: "doc:*", limit: 500, ttl: "1h" }
        ]);

        expect(store.retentionFor("doc:draft:7")).toEqual({ limit: 10, ttlMs: undefined });
        expect(store.retentionFor("doc:9")).toEqual({ limit: 500, ttlMs: 3_600_000 });
        expect(store.retentionFor("cursors:9")).toBeUndefined();
    });

    it("creates no schema when nothing retains", async () => {
        const db = createDb();
        const store = new ChannelHistoryStore(db, []);
        await store.ensureTables();
        expect(db.execute).not.toHaveBeenCalled();
    });

    /**
     * Two instances booting into the same database.
     *
     * These tables carry every retained broadcast and sit outside RLS, so the
     * two `REVOKE`s at the end of `ensureTables` are the only thing keeping them
     * off the end-user role. They used to be the tail of one straight sequence:
     * lose the `CREATE TABLE` race — which a peer starting at the same moment
     * causes, measured at 8 losses in 10 with five instances — and the throw
     * skipped them, leaving the history of every channel readable by any
     * signed-in user, with the failure attributed to a create that was harmless.
     */
    it("still revokes after losing a create race with another instance", async () => {
        const statements: string[] = [];
        const db = {
            execute: jest.fn(async (query: unknown) => {
                const text = sqlTextOf(query) || String((query as { sql?: string })?.sql ?? "");
                statements.push(text);
                if (/CREATE TABLE IF NOT EXISTS rebase\.channel_messages/.test(text)) {
                    throw Object.assign(new Error("Failed query"), {
                        cause: Object.assign(new Error("duplicate table"), { code: "42P07" })
                    });
                }
                return { rows: [], rowCount: 0 };
            })
        } as unknown as NodePgDatabase<Record<string, unknown>>;

        const store = new ChannelHistoryStore(db, [{ match: "doc:*", limit: 10 }]);
        await store.ensureTables();

        // First: the race actually happened. Without this the test passes for
        // the wrong reason if the statement text ever changes shape — nothing
        // throws, and "the revokes ran" proves nothing.
        expect(statements.some(s => /CREATE TABLE IF NOT EXISTS rebase\.channel_messages/.test(s))).toBe(true);

        // The point of the test: the statements *after* the losing one ran.
        expect(statements.some(s => /REVOKE/i.test(s) && s.includes("channel_messages"))).toBe(true);
        expect(statements.some(s => /REVOKE/i.test(s) && s.includes("channel_cursors"))).toBe(true);
    });
});

describe("RealtimeService — retained channels", () => {
    let service: RealtimeService;
    let db: NodePgDatabase<Record<string, unknown>>;

    /** Wait for the service's per-channel send queue to drain. */
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    beforeEach(async () => {
        db = createDb();
        service = new RealtimeService(db, new PostgresCollectionRegistry());
        await service.configureChannelHistory([{ match: "doc:*", limit: 100, ttl: "1h" }]);
        // Forget the CREATE TABLEs, so a test can assert that a channel issued
        // no queries of its own.
        (db.execute as jest.Mock).mockClear();
    });

    function join(clientId: string, channel: string) {
        const ws = new MockWebSocket();
        service.addClient(clientId, ws as unknown as WebSocket);
        service.joinChannel(clientId, channel);
        return ws;
    }

    it("numbers broadcasts on a retained channel", async () => {
        join("a", "doc:1");
        const listener = join("b", "doc:1");

        service.broadcastToChannel("a", "doc:1", "op", { n: 1 });
        service.broadcastToChannel("a", "doc:1", "op", { n: 2 });
        await settle();

        const frames = listener.parsed().filter(f => f.type === "broadcast");
        expect(frames.map(f => f.seq)).toEqual([1, 2]);
        expect(frames.map(f => f.payload)).toEqual([{ n: 1 }, { n: 2 }]);
    });

    it("delivers an unretained channel synchronously and unsequenced", () => {
        // The whole point of the opt-in: a presence or cursor channel must not
        // acquire a database round-trip. No await here — if this path had
        // become async, the frame would not have been sent yet.
        join("a", "cursors:1");
        const listener = join("b", "cursors:1");

        service.broadcastToChannel("a", "cursors:1", "cursor", { x: 1 });

        const frames = listener.parsed().filter(f => f.type === "broadcast");
        expect(frames).toHaveLength(1);
        expect(frames[0].seq).toBeUndefined();
        expect(db.execute).not.toHaveBeenCalled();
    });

    it("never echoes a broadcast back to its sender", async () => {
        const sender = join("a", "doc:1");
        join("b", "doc:1");

        service.broadcastToChannel("a", "doc:1", "op", { n: 1 });
        await settle();

        expect(sender.parsed().filter(f => f.type === "broadcast")).toHaveLength(0);
    });

    it("tells a client when a channel keeps no history", async () => {
        const ws = join("a", "cursors:1");

        await service.handleClientMessage("a", {
            type: "channel_history",
            payload: { channel: "cursors:1", sinceSeq: 0 }
        });

        const reply = ws.parsed().find(f => f.type === "channel_history");
        // Not an empty list — a client has to be able to tell "you missed
        // nothing" from "this channel never keeps anything".
        expect(reply).toMatchObject({ channel: "cursors:1", retained: false, messages: [] });
    });

    it("does not deliver a broadcast it could not persist", async () => {
        // Delivering it would put it in front of live subscribers while leaving
        // it out of every future replay — a divergence no later message repairs.
        (db.execute as jest.Mock).mockRejectedValueOnce(new Error("disk on fire"));

        const sender = join("a", "doc:1");
        const listener = join("b", "doc:1");

        service.broadcastToChannel("a", "doc:1", "op", { n: 1 });
        await settle();

        expect(listener.parsed().filter(f => f.type === "broadcast")).toHaveLength(0);
        // And the sender is told, so it can retry rather than assume it landed.
        expect(sender.parsed().some(f => f.type === "error")).toBe(true);
    });

    it("keeps numbering after a failed write", async () => {
        // A poisoned queue would take the channel down with it.
        (db.execute as jest.Mock).mockRejectedValueOnce(new Error("transient"));

        join("a", "doc:1");
        const listener = join("b", "doc:1");

        service.broadcastToChannel("a", "doc:1", "op", { n: 1 });
        service.broadcastToChannel("a", "doc:1", "op", { n: 2 });
        await settle();

        const frames = listener.parsed().filter(f => f.type === "broadcast");
        expect(frames).toHaveLength(1);
        expect(frames[0].payload).toEqual({ n: 2 });
    });
});
