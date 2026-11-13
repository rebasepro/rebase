/**
 * Relations on tables authored with `defineTable` — not lifted legacy
 * collections — through the driver's own doors: an include, a nested listing,
 * a membership write with `_pivot`, an edit of one link's pivot columns.
 *
 * Each relation fact is read from the compiled `RelationDescriptor`:
 * `rel.manyToMany({ pivot })` (`_pivot` read, write, update, realtime),
 * `rel.hasMany({ orderBy })` (the declared order, and how a caller's order
 * and a limit compose with it), a natural-key `sourceKey` on `hasMany` and
 * `hasOne`, a `via` read, and a `belongsTo` with `constraint: false`.
 *
 * Against a real Postgres (PGlite), with the tables created from the plan of
 * the same definitions.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, rel, type IncludeSpec } from "@rebasepro/types";
import { compileSchema, lowerTables } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { FixtureTableRegistry } from "./helpers/tables";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const tags = defineTable("tags", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        label: col.text()
    },
    rls: "admin-only"
});

const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text(),
        handle: col.text().unique()
    },
    relations: {
        // Declared order: the lowest rank first.
        posts: rel.hasMany(() => posts, { orderBy: [["rank", "asc"]] }),
        // Linked on a natural key: the posts hold the author's handle.
        signed: rel.hasMany(() => posts, { foreignKey: "signed_by", sourceKey: "handle" }),
        profile: rel.hasOne(() => profiles, { foreignKey: "author_handle", sourceKey: "handle" }),
        // Every tag of every post the author wrote.
        postTags: rel.via(() => tags, {
            steps: [
                { table: "posts", on: { from: "id", to: "author_id" } },
                { table: "post_tags", on: { from: "id", to: "post_id" } },
                { table: "tags", on: { from: "tag_id", to: "id" } }
            ]
        })
    },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        title: col.text(),
        rank: col.integer(),
        signedBy: col.text()
    },
    relations: {
        author: rel.belongsTo(() => authors),
        // A key kept without a foreign-key constraint.
        reviewer: rel.belongsTo(() => authors, { localKey: "reviewer_id", constraint: false }),
        tags: rel.manyToMany(() => tags, {
            through: "post_tags",
            sourceKey: "post_id",
            targetKey: "tag_id",
            pivot: { position: col.integer(), role: col.text(), weight: col.numeric(), addedAt: col.timestamp({ withTimezone: true }) }
        })
    },
    rls: "admin-only"
});

const profiles = defineTable("profiles", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        bio: col.text(),
        authorHandle: col.text().unique()
    },
    rls: "admin-only"
});

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let driver: PostgresBackendDriver;
let realtime: RealtimeService;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const defs = [tags, authors, posts, profiles];
    const compiled = compileSchema(defs);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    // The lowered collections are what the subsystems not yet moved still read
    // (registry, driver entry points); the relation services read the compiled tables.
    const collections = lowerTables(defs);
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    const registry = new FixtureTableRegistry();
    registry.registerMultiple(collections);
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    realtime = new RealtimeService(orm, registry);
    driver = new PostgresBackendDriver(orm, realtime, registry);

    await db.exec(`
        INSERT INTO authors (name, handle) VALUES ('Ada', 'ada'), ('Bo', 'bo');
        INSERT INTO tags (label) VALUES ('red'), ('green'), ('blue');
        INSERT INTO posts (title, rank, author_id, signed_by, reviewer_id) VALUES
            ('third', 3, 1, 'ada', 2),
            ('first', 1, 1, 'ada', 999),
            ('second', 2, 1, 'bo', NULL),
            ('other', 1, 2, NULL, NULL);
        INSERT INTO profiles (bio, author_handle) VALUES ('Ada writes', 'ada');
        INSERT INTO post_tags (post_id, tag_id) VALUES (2, 3);
    `);
});

afterAll(async () => {
    await db.close();
});

const list = (path: string, options: Record<string, unknown> = {}, include?: IncludeSpec) =>
    driver.restFetchService.fetchCollectionForRest(path, options, include);

const one = async (path: string, id: number, include: IncludeSpec): Promise<Record<string, unknown>> => {
    const rows = await list(path, { filter: { id: ["==", id] } }, include);
    const row = rows[0];
    if (!row) throw new Error(`no ${path} ${id}`);
    return row;
};

const titles = (value: unknown): unknown[] =>
    (Array.isArray(value) ? value : []).map(row => (row as Record<string, unknown>).title);

describe("rel.hasMany({ orderBy })", () => {
    it("serves an include in the declared order", async () => {
        const ada = await one("authors", 1, ["posts"]);
        expect(titles(ada.posts)).toEqual(["first", "second", "third"]);
    });

    it("lets the include's own order replace the declared one", async () => {
        const ada = await one("authors", 1, { posts: { orderBy: [["title", "desc"]] } });
        expect(titles(ada.posts)).toEqual(["third", "second", "first"]);
    });

    it("keeps the first rows of the declared order under a per-parent limit", async () => {
        const ada = await one("authors", 1, { posts: { limit: 2 } });
        expect(titles(ada.posts)).toEqual(["first", "second"]);
    });

    it("orders a nested listing the same way, unless the caller names an order", async () => {
        expect(titles(await list("authors/1/posts"))).toEqual(["first", "second", "third"]);
        expect(titles(await list("authors/1/posts", { orderBy: [["title", "asc"]] }))).toEqual(["first", "second", "third"]);
        expect(titles(await list("authors/1/posts", { orderBy: [["rank", "desc"]] }))).toEqual(["third", "second", "first"]);
    });

    it("pages a nested listing in the declared order", async () => {
        expect(titles(await list("authors/1/posts", { limit: 2, offset: 1 }))).toEqual(["second", "third"]);
    });
});

describe("a natural-key sourceKey", () => {
    it("reads a hasMany by the source column it names, not the id", async () => {
        const ada = await one("authors", 1, ["signed"]);
        expect(titles(ada.signed).sort()).toEqual(["first", "third"]);
        const bo = await one("authors", 2, ["signed"]);
        expect(titles(bo.signed)).toEqual(["second"]);
    });

    it("reads a hasOne by the source column it names", async () => {
        const ada = await one("authors", 1, ["profile"]);
        expect(ada.profile).toMatchObject({ bio: "Ada writes", authorHandle: "ada" });
        const bo = await one("authors", 2, ["profile"]);
        expect(bo.profile).toBeNull();
    });
});

describe("a belongsTo with constraint: false", () => {
    it("is planned without a foreign key, and read through an include", async () => {
        const constraints = await db.query<{ conname: string }>(
            "SELECT conname FROM pg_constraint WHERE conrelid = 'posts'::regclass AND contype = 'f'"
        );
        expect(constraints.rows.map(row => row.conname).some(name => name.includes("reviewer"))).toBe(false);

        const third = await one("posts", 1, ["reviewer"]);
        expect(third.reviewer).toMatchObject({ name: "Bo" });
        // A key that names no row reads as no row — which only a key without a
        // constraint can hold.
        const first = await one("posts", 2, ["reviewer"]);
        expect(first.reviewer).toBeNull();
    });
});

describe("a via relation", () => {
    it("reads every row the chain reaches from the parent", async () => {
        // Post 2 is Ada's and is linked to blue (seeded).
        const ada = await one("authors", 1, ["postTags"]);
        expect((ada.postTags as Record<string, unknown>[]).map(tag => tag.label)).toEqual(["blue"]);
        const bo = await one("authors", 2, ["postTags"]);
        expect(bo.postTags).toEqual([]);
    });
});

describe("rel.manyToMany({ pivot })", () => {
    it("writes `_pivot` with a membership and reads it back under each link", async () => {
        await driver.save({
            path: "posts",
            id: 1,
            values: { tags: [
                { id: 1, _pivot: { position: 2, role: "lead", weight: 1.5, addedAt: "2024-03-01T10:00:00.000Z" } },
                { id: 2, _pivot: { position: 1 } }
            ] },
            status: "existing"
        });

        const stored = await db.query<{ tag_id: number; position: number | null; role: string | null; weight: string | null; added_at: string | null }>(
            "SELECT tag_id, position, role, weight::text AS weight, to_char(added_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS added_at FROM post_tags WHERE post_id = 1 ORDER BY tag_id"
        );
        expect(stored.rows).toEqual([
            { tag_id: 1, position: 2, role: "lead", weight: "1.5", added_at: "2024-03-01 10:00" },
            { tag_id: 2, position: 1, role: null, weight: null, added_at: null }
        ]);

        const post = await one("posts", 1, ["tags"]);
        const links = (post.tags as Record<string, unknown>[]).map(tag => ({ label: tag.label, pivot: tag._pivot }));
        const sorted = links.sort((a, b) => String(a.label).localeCompare(String(b.label)));
        expect(sorted[0]).toEqual({ label: "green", pivot: { position: 1, role: null, weight: null, addedAt: null } });
        // REST-rendered like the target's own columns: a numeric as a number,
        // an instant as RFC 3339.
        const red = sorted[1].pivot as Record<string, unknown>;
        expect(red).toEqual({ position: 2, role: "lead", weight: 1.5, addedAt: "2024-03-01T10:00:00.000Z" });
    });



    it("refuses a `_pivot` key the relation does not declare", async () => {
        await expect(driver.save({
            path: "posts",
            id: 1,
            values: { tags: [{ id: 1, _pivot: { score: 3 } }] },
            status: "existing"
        })).rejects.toMatchObject({ code: "VALIDATION_UNKNOWN_FIELDS" });
    });

    // Last: the driver's pooled handle over PGlite is not used again after it.
    it("updates one link's pivot columns and tells the child list's subscribers", async () => {
        const notify = jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
        jest.spyOn(realtime, "isCdcActive").mockReturnValue(false);
        try {
            await driver.updateRelationPivot({ path: "posts/1/tags", targetId: 1, pivot: { role: "editor" } });
            expect(notify).toHaveBeenCalledTimes(1);
            expect(notify.mock.calls[0][0]).toBe("posts/1/tags");
            expect(notify.mock.calls[0][1]).toBe("1");
        } finally {
            jest.restoreAllMocks();
        }
        const stored = await db.query<{ position: number; role: string }>("SELECT position, role FROM post_tags WHERE post_id = 1 AND tag_id = 1");
        expect(stored.rows).toEqual([{ position: 2, role: "editor" }]);
    });
});
