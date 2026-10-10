/**
 * E2E: without change capture, a worker's writes still reach the `api`'s
 * subscribers.
 *
 * A split deployment runs `api` (serves websockets) and `worker` /
 * `functions` (serve none). The worker holds no LISTEN connection, which is
 * right. With capture on, the database announces its writes for it. With
 * capture off — `REALTIME_CDC=off`, or `auto` falling back on a managed
 * Postgres where the owner role cannot create triggers — the only announcement
 * is the one each process makes itself on `rebase_entity_changes`, and the
 * worker never made one: it switched publishing on only together with
 * listening. A cron updating `orders.status` reached nobody, and
 * `deployment/split-processes.md` said those writes were "still heard".
 *
 * Boots the real bootstrapper twice over one database, as an `api` and as a
 * `worker`, writes through the worker's driver and waits for the api's socket.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import type { RealtimeService } from "../../src/services/realtimeService.js";

const ordersCollection: CollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    properties: {
        id: { name: "ID", type: "number", isId: true },
        status: { name: "Status", type: "string" }
    }
} as unknown as CollectionConfig;

/** Minimal stand-in for a connected WebSocket client. */
class CollectingSocket {
    readyState = 1;
    messages: string[] = [];
    send(msg: string) { this.messages.push(msg); }
    on() { /* no close/error handling needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    parsed() { return this.messages.map((m) => JSON.parse(m) as Record<string, unknown>); }
}

type Booted = { result: InitializedDriver; end: () => Promise<void> };

describe("split roles without change capture (E2E)", () => {
    let container: PgContainer;
    let api: Booted;
    let worker: Booted;

    async function boot(realtime: { subscribe: boolean; provision: boolean }): Promise<Booted> {
        const url = container.connectionString;
        const connection = createPostgresDatabaseConnection(url);
        const previous = { direct: process.env.DATABASE_DIRECT_URL, cdc: process.env.REALTIME_CDC };
        try {
            process.env.DATABASE_DIRECT_URL = url;
            process.env.REALTIME_CDC = "off";
            const result = await createPostgresBootstrapper({ connectionString: url, connection: connection.db as never })
                .initializeDriver!({
                    collections: [ordersCollection],
                    dataSourceKey: "(default)",
                    realtime
                });
            return {
                result,
                end: async () => {
                    await (result.realtimeProvider as RealtimeService | undefined)?.destroy();
                    await connection.pool.end().catch(() => {});
                }
            };
        } finally {
            for (const [key, value] of [["DATABASE_DIRECT_URL", previous.direct], ["REALTIME_CDC", previous.cdc]] as const) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    }

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE TABLE public.orders (id INTEGER PRIMARY KEY, status VARCHAR(255))");
        await admin.query("INSERT INTO public.orders (id, status) VALUES (1, 'pending')");
        await admin.end();

        api = await boot({ subscribe: true, provision: true });
        worker = await boot({ subscribe: false, provision: false });
    }, 180_000);

    afterAll(async () => {
        await worker?.end();
        await api?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("delivers a write the worker made to a subscriber on the api", async () => {
        const realtime = api.result.realtimeProvider as RealtimeService;
        const ws = new CollectingSocket();
        realtime.addClient("subscriber", ws as never);
        await realtime.handleClientMessage("subscriber", {
            type: "subscribe_collection",
            payload: { path: "orders", subscriptionId: "orders-live" }
        } as never);
        const initial = ws.parsed().filter((m) => m.type === "collection_update").length;
        expect(initial).toBe(1);

        await worker.result.driver.save({
            path: "orders",
            id: 1,
            values: { status: "shipped" },
            collection: ordersCollection,
            status: "existing"
        });

        let frames: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 100; i++) {
            frames = ws.parsed().filter((m) => m.type === "collection_update");
            if (frames.length > initial) break;
            await new Promise((r) => setTimeout(r, 50));
        }
        expect(frames.length).toBeGreaterThan(initial);
        const rows = frames[frames.length - 1].rows as Array<{ status?: string; values?: { status?: string } }>;
        expect(rows.map((r) => r.status ?? r.values?.status)).toContain("shipped");
    }, 30_000);
});
