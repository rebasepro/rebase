/**
 * A one-to-one `via` write moves only a row its caller could see.
 *
 * `posts.profile` reaches `profiles` by the post's author:
 * `posts.author_id = profiles.author_id`. Saving
 * `posts/1 { profile: 3 }` clears `author_id` on the profile the author has
 * and stamps it on profile 3. Neither statement read through the target's
 * `beforeQuery` scope or its soft delete, so a tenant-a caller could take
 * tenant b's profile, or a trashed one, by naming it — and clearing the
 * author's current profile detached ones the caller was never shown.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User, CollectionCallbacks } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const authorsTable = pgTable("authors", { id: serial("id").primaryKey(), name: varchar("name") });
const postsTable = pgTable("posts", { id: serial("id").primaryKey(), title: varchar("title"), author_id: integer("author_id") });
const profilesTable = pgTable("profiles", {
    id: serial("id").primaryKey(),
    bio: varchar("bio"),
    tenant: varchar("tenant"),
    author_id: integer("author_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});

const tenantScope: NonNullable<CollectionCallbacks["beforeQuery"]> = ({ context }) => {
    const tenant = context.user?.claims?.tenant;
    if (typeof tenant !== "string") return;
    return { filter: { tenant: ["==", tenant] } };
};

function authors(): CollectionConfig {
    return {
        name: "Authors", slug: "authors", table: "authors",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" }
        }
    };
}

function posts(): CollectionConfig {
    return {
        name: "Posts", slug: "posts", table: "posts",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            author_id: { name: "Author", type: "number" },
            profile: {
                name: "Profile", type: "relation",
                relation: {
                    kind: "via", target: () => profiles(), cardinality: "one",
                    joinPath: [{ table: "profiles", on: { from: "author_id", to: "author_id" } }]
                }
            }
        }
    };
}

function profiles(): CollectionConfig {
    return {
        name: "Profiles", slug: "profiles", table: "profiles",
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            bio: { name: "Bio", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            author_id: { name: "Author", type: "number" },
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
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([authors(), posts(), profiles()]);
    registry.registerTable(authorsTable, "authors");
    registry.registerTable(postsTable, "posts");
    registry.registerTable(profilesTable, "profiles");
    const orm = drizzle(pglite, {
        schema: { authors: authorsTable, posts: postsTable, profiles: profilesTable }
    }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE authors (id serial PRIMARY KEY, name varchar);
        CREATE TABLE posts (id serial PRIMARY KEY, title varchar, author_id integer REFERENCES authors(id));
        CREATE TABLE profiles (id serial PRIMARY KEY, bio varchar, tenant varchar, author_id integer REFERENCES authors(id), deleted_at timestamptz);
        INSERT INTO authors (id, name) VALUES (1, 'Ada'), (2, 'Grace');
        INSERT INTO posts (id, title, author_id) VALUES (1, 'Hello', 1);
        INSERT INTO profiles (bio, tenant, author_id, deleted_at) VALUES
            ('free-a', 'a', NULL, NULL), ('trashed-a', 'a', 2, now()), ('other-b', 'b', 2, NULL), ('hidden-b', 'b', 1, NULL);
    `);
});

afterEach(async () => {
    await db.close();
});

const authorOf = async () =>
    Object.fromEntries((await db.query<{ bio: string; author_id: number | null }>(
        "SELECT bio, author_id FROM profiles ORDER BY id"
    )).rows.map(r => [r.bio, r.author_id]));

describe("a one-to-one via write", () => {
    it("does not take a row the caller's scope hides", async () => {
        await driverOver(db, TENANT_USER).save({ path: "posts", id: 1, values: { profile: 3 }, status: "existing" });
        expect((await authorOf())["other-b"]).toBe(2);
    });

    it("does not take a trashed row", async () => {
        await driverOver(db, TENANT_USER).save({ path: "posts", id: 1, values: { profile: 2 }, status: "existing" });
        expect((await authorOf())["trashed-a"]).toBe(2);
    });

    it("links a visible row, detaching only the visible ones it replaces", async () => {
        await driverOver(db, TENANT_USER).save({ path: "posts", id: 1, values: { profile: 1 }, status: "existing" });
        expect(await authorOf()).toEqual({ "free-a": 1, "trashed-a": 2, "other-b": 2, "hidden-b": 1 });
    });

    it("clears only what the caller can see", async () => {
        await driverOver(db, TENANT_USER).save({ path: "posts", id: 1, values: { profile: null }, status: "existing" });
        expect((await authorOf())["hidden-b"]).toBe(1);
    });

    it("moves any row when nothing scopes the caller", async () => {
        await driverOver(db).save({ path: "posts", id: 1, values: { profile: 3 }, status: "existing" });
        expect(await authorOf()).toEqual({ "free-a": null, "trashed-a": 2, "other-b": 1, "hidden-b": null });
    });
});
