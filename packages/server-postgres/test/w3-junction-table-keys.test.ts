/**
 * A junction whose drizzle table keys its columns by another name than the
 * columns' own is written, not only read.
 *
 * `posts_tags` declared as `{ postId: integer("post_id"), tagId: integer("tag_id") }`
 * with `through: { sourceColumn: "postId", targetColumn: "tagId" }` passes the
 * relation check and reads, but a link was inserted with its values keyed by
 * the column names (`post_id`, `tag_id`). drizzle keys an insert by the
 * table's keys and leaves any other out of the statement, so every new link
 * was a row of NULLs, refused as a missing required field.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User, CollectionCallbacks } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const ownersTable = pgTable("owners", { id: serial("id").primaryKey(), name: varchar("name") });
const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    tenant: varchar("tenant"),
    ownerId: integer("owner_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});
const postsTable = pgTable("posts", { id: serial("id").primaryKey(), title: varchar("title") });
const tagsTable = pgTable("tags", {
    id: serial("id").primaryKey(),
    name: varchar("name"),
    tenant: varchar("tenant"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});
const postsTagsTable = pgTable("posts_tags", {
    postId: integer("post_id"),
    tagId: integer("tag_id")
});

/** Scoped by the caller's tenant, when they have one. */
const tenantScope: NonNullable<CollectionCallbacks["beforeQuery"]> = ({ context }) => {
    const tenant = context.user?.claims?.tenant;
    if (typeof tenant !== "string") return;
    return { filter: { tenant: ["==", tenant] } };
};

function owners(): CollectionConfig {
    return {
        name: "Owners", slug: "owners", table: "owners",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            docs: { name: "Docs", type: "relation", relation: { kind: "hasMany", target: () => docs(), foreignKeyOnTarget: "owner_id" } },
            // The to-one reading of the same link, which clears through a path
            // of its own.
            mainDoc: { name: "Main doc", type: "relation", relation: { kind: "hasOne", target: () => docs(), foreignKeyOnTarget: "owner_id" } }
        }
    };
}

function docs(): CollectionConfig {
    return {
        name: "Docs", slug: "docs", table: "docs",
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" }
        },
        callbacks: { beforeQuery: tenantScope }
    };
}

function posts(): CollectionConfig {
    return {
        name: "Posts", slug: "posts", table: "posts",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            tags: {
                name: "Tags", type: "relation",
                relation: {
                    kind: "manyToMany", target: () => tags(),
                    through: { table: "posts_tags", sourceColumn: "postId", targetColumn: "tagId" }
                }
            },
            viaTags: {
                name: "Tags (join path)", type: "relation",
                relation: {
                    kind: "via", target: () => tags(), cardinality: "many",
                    joinPath: [
                        { table: "posts_tags", on: { from: "id", to: "post_id" } },
                        { table: "tags", on: { from: "tag_id", to: "id" } }
                    ]
                }
            }
        }
    };
}

function tags(): CollectionConfig {
    return {
        name: "Tags", slug: "tags", table: "tags",
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" }
        },
        callbacks: { beforeQuery: tenantScope }
    };
}

let db: PGlite;

function driverOver(pglite: PGlite, user?: User): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([owners(), docs(), posts(), tags()]);
    registry.registerTable(ownersTable, "owners");
    registry.registerTable(docsTable, "docs");
    registry.registerTable(postsTable, "posts");
    registry.registerTable(tagsTable, "tags");
    registry.registerTable(postsTagsTable, "posts_tags");
    // PGlite's drizzle database stands in for node-postgres's: the driver names NodePgDatabase, whose
    // `$client` is a pg pool, and no typed bridge between the two exists.
    const orm = drizzle(pglite, {
        schema: { owners: ownersTable, docs: docsTable, posts: postsTable, tags: tagsTable, posts_tags: postsTagsTable }
    }) as unknown as NodePgDatabase;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE owners (id serial PRIMARY KEY, name varchar);
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, tenant varchar, owner_id integer REFERENCES owners(id), deleted_at timestamptz);
        INSERT INTO owners (id, name) VALUES (1, 'Ada');
        INSERT INTO docs (title, tenant, owner_id, deleted_at) VALUES
            ('alpha', 'a', 1, NULL), ('trashed-a', 'a', 1, now()), ('gamma-b', 'b', 1, NULL);

        CREATE TABLE posts (id serial PRIMARY KEY, title varchar);
        CREATE TABLE tags (id serial PRIMARY KEY, name varchar, tenant varchar, deleted_at timestamptz);
        CREATE TABLE posts_tags (post_id integer REFERENCES posts(id), tag_id integer REFERENCES tags(id), PRIMARY KEY (post_id, tag_id));
        INSERT INTO posts (id, title) VALUES (1, 'Hello');
        INSERT INTO tags (name, tenant, deleted_at) VALUES ('ts', 'a', NULL), ('old', 'a', now()), ('b-tag', 'b', NULL);
        INSERT INTO posts_tags VALUES (1, 1), (1, 2), (1, 3);
    `);
});

afterEach(async () => {
    await db.close();
});

const linkedTags = async () =>
    (await db.query<{ tag_id: number }>("SELECT tag_id FROM posts_tags WHERE post_id = 1 ORDER BY tag_id"))
        .rows.map(r => r.tag_id);

describe("a junction keyed by other names than its columns", () => {
    it("takes a new link in a membership write", async () => {
        await db.exec("INSERT INTO tags (id, name, tenant) VALUES (4, 'new', 'a')");
        await driverOver(db).save({ path: "posts", id: 1, values: { tags: [1, 4] }, status: "existing" });
        expect(await linkedTags()).toEqual([1, 2, 4]);
    });

    it("takes the link a create through the relation's path makes", async () => {
        const tag = await driverOver(db).save({ path: "posts/1/tags", values: { name: "nested", tenant: "a" }, status: "new" });
        expect(await linkedTags()).toEqual([1, 2, 3, Number(tag.id)]);
    });
});
