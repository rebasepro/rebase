/**
 * A membership write unlinks only what its caller could have seen linked.
 *
 * Saving `owners/1 { docs: [1] }` means "these are the docs, of the ones I was
 * shown". The writer diffed it against every row linked to the owner — in any
 * tenant, trashed or not — so a tenant-a user who read `?include=docs`, saw
 * `[alpha]` and saved it back set `owner_id = NULL` on tenant b's doc and on
 * the trashed one: a cross-tenant write through a relation the scope hid. A
 * junction diff did the same to a post's link to a trashed tag.
 *
 * The existing links are now read the way the include pipeline reads them —
 * through the target's `beforeQuery` scope and its soft delete — so a link the
 * caller could not see is in neither list and survives the save.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

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
    post_id: integer("post_id"),
    tag_id: integer("tag_id")
});

/** Scoped by the caller's tenant, when they have one. */
const tenantScope = ({ context }: { context: { user?: { tenant?: string } } }) => {
    const tenant = context.user?.tenant;
    if (!tenant) return;
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
    } as unknown as CollectionConfig;
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
    } as unknown as CollectionConfig;
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
                    through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
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
    } as unknown as CollectionConfig;
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
    } as unknown as CollectionConfig;
}

const TENANT_USER = { uid: "u1", roles: ["user"], tenant: "a" } as unknown as User;

let db: PGlite;

function driverOver(pglite: PGlite, user?: User): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([owners(), docs(), posts(), tags()]);
    registry.registerTable(ownersTable, "owners");
    registry.registerTable(docsTable, "docs");
    registry.registerTable(postsTable, "posts");
    registry.registerTable(tagsTable, "tags");
    registry.registerTable(postsTagsTable, "posts_tags");
    const orm = drizzle(pglite, {
        schema: { owners: ownersTable, docs: docsTable, posts: postsTable, tags: tagsTable, posts_tags: postsTagsTable }
    }) as never;
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

const ownerOf = async () =>
    Object.fromEntries((await db.query<{ title: string; owner_id: number | null }>(
        "SELECT title, owner_id FROM docs ORDER BY id"
    )).rows.map(r => [r.title, r.owner_id]));

const linkedTags = async () =>
    (await db.query<{ tag_id: number }>("SELECT tag_id FROM posts_tags WHERE post_id = 1 ORDER BY tag_id"))
        .rows.map(r => r.tag_id);

describe("a hasMany membership write", () => {
    it("leaves the links to rows the caller's scope and the trash hide", async () => {
        await driverOver(db, TENANT_USER).save({ path: "owners", id: 1, values: { docs: [1] }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": 1, "trashed-a": 1, "gamma-b": 1 });
    });

    it("leaves them when the caller empties the list, too", async () => {
        await driverOver(db, TENANT_USER).save({ path: "owners", id: 1, values: { docs: [] }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": null, "trashed-a": 1, "gamma-b": 1 });
    });

    it("unlinks every visible row it was not handed when nothing scopes the caller", async () => {
        await driverOver(db).save({ path: "owners", id: 1, values: { docs: [1] }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": 1, "trashed-a": 1, "gamma-b": null });
    });
});

describe("a hasOne write", () => {
    it("detaches only a row the caller could see", async () => {
        await driverOver(db, TENANT_USER).save({ path: "owners", id: 1, values: { mainDoc: null }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": null, "trashed-a": 1, "gamma-b": 1 });
    });
});

describe("a junction membership write", () => {
    it("leaves the links to rows the caller's scope and the trash hide (manyToMany)", async () => {
        await driverOver(db, TENANT_USER).save({ path: "posts", id: 1, values: { tags: [] }, status: "existing" });
        expect(await linkedTags()).toEqual([2, 3]);
    });

    it("leaves them through a join path as well", async () => {
        await driverOver(db, TENANT_USER).save({ path: "posts", id: 1, values: { viaTags: [] }, status: "existing" });
        expect(await linkedTags()).toEqual([2, 3]);
    });

    it("still unlinks a visible row the caller left out", async () => {
        await driverOver(db).save({ path: "posts", id: 1, values: { tags: [] }, status: "existing" });
        expect(await linkedTags()).toEqual([2]);
    });
});
