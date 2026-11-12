/**
 * A hasOne write points only a row its caller could see at its parent.
 *
 * Setting `owners/2 { mainDoc: 3 }` stamps `owner_id = 2` on doc 3. The
 * hasMany writer only re-parents the rows the caller's `beforeQuery` scope
 * and the trash leave visible; the hasOne writer re-parented any id it was
 * handed, so a tenant-a caller could take tenant b's doc — or a trashed one —
 * from its owner by naming it.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User, CollectionCallbacks } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
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
    post_id: integer("post_id"),
    tag_id: integer("tag_id")
});

/** Scoped by the caller's tenant claim, when they have one. */
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

const TENANT_USER: User = {
    uid: "u1", displayName: null, email: null, photoURL: null, providerId: "test", isAnonymous: false,
    roles: ["user"], claims: { tenant: "a" }
};

let db: PGlite;

function driverOver(pglite: PGlite, user?: User): PostgresBackendDriver {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([owners(), docs(), posts(), tags()]);
    registry.registerPgTable(ownersTable, "owners");
    registry.registerPgTable(docsTable, "docs");
    registry.registerPgTable(postsTable, "posts");
    registry.registerPgTable(tagsTable, "tags");
    registry.registerPgTable(postsTagsTable, "posts_tags");
    const orm = drizzle(pglite, {
        schema: { owners: ownersTable, docs: docsTable, posts: postsTable, tags: tagsTable, posts_tags: postsTagsTable }
    });
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE owners (id serial PRIMARY KEY, name varchar);
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, tenant varchar, owner_id integer REFERENCES owners(id), deleted_at timestamptz);
        INSERT INTO owners (id, name) VALUES (1, 'Ada'), (2, 'Grace');
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

describe("a hasOne write", () => {
    it("does not take a row the caller's scope hides from its owner", async () => {
        await driverOver(db, TENANT_USER).save({ path: "owners", id: 2, values: { mainDoc: 3 }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": 1, "trashed-a": 1, "gamma-b": 1 });
    });

    it("does not take a trashed row either", async () => {
        await driverOver(db, TENANT_USER).save({ path: "owners", id: 2, values: { mainDoc: 2 }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": 1, "trashed-a": 1, "gamma-b": 1 });
    });

    it("still points a visible row at its new owner", async () => {
        await driverOver(db, TENANT_USER).save({ path: "owners", id: 2, values: { mainDoc: 1 }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": 2, "trashed-a": 1, "gamma-b": 1 });
    });

    it("points any row at it when nothing scopes the caller", async () => {
        await driverOver(db).save({ path: "owners", id: 2, values: { mainDoc: 3 }, status: "existing" });
        expect(await ownerOf()).toEqual({ "alpha": 1, "trashed-a": 1, "gamma-b": 2 });
    });
});
