/**
 * E2E: two data sources on two databases, each holding its LISTEN on its own.
 *
 * ## What this pins
 *
 * `DATABASE_DIRECT_URL` is the DEFAULT source's direct (non-pooled) URL. Both
 * LISTEN paths read it bare, for every source: the change-capture listener the
 * bootstrapper starts, and `PostgresBackendDriver.listen()`. A second source
 * (`database("analytics")`) therefore held its change-capture LISTEN on the
 * default database. The connect succeeded, capture reported itself active, and
 * the analytics database's triggers notified a channel nobody in that database
 * was listening on — so its realtime feed was silent, with nothing in the log.
 *
 * The environment here is set the way an operator sets it: the bare variable
 * names the default database, and it stays set for the whole suite, so a path
 * that still reads it at call time is caught, not only one that reads it at
 * boot. Each direct URL carries its own `application_name`, which is how the
 * test tells the explicit `directConnectionString` apart from the source's
 * pool URL in `pg_stat_activity`.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { ensureCollectionTables, type Queryable } from "../../src/schema/ensure-collection-tables.js";

const postsCollection: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" }
    },
    // Readable by anyone, so a subscriber's refetch can see the new row: the
    // provisioned table has row-level security on, and with no policy at all
    // every refetch would come back empty and send nothing.
    securityRules: [{ operation: "select", access: "public" }]
} as unknown as CollectionConfig;

const eventsCollection: CollectionConfig = {
    name: "Events",
    slug: "events",
    table: "events",
    dataSource: "analytics",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        kind: { name: "Kind", type: "string" }
    },
    securityRules: [{ operation: "select", access: "public" }]
} as unknown as CollectionConfig;

const ALL_COLLECTIONS = [postsCollection, eventsCollection];

function queryableFor(db: { execute: (q: unknown) => Promise<unknown> }): Queryable {
    return {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            const { sql } = await import("drizzle-orm");
            const result = await db.execute(sql.raw(text)) as { rows?: T[] };
            return { rows: result.rows ?? [] };
        }
    } as unknown as Queryable;
}

/** Minimal stand-in for a connected WebSocket client. */
class CollectingSocket {
    readyState = 1; // WebSocket.OPEN
    messages: string[] = [];
    send(msg: string) { this.messages.push(msg); }
    on() { /* no close/error handling needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    parsed() { return this.messages.map((m) => JSON.parse(m)); }
    clear() { this.messages = []; }
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 5000, stepMs = 50): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = fn();
        if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) return v as T;
        if (Date.now() > deadline) throw new Error("waitFor timed out");
        await new Promise((r) => setTimeout(r, stepMs));
    }
}

/** The bootstrapper's own driver and realtime service, narrowed by class. */
function partsOf(result: InitializedDriver): { driver: PostgresBackendDriver; realtime: RealtimeService } {
    const { driver, realtimeProvider } = result;
    if (!(driver instanceof PostgresBackendDriver)) throw new Error("not a PostgresBackendDriver");
    if (!(realtimeProvider instanceof RealtimeService)) throw new Error("no RealtimeService");
    return { driver, realtime: realtimeProvider };
}

describe("Two data sources, each listening on its own database (E2E)", () => {
    let container: PgContainer;
    let defaultUrl: string;
    let analyticsUrl: string;
    let defaultConn: ReturnType<typeof createPostgresDatabaseConnection>;
    let analyticsConn: ReturnType<typeof createPostgresDatabaseConnection>;
    /** Independent connections — stand-ins for psql, never the drivers' own. */
    let defaultClient: pg.Client;
    let analyticsClient: pg.Client;
    let defaultSource: { driver: PostgresBackendDriver; realtime: RealtimeService };
    let analyticsSource: { driver: PostgresBackendDriver; realtime: RealtimeService };
    let previousDirect: string | undefined;
    let previousCdc: string | undefined;

    beforeAll(async () => {
        container = await startPgContainer();
        defaultUrl = container.connectionString;

        const admin = new pg.Client({ connectionString: defaultUrl });
        await admin.connect();
        await admin.query("CREATE DATABASE analytics");
        await admin.end();
        analyticsUrl = defaultUrl.replace("/rebase?", "/analytics?");

        defaultConn = createPostgresDatabaseConnection(defaultUrl);
        analyticsConn = createPostgresDatabaseConnection(analyticsUrl);
        await ensureCollectionTables(queryableFor(defaultConn.db as never), [postsCollection] as never);
        await ensureCollectionTables(queryableFor(analyticsConn.db as never), [eventsCollection] as never);

        defaultClient = new pg.Client({ connectionString: defaultUrl });
        analyticsClient = new pg.Client({ connectionString: analyticsUrl });
        await defaultClient.connect();
        await analyticsClient.connect();

        // The operator's shape: the bare variable is the default's direct URL.
        previousDirect = process.env.DATABASE_DIRECT_URL;
        previousCdc = process.env.REALTIME_CDC;
        process.env.DATABASE_DIRECT_URL = `${defaultUrl}&application_name=default-direct`;
        process.env.REALTIME_CDC = "trigger";

        const quiet = [
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        ];
        try {
            // Policies, then the driver, per source — boot's order.
            const defaultBootstrapper = createPostgresBootstrapper({
                connectionString: defaultUrl,
                connection: defaultConn.db as never
            });
            await defaultBootstrapper.ensureCollectionPolicies!([postsCollection], undefined);
            defaultSource = partsOf(await defaultBootstrapper.initializeDriver!({
                collections: ALL_COLLECTIONS,
                dataSourceKey: "(default)",
                realtime: { subscribe: true, provision: true }
            }));
            const analyticsBootstrapper = createPostgresBootstrapper({
                connectionString: analyticsUrl,
                directConnectionString: `${analyticsUrl}&application_name=analytics-direct`,
                connection: analyticsConn.db as never
            });
            await analyticsBootstrapper.ensureCollectionPolicies!([eventsCollection], undefined);
            analyticsSource = partsOf(await analyticsBootstrapper.initializeDriver!({
                collections: ALL_COLLECTIONS,
                dataSourceKey: "analytics",
                realtime: { subscribe: true, provision: true }
            }));
        } finally {
            for (const spy of quiet) spy.mockRestore();
        }
    }, 180_000);

    afterAll(async () => {
        if (previousDirect === undefined) delete process.env.DATABASE_DIRECT_URL;
        else process.env.DATABASE_DIRECT_URL = previousDirect;
        if (previousCdc === undefined) delete process.env.REALTIME_CDC;
        else process.env.REALTIME_CDC = previousCdc;
        await defaultSource?.realtime.destroy().catch(() => {});
        await analyticsSource?.realtime.destroy().catch(() => {});
        await defaultClient?.end().catch(() => {});
        await analyticsClient?.end().catch(() => {});
        await defaultConn?.pool.end().catch(() => {});
        await analyticsConn?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("starts change capture on both sources", () => {
        expect(defaultSource.realtime.isCdcActive()).toBe(true);
        expect(analyticsSource.realtime.isCdcActive()).toBe(true);
    });

    it("holds each source's change-capture LISTEN on its own database, through its own direct URL", async () => {
        const { rows } = await defaultClient.query<{ application_name: string; datname: string }>(
            `SELECT application_name, datname FROM pg_stat_activity
             WHERE application_name IN ('default-direct', 'analytics-direct')`
        );
        const databasesOf = (name: string) => [...new Set(rows.filter(r => r.application_name === name).map(r => r.datname))];
        expect(databasesOf("default-direct")).toEqual(["rebase"]);
        expect(databasesOf("analytics-direct")).toEqual(["analytics"]);
    });

    it("delivers a write to the second database to that source's subscribers", async () => {
        const ws = new CollectingSocket();
        analyticsSource.realtime.addClient("client-events", ws as never);
        await analyticsSource.realtime.handleClientMessage("client-events", {
            type: "subscribe_collection",
            payload: { path: "events", subscriptionId: "sub-events" }
        } as never);
        ws.clear();

        // Raw SQL on a separate connection: only change capture can report it.
        await analyticsClient.query(`INSERT INTO public.events (id, kind) VALUES ('e1', 'signup')`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-events")
        );
        const kinds = (update.rows as Array<{ kind?: string; values?: { kind?: string } }>)
            .map((r) => r.kind ?? r.values?.kind);
        expect(kinds).toContain("signup");
    });

    it("still delivers a write to the default database to the default source's subscribers", async () => {
        const ws = new CollectingSocket();
        defaultSource.realtime.addClient("client-posts", ws as never);
        await defaultSource.realtime.handleClientMessage("client-posts", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-posts" }
        } as never);
        ws.clear();

        await defaultClient.query(`INSERT INTO public.posts (id, title) VALUES ('p1', 'hello')`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-posts")
        );
        const titles = (update.rows as Array<{ title?: string; values?: { title?: string } }>)
            .map((r) => r.title ?? r.values?.title);
        expect(titles).toContain("hello");
    });

    it("holds the second source's listen() on its own database", async () => {
        const heard: string[] = [];
        const stop = await analyticsSource.driver.listen("rebase_probe", (payload) => heard.push(payload));
        try {
            // Sent to the default database first: a listener held there would
            // hear this one and never the next.
            await defaultClient.query(`SELECT pg_notify('rebase_probe', 'from-default')`);
            await analyticsClient.query(`SELECT pg_notify('rebase_probe', 'from-analytics')`);
            await waitFor(() => (heard.includes("from-analytics") ? heard : undefined));
            expect(heard).toEqual(["from-analytics"]);
        } finally {
            await stop();
        }
    });
});
