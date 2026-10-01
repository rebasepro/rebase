/**
 * E2E: a retained channel delivers in sequence order across instances.
 *
 * The docs promise it — "delivery order matches sequence order" — and it held
 * on one instance only. Over the Postgres bus, instance A numbered a message N
 * and instance B numbered the next N+1; each fanned its own out locally at
 * once and published it afterwards. A reader on B received N+1 from B's local
 * fan-out before N arrived over the bus — measured: 17 inversions in 40 frames
 * — and the SDK, which keeps a watermark, dropped N for good.
 *
 * Now the statement that numbers a message also announces it, so the
 * announcements reach every instance in commit order — which the channel's
 * cursor row makes sequence order — and every instance, the sender's included,
 * delivers from them.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { PostgresChannelBus } from "../../src/services/channel-bus/PostgresChannelBus.js";

class CollectingSocket {
    readyState = 1;
    frames: Array<{ type: string; seq?: number; payload?: unknown }> = [];
    send(message: string) { this.frames.push(JSON.parse(message)); }
    on() { /* no close handling needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    seqs() { return this.frames.filter(f => f.type === "broadcast").map(f => f.seq as number); }
}

describe("A retained channel on two instances (E2E)", () => {
    let container: PgContainer;
    const pools: pg.Pool[] = [];
    const services: RealtimeService[] = [];

    async function instance(): Promise<RealtimeService> {
        const pool = new pg.Pool({ connectionString: container.connectionString });
        pools.push(pool);
        const db = drizzle(pool);
        const service = new RealtimeService(db as never, new PostgresCollectionRegistry());
        await service.configureChannelHistory([{ match: "doc:*", limit: 1000 }], { provision: true });
        await service.configureChannelBus(new PostgresChannelBus(db as never, container.connectionString));
        services.push(service);
        return service;
    }

    beforeAll(async () => {
        container = await startPgContainer();
    }, 180_000);

    afterAll(async () => {
        for (const service of services) await service.destroy();
        for (const pool of pools) await pool.end();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("hands every reader every message once, in sequence order", async () => {
        const a = await instance();
        const b = await instance();
        const sockets = {
            writerA: new CollectingSocket(),
            readerA: new CollectingSocket(),
            writerB: new CollectingSocket(),
            readerB: new CollectingSocket()
        };
        const onA = ["writerA", "readerA"] as const;
        for (const [name, socket] of Object.entries(sockets)) {
            const service = (onA as readonly string[]).includes(name) ? a : b;
            service.addClient(name, socket as never);
            await service.handleClientMessage(name, { type: "join_channel", payload: { channel: "doc:1" } });
        }

        const ROUNDS = 40;
        for (let round = 0; round < ROUNDS; round++) {
            await Promise.all([
                a.handleClientMessage("writerA", { type: "broadcast", payload: { channel: "doc:1", event: "op", payload: { from: "A", round } } }),
                b.handleClientMessage("writerB", { type: "broadcast", payload: { channel: "doc:1", event: "op", payload: { from: "B", round } } })
            ]);
        }
        const all = Array.from({ length: ROUNDS * 2 }, (_, i) => i + 1);
        for (let i = 0; i < 200 && (sockets.readerA.seqs().length < all.length || sockets.readerB.seqs().length < all.length); i++) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(sockets.readerA.seqs()).toEqual(all);
        expect(sockets.readerB.seqs()).toEqual(all);
        // A sender is not echoed its own message, and still hears everyone else's, in order.
        const fromOthers = (socket: CollectingSocket, self: string) => socket.frames
            .filter(f => f.type === "broadcast" && (f.payload as { from: string }).from !== self)
            .map(f => f.seq as number);
        expect(sockets.writerA.seqs()).toEqual(fromOthers(sockets.writerA, "A"));
        expect(fromOthers(sockets.writerA, "A")).toEqual([...fromOthers(sockets.writerA, "A")].sort((x, y) => x - y));
        expect(sockets.writerA.seqs()).toHaveLength(ROUNDS);
    }, 120_000);
});
