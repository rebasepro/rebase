/**
 * E2E: two backend instances, one database, real sockets.
 *
 * This is the only shape of test that can catch the defect this feature exists
 * to fix, and the reason is worth stating: channel broadcast and presence fanned
 * out from per-process `Map`s, which is *correct* for one instance and silently
 * wrong for two. Every single-instance test passed. It only broke behind a load
 * balancer, where two collaborators land on different replicas, see an empty
 * room and never learn why.
 *
 * So nothing here is faked. One real Postgres container; two independent
 * `RealtimeService`s, each with its own `PostgresChannelBus` holding its own
 * `LISTEN` connection; two real HTTP servers on two ports running the real
 * WebSocket handler; and real `RebaseWebSocketClient`s connected to *different*
 * servers. A frame that crosses between them crossed `pg_notify`.
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
import { PostgresChannelBus, PG_NOTIFY_MAX_PAYLOAD_BYTES } from "../../src/services/channel-bus/PostgresChannelBus.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { RebaseWebSocketClient, RebaseRealtimeChannel, type BroadcastEvent } from "@rebasepro/client";
import type { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";

/** Retained, so oversized messages have somewhere to travel by reference. */
const RETAINED = "doc:99";
/** Ephemeral — the case that must refuse an oversized cross-instance message. */
const EPHEMERAL = "cursors:99";

/** Comfortably over the 8000-byte NOTIFY ceiling. */
const OVERSIZED = "x".repeat(PG_NOTIFY_MAX_PAYLOAD_BYTES + 2_000);

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

/** One backend instance: its own pool, service, bus and HTTP server. */
interface Instance {
    pool: pg.Pool;
    realtime: RealtimeService;
    server: Server;
    port: number;
}

describe("Channel bus (E2E, two backend instances)", () => {
    let container: PgContainer;
    let one: Instance;
    let two: Instance;
    /** A third connection, used only to inspect state the way an operator would. */
    let inspect: pg.Pool;

    let openClients: RebaseWebSocketClient[] = [];

    async function startInstance(connectionString: string): Promise<Instance> {
        const pool = new pg.Pool({ connectionString });
        const db = drizzle(pool);
        const realtime = new RealtimeService(db as never, new PostgresCollectionRegistry());

        await realtime.configureChannelHistory([{ match: "doc:*", limit: 200, ttl: "1h" }]);
        await realtime.configureChannelBus(new PostgresChannelBus(db as never, connectionString));

        const server = createServer();
        // See channel-history-e2e: since 80fb57e08 an absent auth config means
        // "require auth", so this opts out explicitly. Both instances are
        // anonymous public channels; what is under test is the bus between them.
        createPostgresWebSocket(server, realtime, {} as unknown as PostgresBackendDriver, { requireAuth: false });
        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server port");

        return { pool, realtime, server, port: address.port };
    }

    function connect(instance: Instance): RebaseWebSocketClient {
        const client = new RebaseWebSocketClient({
            websocketUrl: `ws://localhost:${instance.port}`,
            WebSocket: NodeWebSocket as unknown as typeof WebSocket
        });
        openClients.push(client);
        return client;
    }

    /** `history()` only answers after the join it followed, so this proves the join landed. */
    async function joined(channel: RebaseRealtimeChannel): Promise<void> {
        await channel.join();
        await channel.history({ sinceSeq: channel.sequence });
    }

    beforeAll(async () => {
        container = await startPgContainer();

        inspect = new pg.Pool({ connectionString: container.connectionString });
        for (let i = 0; ; i++) {
            try {
                await inspect.query("SELECT 1");
                break;
            } catch (e) {
                if (i >= 15) throw e;
                await new Promise(r => setTimeout(r, 500));
            }
        }

        one = await startInstance(container.connectionString);
        two = await startInstance(container.connectionString);

        // Both buses must be genuinely connected, or every assertion below
        // would be testing the memory fallback and passing for the wrong reason.
        expect(one.realtime.getChannelBusKind()).toBe("postgres");
        expect(two.realtime.getChannelBusKind()).toBe("postgres");
    }, 180_000);

    afterAll(async () => {
        for (const client of openClients) client.disconnect(true);
        for (const instance of [one, two]) {
            if (!instance) continue;
            await instance.realtime.destroy();
            await new Promise<void>(resolve => instance.server.close(() => resolve()));
            await instance.pool.end();
        }
        await inspect?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    beforeEach(async () => {
        for (const client of openClients) client.disconnect(true);
        openClients = [];
        await inspect.query("DELETE FROM rebase.channel_messages");
        await inspect.query("DELETE FROM rebase.channel_cursors");
        await inspect.query("DELETE FROM rebase.channel_presence");
    });

    // =========================================================================
    // Broadcast
    // =========================================================================

    it("delivers a broadcast to a client connected to the other instance", async () => {
        const alice = new RebaseRealtimeChannel(EPHEMERAL, connect(one));
        const bob = new RebaseRealtimeChannel(EPHEMERAL, connect(two));

        const received: BroadcastEvent[] = [];
        bob.onBroadcast(e => received.push(e));

        await joined(alice);
        await joined(bob);

        await alice.broadcast("cursor", { x: 10, y: 20 });

        await waitFor(() => received.length === 1, "Bob received Alice's broadcast from the other instance");
        expect(received[0].payload).toEqual({ x: 10, y: 20 });
    });

    it("does not deliver a channel's traffic to clients in a different channel", async () => {
        const alice = new RebaseRealtimeChannel(EPHEMERAL, connect(one));
        const bob = new RebaseRealtimeChannel("cursors:other", connect(two));

        const received: BroadcastEvent[] = [];
        bob.onBroadcast(e => received.push(e));

        await joined(alice);
        await joined(bob);

        await alice.broadcast("cursor", { x: 1 });
        await new Promise(r => setTimeout(r, 750));

        expect(received).toEqual([]);
    });

    // =========================================================================
    // The 8 KB NOTIFY ceiling — the crux
    // =========================================================================

    it("carries a message far larger than the NOTIFY limit across instances, in order", async () => {
        const alice = new RebaseRealtimeChannel(RETAINED, connect(one), { history: true });
        const bob = new RebaseRealtimeChannel(RETAINED, connect(two), { history: true });

        const received: BroadcastEvent[] = [];
        bob.onBroadcast(e => received.push(e));

        await joined(alice);
        await joined(bob);

        await alice.broadcast("op", { n: 1 });
        await alice.broadcast("snapshot", { scene: OVERSIZED });
        await alice.broadcast("op", { n: 3 });

        await waitFor(() => received.length === 3, "Bob received all three, including the oversized one");

        // Whole, not truncated: the pointer path fetched the body back.
        expect((received[1].payload as { scene: string }).scene).toBe(OVERSIZED);
        expect(received.map(e => e.seq)).toEqual([1, 2, 3]);
        expect(received.map(e => e.event)).toEqual(["op", "snapshot", "op"]);
    });

    it("refuses an oversized ephemeral broadcast instead of delivering it to only one instance", async () => {
        const aliceClient = connect(one);
        const alice = new RebaseRealtimeChannel(EPHEMERAL, aliceClient);
        const bobSameInstance = new RebaseRealtimeChannel(EPHEMERAL, connect(one));
        const bobOtherInstance = new RebaseRealtimeChannel(EPHEMERAL, connect(two));

        const near: BroadcastEvent[] = [];
        const far: BroadcastEvent[] = [];
        bobSameInstance.onBroadcast(e => near.push(e));
        bobOtherInstance.onBroadcast(e => far.push(e));

        await joined(alice);
        await joined(bobSameInstance);
        await joined(bobOtherInstance);

        await alice.broadcast("snapshot", { scene: OVERSIZED });

        // Local delivery is unaffected — the refusal is about the hop it could
        // not make, and pretending otherwise would break single-instance apps.
        await waitFor(() => near.length === 1, "the client on the same instance still received it");
        await new Promise(r => setTimeout(r, 750));
        expect(far).toEqual([]);
    });

    // =========================================================================
    // Presence
    // =========================================================================

    it("answers presence_state with the roster of both instances", async () => {
        const alice = new RebaseRealtimeChannel(RETAINED, connect(one));
        const bob = new RebaseRealtimeChannel(RETAINED, connect(two));

        await alice.track({ name: "Alice" });
        await bob.track({ name: "Bob" });

        // A third client asking cold: it has seen no diffs, so whatever it knows
        // came from the shared roster rather than from being in the room.
        const carol = new RebaseRealtimeChannel(RETAINED, connect(one));
        let roster: Record<string, unknown> = {};
        carol.onPresence(state => { roster = state; });

        await waitFor(
            () => Object.keys(roster).length === 2,
            `Carol sees both instances' clients (saw ${JSON.stringify(roster)})`
        );
        expect(Object.values(roster)).toEqual(
            expect.arrayContaining([{ name: "Alice" }, { name: "Bob" }])
        );
    });

    it("pushes a join on one instance to clients on the other", async () => {
        const bob = new RebaseRealtimeChannel(RETAINED, connect(two));
        let roster: Record<string, unknown> = {};
        bob.onPresence(state => { roster = state; });
        await joined(bob);

        const alice = new RebaseRealtimeChannel(RETAINED, connect(one));
        await alice.track({ name: "Alice" });

        await waitFor(() => Object.values(roster).some(s => (s as { name?: string }).name === "Alice"),
            "Bob was told about Alice joining on the other instance");
    });

    it("removes a departed client from the shared roster and tells the other instance", async () => {
        // Bob is in the room first, so what he learns about Alice arrives as a
        // live diff across the bus rather than in his initial roster.
        const bob = new RebaseRealtimeChannel(RETAINED, connect(two));
        let roster: Record<string, unknown> = {};
        bob.onPresence(state => { roster = state; });
        await joined(bob);

        const aliceClient = connect(one);
        const alice = new RebaseRealtimeChannel(RETAINED, aliceClient);
        await alice.track({ name: "Alice" });
        await waitFor(() => Object.keys(roster).length === 1, "Bob saw Alice arrive");

        aliceClient.disconnect(true);

        await waitFor(() => Object.keys(roster).length === 0, "Bob saw Alice leave");
        const rows = await inspect.query("SELECT * FROM rebase.channel_presence WHERE channel = $1", [RETAINED]);
        expect(rows.rowCount).toBe(0);
    });

    it("records presence in the shared table rather than only in process memory", async () => {
        const alice = new RebaseRealtimeChannel(RETAINED, connect(one));
        await alice.track({ name: "Alice", cursor: 7 });

        await waitFor(async () => {
            const rows = await inspect.query(
                "SELECT state FROM rebase.channel_presence WHERE channel = $1", [RETAINED]
            );
            return rows.rowCount === 1;
        }, "Alice's presence reached the database");

        const rows = await inspect.query(
            "SELECT state, instance_id FROM rebase.channel_presence WHERE channel = $1", [RETAINED]
        );
        expect(rows.rows[0].state).toEqual({ name: "Alice", cursor: 7 });
        expect(rows.rows[0].instance_id).toMatch(/^inst_/);
    });

    // =========================================================================
    // Crash recovery
    // =========================================================================

    it("reaps presence rows left behind by an instance that stopped heartbeating", async () => {
        const bob = new RebaseRealtimeChannel(RETAINED, connect(two));
        let roster: Record<string, unknown> = {};
        bob.onPresence(state => { roster = state; });
        await joined(bob);

        // Exactly what a pod that died leaves behind: a row nobody refreshes.
        await inspect.query(
            `INSERT INTO rebase.channel_presence (channel, client_id, instance_id, state, last_seen)
             VALUES ($1, 'ghost', 'inst_dead', '{"name":"Ghost"}'::jsonb, NOW() - INTERVAL '5 minutes')`,
            [RETAINED]
        );

        await waitFor(async () => {
            const rows = await inspect.query(
                "SELECT 1 FROM rebase.channel_presence WHERE client_id = 'ghost'"
            );
            return rows.rowCount === 0;
        }, "the dead instance's row was reaped", 30_000);

        // And the survivors were told, rather than left with a stale roster.
        await waitFor(() => !("ghost" in roster), "Bob's roster no longer lists the ghost", 30_000);
    });
});
