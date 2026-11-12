/**
 * E2E: change capture read from the write-ahead log (`REALTIME_CDC=wal`).
 *
 * The same guarantee as cdc-e2e.test.ts — a write that never touches the
 * Rebase API reaches a subscribed client — with no trigger on any table:
 * the changes come from a logical replication stream on a temporary slot.
 * Also proves what only this mode has to: the stream comes back after its
 * connection is killed and resyncs what committed in the gap, the slot
 * disappears with the connection, a table with no replica identity is kept
 * out of the publication (publishing it would break its UPDATEs), and a role
 * that may not replicate is refused so the bootstrapper can fall back.
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
import { PostgresTableRegistry } from "../../src/model/PostgresTableRegistry.js";
import { FixtureTableRegistry } from "../helpers/tables";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { collectJunctionLinks } from "../../src/services/cdc/junction-tables.js";
import { CDC_PUBLICATION, provisionWalPublication, walCaptureBlocker } from "../../src/services/cdc/wal-cdc.js";
import type { CdcTableRef } from "../../src/services/cdc/trigger-cdc.js";
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
};

const tagsTable = pgTable("tags", {
    id: integer("id").primaryKey(),
    label: varchar("label")
});
const postsTagsTable = pgTable("posts_tags", {
    post_id: integer("post_id"),
    tag_id: integer("tag_id")
});
// A junction keyed by a surrogate id: its delete, read from the WAL, carries
// that id and not the two that name the child list.
const postsLabelsTable = pgTable("posts_labels", {
    id: integer("id").primaryKey(),
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
            kind: "manyToMany",
            relationName: "posts",
            target: () => postsCollection,
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        },
        {
            kind: "manyToMany",
            relationName: "labelled",
            target: () => postsCollection,
            through: { table: "posts_labels", sourceColumn: "tag_id", targetColumn: "post_id" }
        }
    ]
};

/** Minimal stand-in for a connected WebSocket client. */
class CollectingSocket {
    readyState = 1;
    bufferedAmount = 0;
    messages: string[] = [];
    send(msg: string) { this.messages.push(msg); }
    on() { /* no close/error handling needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    parsed() { return this.messages.map((m) => JSON.parse(m)); }
    clear() { this.messages = []; }
}

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 8000, stepMs = 50): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = await fn();
        if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) return v as T;
        if (Date.now() > deadline) throw new Error("waitFor timed out");
        await new Promise((r) => setTimeout(r, stepMs));
    }
}

const titlesOf = (update: { rows: Array<{ title?: string; values?: { title?: string } }> }) =>
    update.rows.map((r) => r.title ?? r.values?.title);

describe("Database-level CDC from the WAL (E2E)", () => {
    let container: PgContainer;
    let adminClient: pg.Client; // an INDEPENDENT connection — stands in for psql
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let runSql: RawSqlRunner;
    let tables: CdcTableRef[];

    beforeAll(async () => {
        container = await startPgContainer({ args: ["-c", "wal_level=logical"] });

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
            CREATE TABLE public.posts_labels (id INTEGER PRIMARY KEY, post_id INTEGER, tag_id INTEGER);
            CREATE TABLE public.keyless (note TEXT);
            INSERT INTO public.keyless (note) VALUES ('before');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new FixtureTableRegistry();
        registry.registerMultiple([postsCollection, tagsCollection]);
        registry.registerPgTable(postsTable, "posts");
        registry.registerPgTable(tagsTable, "tags");
        registry.registerPgTable(postsTagsTable, "posts_tags");
        registry.registerPgTable(postsLabelsTable, "posts_labels");

        realtime = new RealtimeService(db, registry);
        const driver = new PostgresBackendDriver(db, realtime, registry);
        realtime.setDataDriver(driver);

        // As the bootstrapper does for REALTIME_CDC=wal in a process that
        // provisions and consumes: the publication, then the stream.
        runSql = async (text) => (await pool.query(text)).rows as Record<string, unknown>[];
        expect(await walCaptureBlocker(runSql)).toBeUndefined();
        tables = [
            { schema: "public", table: "posts", identityColumns: ["id"] },
            { schema: "public", table: "keyless" },
            ...collectJunctionLinks(registry).map((l) => ({
                schema: l.schema,
                table: l.table,
                identityColumns: [l.sourceColumn, l.targetColumn]
            }))
        ];
        const { skipped } = await provisionWalPublication(runSql, tables);
        expect(skipped.map((t) => t.table)).toEqual(["keyless"]);
        await realtime.enableWalCdc(container.connectionString, tables);

        expect(realtime.isCdcActive()).toBe(true);
    }, 180_000);

    afterAll(async () => {
        await realtime?.destroy();
        await pool?.end();
        await adminClient?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("captures with no trigger on any table", async () => {
        const { rows } = await adminClient.query(
            `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid IN ('public.posts'::regclass, 'public.posts_tags'::regclass) AND NOT tgisinternal`
        );
        expect(rows[0].n).toBe(0);
    });

    it("keeps a table with no replica identity out of the publication, so its UPDATEs still work", async () => {
        const published = await adminClient.query(
            `SELECT tablename FROM pg_publication_tables WHERE pubname = $1 ORDER BY tablename`, [CDC_PUBLICATION]
        );
        expect(published.rows.map((r) => r.tablename)).toEqual(["posts", "posts_labels", "posts_tags"]);
        // Postgres refuses this on a published table with no replica identity.
        await adminClient.query(`UPDATE public.keyless SET note = 'after'`);
    });

    it("delivers a raw SQL UPDATE made outside the Rebase API", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-update", ws);
        await realtime.handleClientMessage("client-update", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-update" }
        });
        ws.clear();

        await adminClient.query(`UPDATE public.posts SET title = 'edited via raw SQL' WHERE id = 1`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-update")
        );
        expect(titlesOf(update)).toContain("edited via raw SQL");
    });

    it("delivers a raw SQL INSERT, with the new row present", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-insert", ws);
        await realtime.handleClientMessage("client-insert", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-insert" }
        });
        ws.clear();

        await adminClient.query(`INSERT INTO public.posts (id, title) VALUES (2, 'inserted via raw SQL')`);

        const update = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-insert")
        );
        expect(titlesOf(update)).toContain("inserted via raw SQL");
    });

    it("notifies a single-row subscriber when its row is changed by raw SQL", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-one", ws);
        await realtime.handleClientMessage("client-one", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-one" }
        });
        ws.clear();

        await adminClient.query(`UPDATE public.posts SET title = 'single-row raw edit' WHERE id = 1`);

        const single = await waitFor(() =>
            ws.parsed().find((m) => m.type === "single_update" && m.subscriptionId === "sub-one")
        );
        const row = single.row as { title?: string; values?: { title?: string } } | null;
        expect(row?.title ?? row?.values?.title).toBe("single-row raw edit");
    });

    it("delivers a link and an unlink written straight into the junction table", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-link", ws);
        await realtime.handleClientMessage("client-link", {
            type: "subscribe_collection",
            payload: { path: "tags/1/posts", subscriptionId: "sub-link" }
        });
        ws.clear();

        await adminClient.query(`INSERT INTO public.posts_tags (post_id, tag_id) VALUES (1, 1)`);
        const linked = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-link")
        );
        const idsOf = (u: { rows: Array<{ id?: number; values?: { id?: number } }> }) => u.rows.map((r) => r.id ?? r.values?.id);
        expect(idsOf(linked)).toContain(1);

        ws.clear();
        await adminClient.query(`DELETE FROM public.posts_tags WHERE post_id = 1 AND tag_id = 1`);
        const unlinked = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-link")
        );
        expect(idsOf(unlinked)).not.toContain(1);
    });

    it("delivers an unlink whose delete names only the junction's own key", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-label", ws);
        await realtime.handleClientMessage("client-label", {
            type: "subscribe_collection",
            payload: { path: "tags/1/labelled", subscriptionId: "sub-label" }
        });
        const idsOf = (u: { rows: Array<{ id?: number; values?: { id?: number } }> }) => u.rows.map((r) => r.id ?? r.values?.id);

        ws.clear();
        await adminClient.query(`INSERT INTO public.posts_labels (id, post_id, tag_id) VALUES (50, 1, 1)`);
        const linked = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-label")
        );
        expect(idsOf(linked)).toContain(1);

        // The old tuple of this delete is `{ id: 50 }`: which list it left is
        // not in it. Every subscribed list of the relation refetches instead.
        ws.clear();
        await adminClient.query(`DELETE FROM public.posts_labels WHERE id = 50`);
        const unlinked = await waitFor(() =>
            ws.parsed().find((m) => m.type === "collection_update" && m.subscriptionId === "sub-label")
        );
        expect(idsOf(unlinked)).not.toContain(1);
    });

    it("delivers every row of a transaction larger than one batch", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-bulk", ws);
        await realtime.handleClientMessage("client-bulk", {
            type: "subscribe_one",
            payload: { path: "posts", id: "2600", subscriptionId: "sub-bulk" }
        });
        ws.clear();

        // 2,600 rows in one transaction: the stream hands them on in batches
        // of 1,000 before the commit arrives, and the last row is the one watched.
        await adminClient.query(`INSERT INTO public.posts (id, title) SELECT g, 'bulk ' || g FROM generate_series(100, 2600) AS g`);

        const single = await waitFor(() =>
            ws.parsed().find((m) => m.type === "single_update" && m.subscriptionId === "sub-bulk" && m.row)
        );
        const row = single.row as { title?: string; values?: { title?: string } };
        expect(row.title ?? row.values?.title).toBe("bulk 2600");
    });

    it("comes back after its connection is killed, and resyncs what committed in the gap", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("client-gap", ws);
        await realtime.handleClientMessage("client-gap", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "sub-gap" }
        });
        ws.clear();

        const slotsBefore = await adminClient.query(`SELECT slot_name FROM pg_replication_slots WHERE slot_name LIKE 'rebase_cdc_%'`);
        expect(slotsBefore.rows).toHaveLength(1);

        // Kill the walsender and write while the stream is down: the temporary
        // slot goes with the connection, so nothing will replay this write.
        await adminClient.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_replication WHERE application_name LIKE 'rebase-realtime:%'`);
        await adminClient.query(`UPDATE public.posts SET title = 'written in the gap' WHERE id = 1`);

        const resynced = await waitFor(() =>
            ws.parsed().find((m) => m.type === "single_update" && m.subscriptionId === "sub-gap" &&
                ((m.row?.title ?? m.row?.values?.title) === "written in the gap")), 15_000
        );
        expect(resynced).toBeDefined();

        // A new slot, and the stream carries writes again.
        const slotsAfter = await waitFor(async () => {
            const r = await adminClient.query(`SELECT slot_name FROM pg_replication_slots WHERE slot_name LIKE 'rebase_cdc_%' AND active`);
            return r.rows.length === 1 && r.rows[0].slot_name !== slotsBefore.rows[0].slot_name ? r.rows : undefined;
        }, 15_000);
        expect(slotsAfter).toHaveLength(1);

        ws.clear();
        await adminClient.query(`UPDATE public.posts SET title = 'after the reconnect' WHERE id = 1`);
        const live = await waitFor(() =>
            ws.parsed().find((m) => m.type === "single_update" && m.subscriptionId === "sub-gap" &&
                ((m.row?.title ?? m.row?.values?.title) === "after the reconnect"))
        );
        expect(live).toBeDefined();
    }, 40_000);

    it("reports how far it has read, so the server can recycle WAL", async () => {
        // A position before the write: the transaction's end, which the
        // stream confirms once it has handed the change on, lies past it.
        const target = (await adminClient.query(`SELECT pg_current_wal_lsn() AS lsn`)).rows[0].lsn as string;
        await adminClient.query(`UPDATE public.posts SET title = 'advance' WHERE id = 1`);
        // The status update goes out every 10 s.
        const confirmed = await waitFor(async () => {
            const r = await adminClient.query(
                `SELECT confirmed_flush_lsn >= $1::pg_lsn AS caught_up FROM pg_replication_slots WHERE slot_name LIKE 'rebase_cdc_%' AND active`,
                [target]
            );
            return r.rows[0]?.caught_up === true ? true : undefined;
        }, 25_000, 500);
        expect(confirmed).toBe(true);
    }, 30_000);

    it("refuses a role that may not replicate, so the bootstrapper can fall back to triggers", async () => {
        await adminClient.query(`CREATE ROLE no_replication LOGIN PASSWORD 'pw' NOREPLICATION`);
        const url = new URL(container.connectionString);
        url.username = "no_replication";
        url.password = "pw";

        const registry = new FixtureTableRegistry();
        registry.registerMultiple([postsCollection]);
        registry.registerPgTable(postsTable, "posts");
        const other = new RealtimeService(drizzle(pool), registry);
        await expect(other.enableWalCdc(url.toString(), tables)).rejects.toThrow();
        expect(other.isCdcActive()).toBe(false);
        await other.destroy();
    });

    it("drops its temporary slot with the connection", async () => {
        const registry = new FixtureTableRegistry();
        registry.registerMultiple([postsCollection]);
        registry.registerPgTable(postsTable, "posts");
        const second = new RealtimeService(drizzle(pool), registry);
        await second.enableWalCdc(container.connectionString, tables);
        const during = await adminClient.query(`SELECT count(*)::int AS n FROM pg_replication_slots WHERE slot_name LIKE 'rebase_cdc_%'`);
        expect(during.rows[0].n).toBe(2);

        await second.destroy();
        const after = await waitFor(async () => {
            const r = await adminClient.query(`SELECT count(*)::int AS n FROM pg_replication_slots WHERE slot_name LIKE 'rebase_cdc_%'`);
            return r.rows[0].n === 1 ? r.rows[0].n : undefined;
        });
        expect(after).toBe(1);
    });
});
