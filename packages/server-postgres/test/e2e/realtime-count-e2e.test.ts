/**
 * E2E: a subscription to a list's count alone.
 *
 * `subscribe_collection` with `countOnly: true` (the SDK's `listenCount`) is
 * answered without reading a row: every frame carries `rows: []` and the
 * total in `meta`, counted as the subscriber, and a write that changes the
 * total sends a new one. A subscription without the key — every client before
 * it — is answered as it always was.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createPostgresWebSocket } from "../../src/websocket.js";

const itemsTable = pgTable("items", { id: varchar("id").primaryKey(), status: varchar("status") });

/** Every row any read served, through the hook every read passes. */
let rowsServed = 0;
const itemsCollection = {
    slug: "items",
    name: "Items",
    table: "items",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        status: { name: "Status", type: "string" }
    },
    callbacks: {
        afterRead: ({ row }: { row: Record<string, unknown> }) => {
            rowsServed++;
            return row;
        }
    }
} as unknown as CollectionConfig;

type Frame = { type: string; subscriptionId?: string; rows?: unknown[]; meta?: { total?: number } };

describe("count subscriptions (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let driver: PostgresBackendDriver;
    let server: Server;
    let socket: NodeWebSocket;
    const frames: Frame[] = [];

    const framesFor = (subscriptionId: string) => frames.filter((f) => f.type === "collection_update" && f.subscriptionId === subscriptionId);
    async function waitFor(predicate: () => boolean, what: string) {
        for (let waited = 0; !predicate(); waited += 20) {
            if (waited > 10_000) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(frames)}`);
            await new Promise((r) => setTimeout(r, 20));
        }
    }
    const subscribe = (subscriptionId: string, payload: Record<string, unknown>) =>
        socket.send(JSON.stringify({ type: "subscribe_collection", requestId: subscriptionId, payload: { path: "items", subscriptionId, ...payload } }));

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE TABLE public.items (id varchar PRIMARY KEY, status varchar);
            INSERT INTO public.items (id, status) SELECT 'i-' || g, CASE WHEN g % 2 = 0 THEN 'on' ELSE 'off' END FROM generate_series(1, 10) g;
        `);
        await admin.end();
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([itemsCollection]);
        registry.registerTable(itemsTable, "items");
        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
        server = createServer();
        createPostgresWebSocket(server, realtime, driver, { requireAuth: false });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        socket = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", () => resolve());
            socket.once("error", reject);
        });
        socket.on("message", (data) => frames.push(JSON.parse(String(data)) as Frame));
    }, 120_000);

    afterAll(async () => {
        socket?.close();
        await realtime?.destroy();
        await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("answers with the filtered total and no rows, reads none, and follows writes", async () => {
        const before = rowsServed;
        subscribe("count-on", { filter: { status: ["==", "on"] }, limit: 1, countOnly: true });
        await waitFor(() => framesFor("count-on").length === 1, "the first count");
        expect(framesFor("count-on")[0]).toMatchObject({ rows: [], meta: { total: 5 } });
        // Counted, not read: no row went through the read pipeline for it.
        expect(rowsServed).toBe(before);

        await driver.save({ path: "items", id: "i-11", values: { id: "i-11", status: "on" }, status: "new" });
        await waitFor(() => framesFor("count-on").length === 2, "the count after an insert");
        expect(framesFor("count-on")[1].meta?.total).toBe(6);

        await driver.delete({ path: "items", row: { id: "i-2", path: "items" } });
        await waitFor(() => framesFor("count-on").length === 3, "the count after a delete");
        expect(framesFor("count-on")[2].meta?.total).toBe(5);

        // A write that leaves the count where it was sends this subscriber nothing.
        await driver.save({ path: "items", id: "i-1", values: { status: "off!" }, status: "existing" });
        await new Promise((r) => setTimeout(r, 1_500));
        expect(framesFor("count-on")).toHaveLength(3);
    });

    it("a subscription without countOnly is answered with its rows, as before", async () => {
        subscribe("rows", { filter: { status: ["==", "off"] }, limit: 2 });
        await waitFor(() => framesFor("rows").length === 1, "the rows");
        expect(framesFor("rows")[0].rows).toHaveLength(2);
        expect(framesFor("rows")[0].meta?.total).toBeGreaterThan(2);
    });
});
