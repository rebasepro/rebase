/**
 * E2E: ordered, replayable channel history — two real clients, one real server.
 *
 * The bug this shape of test exists to catch: a previous channel defect shipped
 * because the e2e drove the client against *itself*. Both halves agreed on a
 * wire format the server did not implement, and every assertion passed while
 * the feature did nothing (see `c44a9e9a0` — fields sent flat instead of inside
 * the `payload` envelope). So nothing here is faked. There is a real Postgres
 * container, a real HTTP server running the real `createPostgresWebSocket`
 * handler, and two independent `RebaseWebSocketClient`s talking over real
 * sockets — the same class an application uses.
 *
 * Nothing is reached for through a test-only hatch either: the drop is a real
 * socket close that the client did not ask for, and readiness is established by
 * a real round-trip rather than by inspecting server internals.
 *
 * The scenario is the one from Dadaki's readiness note: a client that drops off
 * mid-session must catch up on the operations it missed instead of resyncing
 * the whole document.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { ChannelHistoryStore } from "../../src/services/channel-history.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { RebaseWebSocketClient, RebaseRealtimeChannel, type BroadcastEvent } from "@rebasepro/client";
import type { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";

/** A retained channel and an ephemeral one, to prove the opt-in actually gates. */
const RETAINED = "doc:42";
const EPHEMERAL = "cursors:42";

const RETENTION_LIMIT = 50;

async function waitFor(
    predicate: () => boolean | Promise<boolean>,
    message: string,
    timeoutMs = 20_000,
    stepMs = 25
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await predicate()) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${message}`);
        await new Promise(r => setTimeout(r, stepMs));
    }
}

describe("Channel history (E2E, two real clients)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let db: ReturnType<typeof drizzle>;
    let realtime: RealtimeService;
    let server: Server;
    let port: number;

    /** Every client a test opened, released between tests. */
    let openClients: RebaseWebSocketClient[] = [];

    function connect(): RebaseWebSocketClient {
        const client = new RebaseWebSocketClient({
            websocketUrl: `ws://localhost:${port}`,
            WebSocket: NodeWebSocket as unknown as typeof WebSocket
        });
        openClients.push(client);
        return client;
    }

    /**
     * Wait until the server has processed this channel's `join_channel`.
     *
     * `history()` only resolves once the server has answered, and frames on one
     * socket are processed in order, so a reply to a request sent *after* the
     * join proves the join landed. No server internals are consulted.
     */
    async function joined(channel: RebaseRealtimeChannel): Promise<void> {
        await channel.join();
        await channel.history({ sinceSeq: channel.sequence });
    }

    /** How many messages are durably stored for a channel. */
    async function storedCount(channel: string): Promise<number> {
        const r = await db.execute(
            sql`SELECT COUNT(*)::int AS n FROM rebase.channel_messages WHERE channel = ${channel}`
        );
        return (r.rows[0] as { n: number }).n;
    }

    /**
     * Kill a client's socket the way a network does: close the underlying
     * connection without telling the client. `client.disconnect()` is not a
     * substitute — it deliberately suppresses the reconnect path, which is the
     * code under test.
     */
    function dropSocket(client: RebaseWebSocketClient): void {
        const socket = (client as unknown as { ws: { close(): void } | null }).ws;
        if (!socket) throw new Error("Client has no socket to drop");
        socket.close();
    }

    beforeAll(async () => {
        container = await startPgContainer();

        pool = new pg.Pool({ connectionString: container.connectionString });
        for (let i = 0; ; i++) {
            try {
                await pool.query("SELECT 1");
                break;
            } catch (e) {
                if (i >= 15) throw e;
                await new Promise(r => setTimeout(r, 500));
            }
        }

        db = drizzle(pool);
        realtime = new RealtimeService(db as never, new PostgresCollectionRegistry());

        // Opt in for `doc:*` only. `cursors:*` matches nothing, so it must keep
        // the original fire-and-forget behaviour and touch no storage at all.
        await realtime.configureChannelHistory([
            { match: "doc:*", limit: RETENTION_LIMIT, ttl: "1h" }
        ]);

        server = createServer();
        // `requireAuth: false` has to be said now. It used to be what *omitting*
        // the auth config meant, and this line relied on that — but the socket
        // defaulting open while the HTTP routes defaulted closed was the bug
        // 80fb57e08 fixed, so an absent config now means "require auth" and
        // every frame below would come back UNAUTHORIZED.
        //
        // Opting out is right here: what is under test is channel mechanics —
        // ordering, replay, retention — on an anonymous public channel. The
        // authenticated socket path is covered end-to-end by client-sdk-e2e.
        // The driver is unused by channel frames.
        createPostgresWebSocket(server, realtime, {} as unknown as PostgresBackendDriver, { requireAuth: false });

        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server port");
        port = address.port;
    });

    afterAll(async () => {
        for (const client of openClients) client.disconnect(true);
        await realtime.destroy();
        await new Promise<void>(resolve => server?.close(() => resolve()));
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    beforeEach(async () => {
        for (const client of openClients) client.disconnect(true);
        openClients = [];
        // Each test starts from an empty channel so sequence numbers are
        // predictable. Clearing the cursor here is a test convenience; the
        // "prunes without rewinding" case below is what asserts production
        // never does it.
        await db.execute(sql`DELETE FROM rebase.channel_messages`);
        await db.execute(sql`DELETE FROM rebase.channel_cursors`);
    });

    it("delivers live, then replays exactly what a dropped client missed", async () => {
        const clientA = connect();
        const clientB = connect();

        const channelA = new RebaseRealtimeChannel(RETAINED, clientA, { history: true });
        const channelB = new RebaseRealtimeChannel(RETAINED, clientB, { history: true });

        const receivedByB: BroadcastEvent[] = [];
        channelB.onBroadcast(e => receivedByB.push(e));

        await joined(channelA);
        await joined(channelB);

        // ── 1. Live delivery, carrying sequence numbers ──
        await channelA.broadcast("op", { n: 1 });
        await channelA.broadcast("op", { n: 2 });
        await waitFor(() => receivedByB.length === 2, "B received the first two ops live");

        expect(receivedByB.map(e => (e.payload as { n: number }).n)).toEqual([1, 2]);
        expect(receivedByB.map(e => e.seq)).toEqual([1, 2]);
        expect(receivedByB.every(e => !e.replayed)).toBe(true);
        expect(channelB.sequence).toBe(2);

        // ── 2. A real drop ──
        dropSocket(clientB);

        // ── 3. Broadcasts into the gap ──
        await channelA.broadcast("op", { n: 3 });
        await channelA.broadcast("op", { n: 4 });
        await channelA.broadcast("op", { n: 5 });
        await waitFor(() => storedCount(RETAINED).then(n => n === 5), "the missed ops are durable");

        // ── 4. B reconnects on its own and catches up ──
        await waitFor(() => receivedByB.length === 5, "B caught up on the three missed ops", 40_000);

        expect(receivedByB.map(e => (e.payload as { n: number }).n)).toEqual([1, 2, 3, 4, 5]);
        expect(receivedByB.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
        // The three it missed arrived as replay; the two it already had were not resent.
        expect(receivedByB.map(e => e.replayed === true)).toEqual([false, false, true, true, true]);
        expect(channelB.sequence).toBe(5);

        // Give any duplicate delivery a chance to appear.
        await new Promise(r => setTimeout(r, 750));
        expect(receivedByB).toHaveLength(5);

        // The server must have honoured `sinceSeq` rather than resending
        // everything and leaving the client to discard the overlap. Asserted on
        // the raw response, because client-side de-duplication would hide a
        // server that ignored the cursor — which is exactly what a `sinceSeq`
        // sent beside the `payload` envelope instead of inside it would look
        // like from the outside.
        const raw = await channelB.history({ sinceSeq: 2 });
        expect(raw.retained).toBe(true);
        expect(raw.messages.map(m => m.seq)).toEqual([3, 4, 5]);
        expect(raw.latestSeq).toBe(5);
    });

    it("replays for a client that was never present", async () => {
        // What a page reload looks like: no prior membership, `sinceSeq` of 0.
        const author = connect();
        const authorChannel = new RebaseRealtimeChannel(RETAINED, author, { history: true });
        await joined(authorChannel);
        await authorChannel.broadcast("op", { n: "a" });
        await authorChannel.broadcast("op", { n: "b" });
        await waitFor(() => storedCount(RETAINED).then(n => n === 2), "both ops durable");

        const latecomer = connect();
        const latecomerChannel = new RebaseRealtimeChannel(RETAINED, latecomer, { history: true });
        const seen: BroadcastEvent[] = [];
        latecomerChannel.onBroadcast(e => seen.push(e));
        await latecomerChannel.join();

        await waitFor(() => seen.length === 2, "latecomer replayed both ops");
        expect(seen.map(e => e.payload)).toEqual([{ n: "a" }, { n: "b" }]);
        expect(seen.map(e => e.seq)).toEqual([1, 2]);
        expect(seen.every(e => e.replayed)).toBe(true);
    });

    it("keeps ephemeral channels free of history entirely", async () => {
        const clientA = connect();
        const clientB = connect();

        const channelA = new RebaseRealtimeChannel(EPHEMERAL, clientA, { history: true });
        const channelB = new RebaseRealtimeChannel(EPHEMERAL, clientB, { history: true });

        const received: BroadcastEvent[] = [];
        channelB.onBroadcast(e => received.push(e));

        await joined(channelA);
        await joined(channelB);

        await channelA.broadcast("cursor", { x: 10 });
        await waitFor(() => received.length === 1, "cursor delivered");

        // Delivered, but unsequenced — and nothing was written for it.
        expect(received[0].payload).toEqual({ x: 10 });
        expect(received[0].seq).toBeUndefined();
        expect(channelB.sequence).toBe(0);
        expect(await storedCount(EPHEMERAL)).toBe(0);

        // And the channel says so explicitly, rather than an empty list a
        // client could mistake for "you missed nothing".
        const result = await channelB.history();
        expect(result.retained).toBe(false);
        expect(result.messages).toEqual([]);
    });

    it("assigns one dense, gapless order under concurrent senders", async () => {
        // Two clients broadcasting at once is the ordinary case for co-editing.
        // If sequence allocation raced, this is where duplicates or gaps appear.
        const clientA = connect();
        const clientB = connect();
        const channelA = new RebaseRealtimeChannel(RETAINED, clientA, { history: true });
        const channelB = new RebaseRealtimeChannel(RETAINED, clientB, { history: true });
        await joined(channelA);
        await joined(channelB);

        await Promise.all([
            ...Array.from({ length: 10 }, (_, i) => channelA.broadcast("op", { from: "A", i })),
            ...Array.from({ length: 10 }, (_, i) => channelB.broadcast("op", { from: "B", i }))
        ]);

        await waitFor(() => storedCount(RETAINED).then(n => n === 20), "all 20 messages persisted");

        const rows = await db.execute(
            sql`SELECT seq FROM rebase.channel_messages WHERE channel = ${RETAINED} ORDER BY seq ASC`
        );
        const seqs = (rows.rows as { seq: string }[]).map(r => Number(r.seq));
        expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it("prunes past the retention limit without ever rewinding the sequence", async () => {
        // The failure this guards is silent: pruning the cursor along with the
        // messages would restart numbering, and a client resuming from its old
        // `sinceSeq` would be handed a plausible-looking replay from the wrong
        // era. Driven through the store directly because pruning is throttled
        // per channel — this is the same object and the same SQL the service
        // calls, against the same database.
        const client = connect();
        const channel = new RebaseRealtimeChannel(RETAINED, client, { history: true });
        await joined(channel);

        const total = RETENTION_LIMIT + 10;
        for (let i = 1; i <= total; i++) await channel.broadcast("op", { i });
        await waitFor(() => storedCount(RETAINED).then(n => n === total), `all ${total} messages persisted`);

        const store = new ChannelHistoryStore(db as never, [{ match: "doc:*", limit: RETENTION_LIMIT, ttl: "1h" }]);
        await store.prune(RETAINED, store.retentionFor(RETAINED)!);

        const remaining = await db.execute(
            sql`SELECT seq FROM rebase.channel_messages WHERE channel = ${RETAINED} ORDER BY seq ASC`
        );
        const seqs = (remaining.rows as { seq: string }[]).map(r => Number(r.seq));
        expect(seqs).toHaveLength(RETENTION_LIMIT);
        // The newest survive; the oldest are gone.
        expect(seqs[0]).toBe(11);
        expect(seqs.at(-1)).toBe(total);

        // The cursor still knows how far the channel got, so the next message
        // continues the sequence instead of colliding with a pruned one.
        const cursor = await db.execute(sql`SELECT last_seq FROM rebase.channel_cursors WHERE channel = ${RETAINED}`);
        expect(Number((cursor.rows[0] as { last_seq: string }).last_seq)).toBe(total);

        await channel.broadcast("op", { i: total + 1 });
        await waitFor(async () => {
            const r = await db.execute(
                sql`SELECT MAX(seq)::int AS m FROM rebase.channel_messages WHERE channel = ${RETAINED}`
            );
            return (r.rows[0] as { m: number }).m === total + 1;
        }, "sequence continued past the pruned range");
    });
});
