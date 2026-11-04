/**
 * E2E: what the bootstrapper does with `REALTIME_CDC=wal`.
 *
 * cdc-wal-e2e.test.ts proves the stream; this proves the decisions around it,
 * through the real bootstrapper:
 *  - a process that provisions and consumes streams the WAL and takes the
 *    capture triggers an earlier trigger-mode boot attached off the tables —
 *    they would only cost every write a trigger and a NOTIFY;
 *  - a process that only provisions keeps the triggers, for a consumer that
 *    turns out unable to stream and falls back to LISTEN;
 *  - on a server without logical decoding it falls back to trigger capture
 *    rather than to no capture.
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
import { CDC_PUBLICATION } from "../../src/services/cdc/wal-cdc.js";

const ordersCollection: CollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    properties: {
        id: { name: "ID", type: "number", isId: true },
        status: { name: "Status", type: "string" }
    }
} as unknown as CollectionConfig;

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

async function boot(url: string, cdc: string, realtime: { subscribe: boolean; provision: boolean }): Promise<Booted> {
    const connection = createPostgresDatabaseConnection(url);
    const previous = { direct: process.env.DATABASE_DIRECT_URL, cdc: process.env.REALTIME_CDC };
    try {
        process.env.DATABASE_DIRECT_URL = url;
        process.env.REALTIME_CDC = cdc;
        const result = await createPostgresBootstrapper({ connectionString: url, connection: connection.db as never })
            .initializeDriver!({ collections: [ordersCollection], dataSourceKey: "(default)", realtime });
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

async function query<T extends Record<string, unknown>>(url: string, text: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        return (await client.query(text)).rows as T[];
    } finally {
        await client.end();
    }
}

const captureTriggers = (url: string) =>
    query<{ n: number }>(url, "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'rebase_cdc%'").then((r) => r[0].n);
const slots = (url: string) =>
    query<{ n: number }>(url, "SELECT count(*)::int AS n FROM pg_replication_slots WHERE slot_name LIKE 'rebase_cdc_%'").then((r) => r[0].n);

/** Subscribe to `orders`, write `status` with raw SQL on a separate connection, and wait for it to arrive. */
async function rawWriteArrives(url: string, booted: Booted, status: string): Promise<boolean> {
    const realtime = booted.result.realtimeProvider as RealtimeService;
    const ws = new CollectingSocket();
    const clientId = `sub-${status}`;
    realtime.addClient(clientId, ws as never);
    await realtime.handleClientMessage(clientId, {
        type: "subscribe_collection",
        payload: { path: "orders", subscriptionId: clientId }
    } as never);
    await query(url, `UPDATE public.orders SET status = '${status}' WHERE id = 1`);
    for (let i = 0; i < 160; i++) {
        const frames = ws.parsed().filter((m) => m.type === "collection_update");
        const last = frames[frames.length - 1]?.rows as Array<{ status?: string; values?: { status?: string } }> | undefined;
        if (last?.some((r) => (r.status ?? r.values?.status) === status)) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

const SETUP = "CREATE TABLE public.orders (id INTEGER PRIMARY KEY, status VARCHAR(255)); INSERT INTO public.orders (id, status) VALUES (1, 'pending');";

describe("REALTIME_CDC=wal through the bootstrapper (E2E)", () => {
    let logical: PgContainer;
    let replica: PgContainer;

    beforeAll(async () => {
        [logical, replica] = await Promise.all([
            startPgContainer({ args: ["-c", "wal_level=logical"] }),
            startPgContainer()
        ]);
        for (const container of [logical, replica]) {
            for (let i = 0; ; i++) {
                try {
                    await query(container.connectionString, SETUP);
                    break;
                } catch (e) {
                    if (i >= 10) throw e;
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }
        }
    }, 180_000);

    afterAll(async () => {
        if (logical) await stopPgContainer(logical.containerName);
        if (replica) await stopPgContainer(replica.containerName);
    }, 60_000);

    it("switches a trigger-mode database to the WAL: the triggers come off, raw writes still arrive", async () => {
        const url = logical.connectionString;
        const before = await boot(url, "trigger", { subscribe: true, provision: true });
        await before.end();
        expect(await captureTriggers(url)).toBeGreaterThan(0);

        const booted = await boot(url, "wal", { subscribe: true, provision: true });
        try {
            expect(await captureTriggers(url)).toBe(0);
            const published = await query<{ tablename: string }>(url,
                `SELECT tablename FROM pg_publication_tables WHERE pubname = '${CDC_PUBLICATION}' AND schemaname = 'public'`);
            expect(published.map((r) => r.tablename)).toContain("orders");
            expect(await slots(url)).toBe(1);
            expect(await rawWriteArrives(url, booted, "streamed")).toBe(true);
        } finally {
            await booted.end();
        }
        expect(await slots(url)).toBe(0);
    }, 60_000);

    it("keeps the triggers in a process that only provisions, for consumers that cannot stream", async () => {
        const url = logical.connectionString;
        const provisioner = await boot(url, "wal", { subscribe: false, provision: true });
        try {
            expect(await captureTriggers(url)).toBeGreaterThan(0);
            expect(await slots(url)).toBe(0);
        } finally {
            await provisioner.end();
        }

        // A consumer on its own streams the publication the provisioner made.
        const consumer = await boot(url, "wal", { subscribe: true, provision: false });
        try {
            expect(await slots(url)).toBe(1);
            expect(await rawWriteArrives(url, consumer, "consumed")).toBe(true);
        } finally {
            await consumer.end();
        }
    }, 60_000);

    it("falls back to trigger capture on a server without logical decoding", async () => {
        const url = replica.connectionString;
        const booted = await boot(url, "wal", { subscribe: true, provision: true });
        try {
            expect((booted.result.realtimeProvider as RealtimeService).isCdcActive()).toBe(true);
            expect(await captureTriggers(url)).toBeGreaterThan(0);
            expect(await slots(url)).toBe(0);
            expect(await rawWriteArrives(url, booted, "via-trigger")).toBe(true);
        } finally {
            await booted.end();
        }
    }, 60_000);
});
