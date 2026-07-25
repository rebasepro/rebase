/**
 * E2E: what a nested collection path may address, against a real Postgres.
 *
 * A path like `authors/1/posts/43` resolved to the target collection and then
 * matched on the primary key alone, so the parent segment decided nothing. Three
 * ways that lost data:
 *
 *   1. `DELETE authors/1/posts/43` deleted post 43 whoever wrote it.
 *   2. `PUT authors/1/posts/43` injected the parent's foreign key into the
 *      values, silently reparenting someone else's row.
 *   3. `DELETE posts/1/tags/5` resolved to the `tags` table and deleted the tag
 *      itself — removing it from every other post — instead of the link.
 *
 * And a fourth, on the way in: writing through a to-one relation stamped the
 * *parent's* foreign key column onto the target row.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

// ─── Model ──────────────────────────────────────────────────────────────────
//
// authors 1──n posts        (inverse FK: posts.author_id)
// posts   n──n tags         (junction: posts_tags)
// posts   n──1 authors      (owning FK: posts.author_id) — read-only as a path

const authorsTable = pgTable("authors", {
    id: varchar("id").primaryKey(),
    name: varchar("name")
});
const postsTable = pgTable("posts", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    author_id: varchar("author_id")
});
const tagsTable = pgTable("tags", {
    id: varchar("id").primaryKey(),
    label: varchar("label")
});
const postsTagsTable = pgTable("posts_tags", {
    post_id: varchar("post_id"),
    tag_id: varchar("tag_id")
});

const tagsCollection: CollectionConfig = {
    name: "Tags", slug: "tags", table: "tags",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        label: { name: "Label", type: "string" }
    },
    relations: [
        // The other side of the junction, so a listing can be exercised through
        // one. Named differently from its target's slug on purpose.
        {
            relationName: "posts_via_tag",
            target: () => postsCollection,
            cardinality: "many",
            direction: "inverse",
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        }
    ]
} as unknown as CollectionConfig;

const authorsCollection: CollectionConfig = {
    name: "Authors", slug: "authors", table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { name: "Name", type: "string" }
    },
    relations: [
        {
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            direction: "inverse",
            foreignKeyOnTarget: "author_id"
        }
    ]
} as unknown as CollectionConfig;

const postsCollection: CollectionConfig = {
    name: "Posts", slug: "posts", table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        author_id: { name: "Author id", type: "string" }
    },
    relations: [
        {
            relationName: "author",
            target: () => authorsCollection,
            cardinality: "one",
            direction: "owning",
            localKey: "author_id"
        },
        {
            relationName: "tags",
            target: () => tagsCollection,
            cardinality: "many",
            direction: "owning",
            through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
        }
    ]
} as unknown as CollectionConfig;

function buildRegistry(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([authorsCollection, postsCollection, tagsCollection]);
    registry.registerTable(authorsTable, "authors");
    registry.registerTable(postsTable, "posts");
    registry.registerTable(tagsTable, "tags");
    registry.registerTable(postsTagsTable, "posts_tags");
    return registry;
}

describe("Nested path writes (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;

    async function rows(sql: string): Promise<Record<string, unknown>[]> {
        return (await admin.query(sql)).rows;
    }
    async function one(sql: string): Promise<Record<string, unknown> | undefined> {
        return (await rows(sql))[0];
    }

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await admin.query(`
            CREATE TABLE public.authors (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255));
            CREATE TABLE public.posts (
                id VARCHAR(255) PRIMARY KEY, title VARCHAR(255), author_id VARCHAR(255)
            );
            CREATE TABLE public.tags (id VARCHAR(255) PRIMARY KEY, label VARCHAR(255));
            CREATE TABLE public.posts_tags (
                post_id VARCHAR(255), tag_id VARCHAR(255), PRIMARY KEY (post_id, tag_id)
            );
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = buildRegistry();
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    }, 120_000);

    afterAll(async () => {
        if (pool) await pool.end().catch(() => {});
        if (admin) await admin.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(async () => {
        await admin.query(`
            TRUNCATE public.posts_tags, public.posts, public.tags, public.authors;
            INSERT INTO public.authors (id, name) VALUES ('a-1', 'Ada'), ('a-2', 'Blaise');
            INSERT INTO public.posts (id, title, author_id) VALUES
                ('p-1', 'Ada post',    'a-1'),
                ('p-2', 'Blaise post', 'a-2');
            INSERT INTO public.tags (id, label) VALUES ('t-1', 'physics'), ('t-2', 'maths');
            INSERT INTO public.posts_tags (post_id, tag_id) VALUES
                ('p-1', 't-1'),
                ('p-2', 't-1');
        `);
    });

    // ── 1. Deleting through a parent that does not own the row ───────────────

    it("refuses to delete a row that is not under the parent in the path", async () => {
        await expect(driver.delete({
            row: { id: "p-2", path: "authors/a-1/posts", values: {} }
        } as never)).rejects.toThrow(/No row "p-2" in "authors\/a-1\/posts"/);

        expect(await one("SELECT * FROM public.posts WHERE id = 'p-2'")).toBeDefined();
    });

    it("still deletes a row that IS under the parent", async () => {
        await driver.delete({ row: { id: "p-1", path: "authors/a-1/posts", values: {} } } as never);
        expect(await one("SELECT * FROM public.posts WHERE id = 'p-1'")).toBeUndefined();
    });

    // ── 2. Updating through a parent that does not own the row ───────────────

    it("refuses to update — and so cannot reparent — a row under a foreign parent", async () => {
        await expect(driver.save({
            path: "authors/a-1/posts",
            id: "p-2",
            values: { title: "hijacked" },
            status: "existing"
        } as never)).rejects.toThrow(/No row "p-2" in "authors\/a-1\/posts"/);

        const post = await one("SELECT * FROM public.posts WHERE id = 'p-2'");
        expect(post?.author_id).toBe("a-2");     // not moved to a-1
        expect(post?.title).toBe("Blaise post"); // not overwritten
    });

    it("still updates a row that IS under the parent, leaving its parent alone", async () => {
        await driver.save({
            path: "authors/a-1/posts",
            id: "p-1",
            values: { title: "edited" },
            status: "existing"
        } as never);

        const post = await one("SELECT * FROM public.posts WHERE id = 'p-1'");
        expect(post?.title).toBe("edited");
        expect(post?.author_id).toBe("a-1");
    });

    it("still creates under the parent, stamping the child's foreign key", async () => {
        await driver.save({
            path: "authors/a-1/posts",
            values: { id: "p-new", title: "fresh" },
            status: "new"
        } as never);

        const post = await one("SELECT * FROM public.posts WHERE id = 'p-new'");
        expect(post?.author_id).toBe("a-1");
    });

    // ── 3. Many-to-many: the path addresses the link, not the shared row ─────

    it("unlinks a many-to-many target instead of deleting it", async () => {
        await driver.delete({ row: { id: "t-1", path: "posts/p-1/tags", values: {} } } as never);

        // the link from p-1 is gone …
        expect(await rows("SELECT * FROM public.posts_tags WHERE post_id = 'p-1'")).toHaveLength(0);
        // … the tag itself survives …
        expect(await one("SELECT * FROM public.tags WHERE id = 't-1'")).toBeDefined();
        // … and so does every other post's use of it.
        expect(await rows("SELECT * FROM public.posts_tags WHERE tag_id = 't-1'")).toHaveLength(1);
    });

    it("refuses to unlink a many-to-many target the parent is not linked to", async () => {
        await expect(driver.delete({
            row: { id: "t-2", path: "posts/p-1/tags", values: {} }
        } as never)).rejects.toThrow(/No row "t-2" in "posts\/p-1\/tags"/);

        expect(await one("SELECT * FROM public.tags WHERE id = 't-2'")).toBeDefined();
    });

    it("still creates and links a new many-to-many target", async () => {
        await driver.save({
            path: "posts/p-1/tags",
            values: { id: "t-3", label: "chemistry" },
            status: "new"
        } as never);

        expect(await one("SELECT * FROM public.tags WHERE id = 't-3'")).toBeDefined();
        expect(await rows("SELECT * FROM public.posts_tags WHERE post_id = 'p-1' AND tag_id = 't-3'")).toHaveLength(1);
    });

    // ── 4. Writing through a to-one relation ────────────────────────────────

    it("rejects a write through a to-one relation instead of stamping the parent's own FK", async () => {
        await expect(driver.save({
            path: "posts/p-1/author",
            values: { id: "a-new", name: "Nobody" },
            status: "new"
        } as never)).rejects.toThrow(/cannot be written through/);

        expect(await one("SELECT * FROM public.authors WHERE id = 'a-new'")).toBeUndefined();
    });

    // ── 5. Reads are scoped the same way ────────────────────────────────────

    it("does not serve a row through a parent that does not own it", async () => {
        expect(await driver.fetchOne({ path: "authors/a-1/posts", id: "p-2" } as never)).toBeUndefined();
        expect(await driver.fetchOne({ path: "authors/a-1/posts", id: "p-1" } as never)).toBeDefined();
    });

    // ── 6. A child listing is the root listing, narrowed ─────────────────────
    //
    // These are the options the old nested-path builder accepted and silently
    // dropped. They work now because there is no nested-path builder: a related
    // listing is the ordinary collection query with one more condition.

    describe("a related listing carries the root pipeline's query options", () => {
        beforeEach(async () => {
            await admin.query(`
                INSERT INTO public.posts (id, title, author_id) VALUES
                    ('p-3', 'Ada 2', 'a-1'),
                    ('p-4', 'Ada 3', 'a-1'),
                    ('p-5', 'Ada 4', 'a-1');
                INSERT INTO public.posts_tags (post_id, tag_id) VALUES
                    ('p-3', 't-1'), ('p-4', 't-1'), ('p-5', 't-2');
            `);
        });

        const titles = (rows: Record<string, unknown>[]) => rows.map(r => r.title);

        it("scopes to the parent at all", async () => {
            const rows = await driver.fetchCollection({ path: "authors/a-1/posts" } as never);
            expect(titles(rows).sort()).toEqual(["Ada 2", "Ada 3", "Ada 4", "Ada post"]);
        });

        it("applies filter", async () => {
            const rows = await driver.fetchCollection({
                path: "authors/a-1/posts",
                filter: { title: ["==", "Ada 2"] }
            } as never);
            expect(titles(rows)).toEqual(["Ada 2"]);
        });

        it("applies orderBy and paginates with limit + offset", async () => {
            const page1 = await driver.fetchCollection({
                path: "authors/a-1/posts", orderBy: "title", order: "asc", limit: 2, offset: 0
            } as never);
            const page2 = await driver.fetchCollection({
                path: "authors/a-1/posts", orderBy: "title", order: "asc", limit: 2, offset: 2
            } as never);

            expect(titles(page1)).toEqual(["Ada 2", "Ada 3"]);
            // The bug this pins: page 2 used to be page 1 again.
            expect(titles(page2)).toEqual(["Ada 4", "Ada post"]);
        });

        it("counts the rows the filter actually leaves", async () => {
            expect(await driver.count!({ path: "authors/a-1/posts" } as never)).toBe(4);
            expect(await driver.count!({
                path: "authors/a-1/posts",
                filter: { title: ["==", "Ada 2"] }
            } as never)).toBe(1);
        });

        it("does the same through a junction, without the join multiplying rows", async () => {
            const rows = await driver.fetchCollection({
                path: "tags/t-1/posts_via_tag", orderBy: "title", order: "asc", limit: 2, offset: 1
            } as never);

            expect(titles(rows)).toEqual(["Ada 3", "Ada post"]);
            expect(await driver.count!({ path: "tags/t-1/posts_via_tag" } as never)).toBe(4);
        });
    });
});
