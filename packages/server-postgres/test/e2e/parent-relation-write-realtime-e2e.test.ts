/**
 * E2E: a many-to-many set written through the parent reaches the live child
 * list, without change capture.
 *
 * `save("posts", "p-1", { tags: [...] })` rewrites `posts_tags` — the
 * contents of the list `posts/p-1/tags`. Under change capture the junction's
 * trigger announces that. Without it the only announcement is the driver's
 * own, which named the parent row: `posts` and the paths that land on posts.
 * `posts/p-1/tags` lands on tags, so its subscribers never heard.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const postsTable = pgTable("posts", { id: varchar("id").primaryKey(), title: varchar("title") });
const tagsTable = pgTable("tags", { id: varchar("id").primaryKey(), label: varchar("label") });
const postsTagsTable = pgTable("posts_tags", { post_id: varchar("post_id"), tag_id: varchar("tag_id") });

const tagsCollection = {
    name: "Tags", slug: "tags", table: "tags",
    properties: { id: { name: "ID", type: "string", isId: true }, label: { name: "Label", type: "string" } }
} as unknown as CollectionConfig;

const postsCollection = {
    name: "Posts", slug: "posts", table: "posts",
    properties: { id: { name: "ID", type: "string", isId: true }, title: { name: "Title", type: "string" } },
    relations: [{
        kind: "manyToMany",
        relationName: "tags",
        target: () => tagsCollection,
        through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
    }]
} as unknown as CollectionConfig;

class CollectingSocket {
    readyState = 1;
    messages: string[] = [];
    send(msg: string) { this.messages.push(msg); }
    on() { /* no close/error handling needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    frames(subscriptionId: string) {
        return this.messages.map((m) => JSON.parse(m) as Record<string, unknown>)
            .filter((m) => m.type === "collection_update" && m.subscriptionId === subscriptionId);
    }
}

describe("a many-to-many set saved through the parent, without change capture (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let driver: PostgresBackendDriver;

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE TABLE public.posts (id VARCHAR(255) PRIMARY KEY, title VARCHAR(255));
            CREATE TABLE public.tags (id VARCHAR(255) PRIMARY KEY, label VARCHAR(255));
            CREATE TABLE public.posts_tags (post_id VARCHAR(255), tag_id VARCHAR(255), PRIMARY KEY (post_id, tag_id));
            INSERT INTO public.posts (id, title) VALUES ('p-1', 'Ada post');
            INSERT INTO public.tags (id, label) VALUES ('t-1', 'physics'), ('t-2', 'maths');
            INSERT INTO public.posts_tags (post_id, tag_id) VALUES ('p-1', 't-1');
        `);
        await admin.end();

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
        expect(realtime.isCdcActive()).toBe(false);
    }, 180_000);

    afterAll(async () => {
        await realtime?.destroy();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("delivers the new set to a subscriber of the child list", async () => {
        const ws = new CollectingSocket();
        realtime.addClient("c1", ws as never);
        await realtime.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "posts/p-1/tags", subscriptionId: "tags-of-p1" }
        } as never);
        expect(ws.frames("tags-of-p1")).toHaveLength(1);

        await driver.save({
            path: "posts",
            id: "p-1",
            values: { tags: [{ id: "t-2", path: "tags", __type: "relation" }] } as never,
            collection: postsCollection,
            status: "existing"
        });

        let frames: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 60; i++) {
            frames = ws.frames("tags-of-p1");
            if (frames.length > 1) break;
            await new Promise((r) => setTimeout(r, 50));
        }
        expect(frames.length).toBeGreaterThan(1);
        const ids = (frames[frames.length - 1].rows as Array<{ id?: string; values?: { id?: string } }>)
            .map((r) => r.id ?? r.values?.id);
        expect(ids).toEqual(["t-2"]);
    }, 30_000);
});
