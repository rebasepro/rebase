/**
 * E2E: duplicating a record changes no row but the copy's own.
 *
 * The admin's "Duplicate" opens a form seeded with the original's values and
 * saves it as a create, and a create writes every relation it carries. For a
 * link whose key lives on the other row — a `hasMany`'s children, a `hasOne`'s
 * profile, a `via` that writes through the target's key — writing it means
 * pointing those rows at the copy. That is how duplicating an author used to
 * move all of their posts to the copy, leaving the original with none, with no
 * message to say so.
 *
 * The guard is over every relation kind at once: each is declared on the same
 * collection, the original is read back the way the admin reads it, the copy is
 * built with the same function the admin's form uses, and afterwards every row
 * that existed before must be exactly as it was. What the copy may carry — its
 * own `belongsTo` key and new `manyToMany` links — is asserted too, so the fix
 * cannot pass by dropping everything.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, RelationKind } from "@rebasepro/types";
import { getCopyValues } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

// ─── Model ──────────────────────────────────────────────────────────────────
//
// authors n──1 editors        belongsTo   (authors.editor_id)
// authors 1──n posts          hasMany     (posts.author_id)
// authors 1──1 profiles       hasOne      (profiles.author_id)
// authors n──n tags           manyToMany  (authors_tags)
// authors 1──1 badges         via, one    (badges.owner_id, written by the join-path writer)
// authors n──n awards         via, many   (authors_awards)

const authorsTable = pgTable("authors", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    editorId: varchar("editor_id")
});
const editorsTable = pgTable("editors", { id: varchar("id").primaryKey(), name: varchar("name") });
const postsTable = pgTable("posts", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    author_id: varchar("author_id")
});
const profilesTable = pgTable("profiles", {
    id: varchar("id").primaryKey(),
    bio: varchar("bio"),
    author_id: varchar("author_id")
});
const tagsTable = pgTable("tags", { id: varchar("id").primaryKey(), label: varchar("label") });
const authorsTagsTable = pgTable("authors_tags", { author_id: varchar("author_id"), tag_id: varchar("tag_id") });
const badgesTable = pgTable("badges", {
    id: varchar("id").primaryKey(),
    label: varchar("label"),
    owner_id: varchar("owner_id")
});
const awardsTable = pgTable("awards", { id: varchar("id").primaryKey(), label: varchar("label") });
const authorsAwardsTable = pgTable("authors_awards", { author_id: varchar("author_id"), award_id: varchar("award_id") });

const simple = (slug: string, extra: Record<string, unknown> = {}): CollectionConfig => ({
    name: slug, slug, table: slug,
    properties: {
        id: { name: "ID", type: "string", isId: true },
        ...extra
    }
} as unknown as CollectionConfig);

const editorsCollection = simple("editors", { name: { type: "string" } });
const postsCollection = simple("posts", { title: { type: "string" }, author_id: { type: "string" } });
const profilesCollection = simple("profiles", { bio: { type: "string" }, author_id: { type: "string" } });
const tagsCollection = simple("tags", { label: { type: "string" } });
const badgesCollection = simple("badges", { label: { type: "string" }, owner_id: { type: "string" } });
const awardsCollection = simple("awards", { label: { type: "string" } });

/** One relation property per kind — declared inline, the way the admin's own collections declare them. */
const RELATION_PROPERTIES: Record<string, { kind: RelationKind; relation: Record<string, unknown> }> = {
    editor: {
        kind: "belongsTo",
        relation: { kind: "belongsTo", target: () => editorsCollection, localKey: "editor_id" }
    },
    posts: {
        kind: "hasMany",
        relation: { kind: "hasMany", target: () => postsCollection, foreignKeyOnTarget: "author_id" }
    },
    profile: {
        kind: "hasOne",
        relation: { kind: "hasOne", target: () => profilesCollection, foreignKeyOnTarget: "author_id" }
    },
    tags: {
        kind: "manyToMany",
        relation: {
            kind: "manyToMany",
            target: () => tagsCollection,
            through: { table: "authors_tags", sourceColumn: "author_id", targetColumn: "tag_id" }
        }
    },
    badge: {
        kind: "via",
        relation: {
            kind: "via",
            target: () => badgesCollection,
            cardinality: "one",
            joinPath: [{ table: "badges", on: { from: "authors.id", to: "badges.owner_id" } }]
        }
    },
    awards: {
        kind: "via",
        relation: {
            kind: "via",
            target: () => awardsCollection,
            cardinality: "many",
            joinPath: [
                { table: "authors_awards", on: { from: "authors.id", to: "authors_awards.author_id" } },
                { table: "awards", on: { from: "authors_awards.award_id", to: "awards.id" } }
            ]
        }
    }
};

/**
 * Every kind in the union, so a kind added later without a row above fails here
 * rather than going unchecked.
 */
const ALL_KINDS: RelationKind[] = ["belongsTo", "hasOne", "hasMany", "manyToMany", "via"];

const authorsCollection: CollectionConfig = {
    name: "Authors", slug: "authors", table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { name: "Name", type: "string" },
        ...Object.fromEntries(Object.entries(RELATION_PROPERTIES).map(([key, { relation }]) =>
            [key, { name: key, type: "relation", relation }]))
    }
} as unknown as CollectionConfig;

const TABLES = ["authors", "editors", "posts", "profiles", "tags", "authors_tags", "badges", "awards", "authors_awards"];

async function snapshot(client: pg.Client): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const table of TABLES) {
        const { rows } = await client.query(`SELECT * FROM ${table}`);
        out[table] = rows.map(row => JSON.stringify(row)).sort();
    }
    return out;
}

describe("Duplicating a record (every relation kind)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE TABLE editors (id VARCHAR PRIMARY KEY, name VARCHAR);
            CREATE TABLE authors (id VARCHAR PRIMARY KEY, name VARCHAR, editor_id VARCHAR REFERENCES editors(id));
            CREATE TABLE posts (id VARCHAR PRIMARY KEY, title VARCHAR, author_id VARCHAR REFERENCES authors(id));
            CREATE TABLE profiles (id VARCHAR PRIMARY KEY, bio VARCHAR, author_id VARCHAR UNIQUE REFERENCES authors(id));
            CREATE TABLE tags (id VARCHAR PRIMARY KEY, label VARCHAR);
            CREATE TABLE authors_tags (author_id VARCHAR REFERENCES authors(id), tag_id VARCHAR REFERENCES tags(id),
                                       PRIMARY KEY (author_id, tag_id));
            CREATE TABLE badges (id VARCHAR PRIMARY KEY, label VARCHAR, owner_id VARCHAR REFERENCES authors(id));
            CREATE TABLE awards (id VARCHAR PRIMARY KEY, label VARCHAR);
            CREATE TABLE authors_awards (author_id VARCHAR REFERENCES authors(id), award_id VARCHAR REFERENCES awards(id),
                                         PRIMARY KEY (author_id, award_id));

            INSERT INTO editors VALUES ('e-1', 'Grace');
            INSERT INTO authors VALUES ('a-1', 'Ada', 'e-1');
            INSERT INTO posts VALUES ('p-1', 'one', 'a-1'), ('p-2', 'two', 'a-1');
            INSERT INTO profiles VALUES ('pr-1', 'mathematician', 'a-1');
            INSERT INTO tags VALUES ('t-1', 'math'), ('t-2', 'poetry');
            INSERT INTO authors_tags VALUES ('a-1', 't-1'), ('a-1', 't-2');
            INSERT INTO badges VALUES ('b-1', 'first', 'a-1');
            INSERT INTO awards VALUES ('w-1', 'medal');
            INSERT INTO authors_awards VALUES ('a-1', 'w-1');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([
            authorsCollection, editorsCollection, postsCollection, profilesCollection,
            tagsCollection, badgesCollection, awardsCollection
        ]);
        registry.registerTable(authorsTable, "authors");
        registry.registerTable(editorsTable, "editors");
        registry.registerTable(postsTable, "posts");
        registry.registerTable(profilesTable, "profiles");
        registry.registerTable(tagsTable, "tags");
        registry.registerTable(authorsTagsTable, "authors_tags");
        registry.registerTable(badgesTable, "badges");
        registry.registerTable(awardsTable, "awards");
        registry.registerTable(authorsAwardsTable, "authors_awards");
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    });

    afterAll(async () => {
        await pool?.end();
        await admin?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("declares a relation property for every relation kind", () => {
        const declared = new Set(Object.values(RELATION_PROPERTIES).map(p => p.kind));
        expect(ALL_KINDS.filter(kind => !declared.has(kind))).toEqual([]);
    });

    it("leaves every existing row as it was, and the copy keeps what it can share", async () => {
        const loaded = await driver.fetchOne({ path: "authors", id: "a-1", collection: authorsCollection });
        if (!loaded) throw new Error("the original did not read back");
        // The admin reads the children with the record — this is what the
        // form opens with, and what a copy used to send back.
        expect(loaded.posts).toBeTruthy();

        const before = await snapshot(admin);

        const copy = getCopyValues(authorsCollection, loaded);
        expect(copy).not.toHaveProperty("id");
        await driver.save({
            path: "authors",
            collection: authorsCollection,
            values: { ...copy, id: "a-2", name: "Ada (copy)" },
            status: "new"
        } as never);

        const after = await snapshot(admin);

        // Nothing that existed before has changed or gone.
        for (const table of TABLES) {
            const missing = before[table].filter(row => !after[table].includes(row));
            expect({ table, changedOrRemoved: missing }).toEqual({ table, changedOrRemoved: [] });
        }

        // The only new rows are the copy and its own links.
        const added = Object.fromEntries(TABLES.map(table =>
            [table, after[table].filter(row => !before[table].includes(row)).map(row => JSON.parse(row))]));
        expect(added.authors).toEqual([{ id: "a-2", name: "Ada (copy)", editor_id: "e-1" }]);
        expect(added.authors_tags.map((r: { author_id: string; tag_id: string }) => `${r.author_id}:${r.tag_id}`).sort())
            .toEqual(["a-2:t-1", "a-2:t-2"]);
        for (const table of ["editors", "posts", "profiles", "tags", "badges", "awards"]) {
            expect({ table, added: added[table] }).toEqual({ table, added: [] });
        }
    });
});
