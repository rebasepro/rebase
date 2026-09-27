/**
 * A delete through a many-to-many path removes the link, whatever the target
 * collection's delete looks like.
 *
 * `DELETE /posts/1/tags/5` (REST nested, a socket DELETE with that path) means
 * "tag 5 is no longer on post 1" — the persistence layer says so: a shared
 * target loses the link, not the row. When the TARGET collection soft-deletes,
 * the driver never got there: it turned the delete into a save of
 * `{ deletedAt: now }` through the nested path, which trashed tag 5 for every
 * post and re-asserted the link it was asked to remove. Same request, opposite
 * outcome, decided by a flag on the other collection.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, primaryKey, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const postsTable = pgTable("posts", { id: serial("id").primaryKey(), title: varchar("title") });
const tagsTable = pgTable("tags", {
    id: serial("id").primaryKey(),
    name: varchar("name"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});
const labelsTable = pgTable("labels", { id: serial("id").primaryKey(), name: varchar("name") });
const commentsTable = pgTable("comments", {
    id: serial("id").primaryKey(),
    body: varchar("body"),
    postId: integer("post_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});
const postsTagsTable = pgTable("posts_tags", {
    post_id: integer("post_id").notNull(),
    tag_id: integer("tag_id").notNull()
}, (t) => [primaryKey({ columns: [t.post_id, t.tag_id] })]);
const postsLabelsTable = pgTable("posts_labels", {
    post_id: integer("post_id").notNull(),
    label_id: integer("label_id").notNull()
}, (t) => [primaryKey({ columns: [t.post_id, t.label_id] })]);

function posts(): CollectionConfig {
    return {
        name: "Posts", slug: "posts", table: "posts",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags(), through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } } },
            labels: { name: "Labels", type: "relation", relation: { kind: "manyToMany", target: () => labels(), through: { table: "posts_labels", sourceColumn: "post_id", targetColumn: "label_id" } } },
            comments: { name: "Comments", type: "relation", relation: { kind: "hasMany", target: () => comments(), foreignKeyOnTarget: "post_id" } }
        }
    } as unknown as CollectionConfig;
}

function tags(): CollectionConfig {
    return {
        name: "Tags", slug: "tags", table: "tags", softDelete: true, history: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" }
        }
    } as unknown as CollectionConfig;
}

function labels(): CollectionConfig {
    return {
        name: "Labels", slug: "labels", table: "labels",
        properties: { id: { name: "ID", type: "number", isId: "increment" }, name: { name: "Name", type: "string" } }
    } as unknown as CollectionConfig;
}

function comments(): CollectionConfig {
    return {
        name: "Comments", slug: "comments", table: "comments", softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            body: { name: "Body", type: "string" },
            postId: { name: "Post", type: "number", columnName: "post_id" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" }
        }
    } as unknown as CollectionConfig;
}

let db: PGlite;
let recorded: { tableName: string; id: string; action: string }[];

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts(), tags(), labels(), comments()]);
    registry.registerTable(postsTable, "posts");
    registry.registerTable(tagsTable, "tags");
    registry.registerTable(labelsTable, "labels");
    registry.registerTable(commentsTable, "comments");
    registry.registerTable(postsTagsTable, "posts_tags");
    registry.registerTable(postsLabelsTable, "posts_labels");
    const orm = drizzle(pglite, {
        schema: { posts: postsTable, tags: tagsTable, labels: labelsTable, comments: commentsTable, posts_tags: postsTagsTable, posts_labels: postsLabelsTable }
    }) as never;
    const history = {
        recordHistory: async (p: { tableName: string; id: string; action: string }) => {
            recorded.push({ tableName: p.tableName, id: String(p.id), action: p.action });
        }
    };
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, undefined, undefined, history as never);
}

const links = async (table: "posts_tags" | "posts_labels"): Promise<Record<string, unknown>[]> =>
    (await db.query<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY post_id`)).rows;
const tagDeletedAt = async (): Promise<string | null> =>
    (await db.query<{ deleted_at: string | null }>("SELECT deleted_at FROM tags WHERE id = 5")).rows[0].deleted_at;

beforeEach(async () => {
    recorded = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE posts (id serial PRIMARY KEY, title varchar);
        CREATE TABLE tags (id serial PRIMARY KEY, name varchar, deleted_at timestamptz);
        CREATE TABLE labels (id serial PRIMARY KEY, name varchar);
        CREATE TABLE comments (id serial PRIMARY KEY, body varchar, post_id integer, deleted_at timestamptz);
        CREATE TABLE posts_tags (post_id integer NOT NULL, tag_id integer NOT NULL, PRIMARY KEY (post_id, tag_id));
        CREATE TABLE posts_labels (post_id integer NOT NULL, label_id integer NOT NULL, PRIMARY KEY (post_id, label_id));
        INSERT INTO posts (id, title) VALUES (1, 'one'), (2, 'two');
        INSERT INTO tags (id, name) VALUES (5, 'shared');
        INSERT INTO labels (id, name) VALUES (7, 'shared');
        INSERT INTO comments (id, body, post_id) VALUES (3, 'first', 1);
        INSERT INTO posts_tags VALUES (1, 5), (2, 5);
        INSERT INTO posts_labels VALUES (1, 7), (2, 7);
    `);
});

afterEach(async () => {
    await db.close();
});

describe("DELETE through a many-to-many path", () => {
    it("unlinks a plain target from that parent only", async () => {
        await driverOver(db).delete({ row: { id: "7", path: "posts/1/labels" } });

        expect(await links("posts_labels")).toEqual([{ post_id: 2, label_id: 7 }]);
        expect((await db.query("SELECT id FROM labels")).rows).toEqual([{ id: 7 }]);
    });

    it("unlinks a soft-deleting target too, and leaves the shared row live", async () => {
        await driverOver(db).delete({ row: { id: "5", path: "posts/1/tags" } });

        expect(await tagDeletedAt()).toBeNull();
        expect(await links("posts_tags")).toEqual([{ post_id: 2, tag_id: 5 }]);
    });

    it("records no deletion of the target, which still exists", async () => {
        await driverOver(db).delete({ row: { id: "5", path: "posts/1/tags" } });

        expect(recorded).toEqual([]);
    });

    it("a delete of the tag itself still soft-deletes it", async () => {
        await driverOver(db).delete({ row: { id: "5", path: "tags" } });

        expect(await tagDeletedAt()).not.toBeNull();
        expect(recorded).toEqual([{ tableName: "tags", id: "5", action: "delete" }]);
    });

    it("an owned child reached through its parent is still soft-deleted", async () => {
        await driverOver(db).delete({ row: { id: "3", path: "posts/1/comments" } });

        const comment = (await db.query<{ deleted_at: string | null }>("SELECT deleted_at FROM comments WHERE id = 3")).rows[0];
        expect(comment.deleted_at).not.toBeNull();
    });
});
