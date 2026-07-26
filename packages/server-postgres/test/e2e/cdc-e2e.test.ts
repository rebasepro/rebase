/**
 * E2E: database-level Change Data Capture against a real Postgres.
 *
 * Proves the core guarantee that closes the gap with Supabase Realtime: a write
 * that never touches the Rebase API — here a raw SQL statement on a *separate*
 * connection, exactly what `psql`, a cron in another service, or the Studio SQL
 * editor would do — still produces a realtime event on a subscribed client.
 *
 * Flow: provision CDC triggers → enable the CDC LISTEN client → subscribe a
 * client to a collection → issue raw INSERT/UPDATE/DELETE on an independent
 * connection → assert the subscriber is notified with the freshly-read rows.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, integer, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { provisionTriggerCdc } from "../../src/services/cdc/trigger-cdc.js";
import { collectJunctionLinks } from "../../src/services/cdc/junction-tables.js";
import type { RawSqlRunner } from "../../src/security/rls-enforcement.js";

const postsTable = pgTable("posts", {
    id: integer("id").primaryKey(),
    title: varchar("title")
});
const postsCollection: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: true },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

// A many-to-many, declared on `tags` so the `posts` collection above — and the
// tests that subscribe to it — stay exactly as they were.
const tagsTable = pgTable("tags", {
    id: integer("id").primaryKey(),
    label: varchar("label")
});
const postsTagsTable = pgTable("posts_tags", {
    post_id: integer("post_id"),
    tag_id: integer("tag_id")
});
const tagsCollection: CollectionConfig = {
    name: "Tags",
    slug: "tags",
    table: "tags",
    properties: {
        id: { name: "ID", type: "number", isId: true },
        label: { name: "Label", type: "string" }
    },
    relations: [
        {
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            direction: "owning",
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        }
    ]
} as unknown as CollectionConfig;

/** Minimal stand-in for a connected WebSocket client. */
class CollectingSocket {
    readyState = 1; // WebSocket.OPEN
    messages: string[] = [];
    send(msg: string) { this.messages.push(msg); }
    on() { /* no-op: no close/error handling needed in the test */ }
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

describe("Database-level CDC (E2E)", () => {
    let container: PgContainer;
    let adminClient: pg.Client; // an INDEPENDENT connection — stands in for psql
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let driver: PostgresBackendDriver;

    beforeAll(async () => {
        container = await startPgContainer();

        for (let i = 0; ; i++) {
            try {
                adminClient = new pg.Client({ connectionString: container.connectionString });
                await adminClient.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise((r) => setTimeout(r, 1000));
            }
        }

        await adminClient.query(`
            CREATE TABLE public.posts (id INTEGER PRIMARY KEY, title VARCHAR(255));
            INSERT INTO public.posts (id, title) VALUES (1, 'original title');
            CREATE TABLE public.tags (id INTEGER PRIMARY KEY, label VARCHAR(255));
            INSERT INTO public.tags (id, label) VALUES (1, 'postgres');
            CREATE TABLE public.posts_tags (
                post_id INTEGER, tag_id INTEGER, PRIMARY KEY (post_id, tag_id)
            );
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([postsCollection, tagsCollection]);
        registry.registerTable(postsTable, "posts");
        registry.registerTable(tagsTable, "tags");
        registry.registerTable(postsTagsTable, "posts_tags");

        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        // Self-provision the CDC triggers + start the LISTEN client, exactly as
        // the bootstrapper does when REALTIME_CDC=trigger.
        const runSql: RawSqlRunner = async (text) => (await pool.query(text)).rows as Record<string, unknown>[];
        // Junction tables come from the same derivation the bootstrapper uses,
        // so the test exercises that derivation rather than a hand-written list.
        await provisionTriggerCdc(runSql, [
            { schema: "public", table: "posts" },
            ...collectJunctionLinks(registry).map((l) => ({ schema: l.schema,
table: l.table }))
        ]);
        await realtime.enableCdc(container.connectionString);

        expect(realtime.isCdcActive()).toBe(true);
    }, 180_000);

    afterAll(async () => {
        await realtime?.destroy();
        await pool?.end();
        await adminClient?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("delivers a realtime event for a link written straight into the junction table", async () => {
        // Linking is a write to `posts_tags` and to nothing else. That table
        // backs no collection, so change capture used to drop the event as
        // unmapped and a subscriber on the child list never heard about it —
        // the one write in the system that was silently not realtime.
        const ws = new CollectingSocket();
        realtime.addClient("client-link", ws as never);
        await realtime.handleClientMessage("client-link", {
            type: "subscribe_collection",
            payload: { path: "tags/1/posts", subscriptionId: "sub-link" }
        } as never);
        ws.clear();

        // Raw SQL on a SEPARATE connection — no Rebase API, no admin panel.
        await adminClient.query(`INSERT INTO public.posts_tags (post_id, tag_id) VALUES (1, 1)`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-link")
        );
        const ids = (update.rows as Array<{ id?: number; values?: { id?: number } }>)
            .map((r) => r.id ?? r.values?.id);
        expect(ids).toContain(1);
    });

    it("delivers a realtime event when a link is removed", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-unlink", ws as never);
        await realtime.handleClientMessage("client-unlink", {
            type: "subscribe_collection",
            payload: { path: "tags/1/posts", subscriptionId: "sub-unlink" }
        } as never);
        ws.clear();

        await adminClient.query(`DELETE FROM public.posts_tags WHERE post_id = 1 AND tag_id = 1`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-unlink")
        );
        const ids = (update.rows as Array<{ id?: number; values?: { id?: number } }>)
            .map((r) => r.id ?? r.values?.id);
        expect(ids).not.toContain(1);
    });

    it("delivers a realtime event for a raw SQL UPDATE made outside the Rebase API", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-update", ws as never);
        await realtime.handleClientMessage("client-update", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-update" }
        } as never);
        ws.clear(); // drop the initial snapshot

        // Raw SQL on a SEPARATE connection — the Rebase API is never involved.
        await adminClient.query(`UPDATE public.posts SET title = 'edited via raw SQL' WHERE id = 1`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-update")
        );
        const titles = (update.rows as Array<{ title?: string; values?: { title?: string } }>)
            .map((r) => r.title ?? r.values?.title);
        expect(titles).toContain("edited via raw SQL");
    });

    it("delivers a realtime event for a raw SQL INSERT, with the new row present", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-insert", ws as never);
        await realtime.handleClientMessage("client-insert", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-insert" }
        } as never);
        ws.clear();

        await adminClient.query(`INSERT INTO public.posts (id, title) VALUES (2, 'inserted via raw SQL')`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-insert")
        );
        const titles = (update.rows as Array<{ title?: string; values?: { title?: string } }>)
            .map((r) => r.title ?? r.values?.title);
        expect(titles).toContain("inserted via raw SQL");
    });

    it("notifies a single-row subscriber when its row is changed by raw SQL", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-one", ws as never);
        await realtime.handleClientMessage("client-one", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-one" }
        } as never);
        ws.clear();

        await adminClient.query(`UPDATE public.posts SET title = 'single-row raw edit' WHERE id = 1`);

        const single = await waitFor(() =>
            ws.parsed().find((m) => m.type === "single_update" && m.subscriptionId === "sub-one")
        );
        const row = single.row as { title?: string; values?: { title?: string } } | null;
        expect(row?.title ?? row?.values?.title).toBe("single-row raw edit");
    });
});
