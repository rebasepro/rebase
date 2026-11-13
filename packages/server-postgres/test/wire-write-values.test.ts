/**
 * What a write stores, family by family and relation kind by relation kind,
 * pinned against a real Postgres (PGlite) — the write twin of
 * `wire-read-values.test.ts`, and the oracle of the "one write shape" slice.
 *
 * Every write door of the backend (REST, the socket, MCP, bulk, nested paths,
 * history reverts) hands the driver the request body as JSON parsed it; the
 * in-process SDK (`buildSdkData(driver)` — `rebase.data`, a hook's
 * `context.data`) hands it the caller's object, which may hold a `Date` or a
 * `Buffer`. Both are pinned here by the row Postgres holds afterwards
 * (`to_jsonb` of it), so a change to how a value is accepted cannot change
 * what is stored.
 *
 * The admin panel's view model (an `EntityRelation`, a `Vector`, a `GeoPoint`,
 * a `Date`) is converted to these wire values in the browser before it is
 * sent (`cms-types` `collection_view_model.ts`, pinned by its own test), so
 * no shape of it is accepted here.
 *
 * PGlite carries no pgvector, so a vector column is pinned at the codec level
 * (`serializeColumnToServer`).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, json, rel, type ColumnDescriptor } from "@rebasepro/types";
import { buildSdkData, compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { serializeColumnToServer } from "../src/data-transformer";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const samples = defineTable("samples", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        day: col.date(),
        at: col.timestamp({ withTimezone: true }),
        clock: col.time(),
        price: col.numeric({ precision: 10, scale: 2 }),
        big: col.bigint({ mode: "number" }),
        count: col.integer(),
        doc: col.jsonb(json.object({ when: json.date(), n: json.number(), spot: json.geopoint() })),
        plain: col.json(),
        tags: col.text().array(),
        days: col.date().array(),
        stamps: col.timestamp({ withTimezone: true }).array(),
        blob: col.bytea(),
        place: col.geopoint(),
        mood: col.enum(["happy", "sad"]),
        hero: col.storage({ path: "samples/heroes/" }),
        note: col.text()
    },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), label: col.text() },
    rls: "admin-only"
});

const authors = defineTable("authors", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), name: col.text() },
    relations: {
        posts: rel.hasMany(() => posts),
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
        card: rel.via(() => cards, { cardinality: "one", steps: [{ table: "cards", on: { from: "id", to: "author_id" } }] })
    },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), title: col.text() },
    relations: {
        author: rel.belongsTo(() => authors),
        tags: rel.manyToMany(() => tags, {
            through: "post_tags", sourceKey: "post_id", targetKey: "tag_id",
            pivot: { weight: col.integer().default(1) }
        }),
        labels: rel.via(() => tags, {
            steps: [
                { table: "post_labels", on: { from: "id", to: "post_id" } },
                { table: "tags", on: { from: "tag_id", to: "id" } }
            ]
        })
    },
    rls: "admin-only"
});

const postLabels = defineTable("post_labels", {
    columns: { postId: col.integer().primaryKey(), tagId: col.integer().primaryKey() },
    rls: "admin-only"
});

const profiles = defineTable("profiles", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), bio: col.text(), authorId: col.integer() },
    rls: "admin-only"
});

const cards = defineTable("cards", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), motto: col.text(), authorId: col.integer() },
    rls: "admin-only"
});

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    // Stored timestamps are rendered in the session's zone; pinned to UTC.
    await db.exec("SET TIME ZONE 'UTC'");
    const compiled = compileSchema([samples, tags, authors, posts, postLabels, profiles, cards]);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    const registry = new PostgresTableRegistry();
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    await db.exec(`
        INSERT INTO authors (name) VALUES ('Ada'), ('Bo');
        INSERT INTO tags (label) VALUES ('red'), ('green'), ('blue');
        INSERT INTO profiles (bio) VALUES ('first'), ('second');
        INSERT INTO cards (motto) VALUES ('onward');
    `);
});

afterAll(async () => {
    await db.close();
});

/** A request body as every HTTP / socket / MCP door hands it to the driver. */
const wire = <T>(value: T): Record<string, unknown> => JSON.parse(JSON.stringify(value));

/** A write through a wire door: the body as JSON parsed it. */
async function restWrite(path: string, values: Record<string, unknown>, id?: number): Promise<number> {
    const saved = await driver.save({ path, values: wire(values), id, status: id === undefined ? "new" : "existing" });
    return Number(saved.id);
}

/** A write through the in-process SDK: the caller's object as it is. */
async function sdkCreate(slug: string, values: Record<string, unknown>): Promise<number> {
    const saved = await buildSdkData(driver).table(slug).create(values);
    return Number(saved.id);
}

/** The row Postgres holds, as `to_jsonb` renders it. */
async function storedRow(table: string, id: number): Promise<Record<string, unknown>> {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(`SELECT to_jsonb(t) AS r FROM ${table} t WHERE id = $1`, [id]);
    const { id: _id, ...rest } = rows[0].r;
    return rest;
}

async function storedRows(statement: string, values: unknown[] = []): Promise<unknown[]> {
    return (await db.query(statement, values)).rows;
}

/** One sample row, in the documented REST shapes. */
const REST_SAMPLE = {
    day: "2026-03-04",
    at: "2026-08-23T23:37:57.647Z",
    clock: "09:30:00",
    price: 9.99,
    big: 9007199254740991,
    count: 42,
    doc: { when: "2026-01-02T03:04:05.000Z", n: 7, spot: { latitude: 1.5, longitude: 2.5 } },
    plain: { a: [1, 2], nested: { __type: "relation", id: 9 } },
    tags: ["red", "green"],
    days: ["2026-01-02", null],
    stamps: ["2026-01-02T10:00:00.000Z"],
    blob: "data:application/octet-stream;base64,AP8Q",
    place: { latitude: 41.4, longitude: 2.17 },
    mood: "happy",
    hero: "samples/heroes/a.png",
    note: "hello"
};

/** What Postgres holds for it. */
const STORED_SAMPLE = {
    day: "2026-03-04",
    at: "2026-08-23T23:37:57.647+00:00",
    clock: "09:30:00",
    price: 9.99,
    big: 9007199254740991,
    count: 42,
    doc: { when: "2026-01-02T03:04:05.000Z", n: 7, spot: { latitude: 1.5, longitude: 2.5 } },
    // A JSON document is stored as sent, whatever keys it holds.
    plain: { a: [1, 2], nested: { __type: "relation", id: 9 } },
    tags: ["red", "green"],
    days: ["2026-01-02", null],
    stamps: ["2026-01-02T10:00:00+00:00"],
    blob: "\\x00ff10",
    place: { latitude: 41.4, longitude: 2.17 },
    mood: "happy",
    hero: "samples/heroes/a.png",
    note: "hello"
};

describe("value families: what a write stores", () => {
    it("REST: every family in its documented shape", async () => {
        const id = await restWrite("samples", REST_SAMPLE);
        expect(await storedRow("samples", id)).toEqual(STORED_SAMPLE);
    });

    it("in-process SDK: the same values, temporal ones as `Date` and bytes as a `Buffer`", async () => {
        const id = await sdkCreate("samples", {
            ...REST_SAMPLE,
            at: new Date("2026-08-23T23:37:57.647Z"),
            stamps: [new Date("2026-01-02T10:00:00.000Z")],
            doc: { ...REST_SAMPLE.doc, when: new Date("2026-01-02T03:04:05.000Z") },
            blob: Buffer.from([0x00, 0xff, 0x10])
        });
        expect(await storedRow("samples", id)).toEqual(STORED_SAMPLE);
    });

    it("in-process SDK: the documented strings too", async () => {
        const id = await sdkCreate("samples", REST_SAMPLE);
        expect(await storedRow("samples", id)).toEqual(STORED_SAMPLE);
    });

    it("an update stores the same values as a create", async () => {
        const id = await restWrite("samples", { note: "blank" });
        await restWrite("samples", REST_SAMPLE, id);
        expect(await storedRow("samples", id)).toEqual(STORED_SAMPLE);
    });

    it("a date given as a `Date` on a date and a time column", async () => {
        const id = await sdkCreate("samples", { day: new Date("2026-03-04T00:00:00.000Z"), clock: new Date("2026-03-04T09:30:00.000Z") });
        const row = await storedRow("samples", id);
        expect(row.day).toBe("2026-03-04");
        expect(row.clock).toBe("09:30:00");
    });

    it("null clears every family", async () => {
        const id = await restWrite("samples", REST_SAMPLE);
        const nulls = Object.fromEntries(Object.keys(REST_SAMPLE).map(key => [key, null]));
        await restWrite("samples", nulls, id);
        expect(await storedRow("samples", id)).toEqual(nulls);
    });

    it("a vector: a list of numbers", () => {
        const column: ColumnDescriptor = { key: "embedding", column: "embedding", type: { kind: "vector", dimensions: 2 }, nullable: true };
        expect(serializeColumnToServer([0.5, 1], column)).toEqual([0.5, 1]);
        expect(serializeColumnToServer(["0.5", "1"], column)).toEqual([0.5, 1]);
    });
});

describe("relations: what a write stores", () => {
    it("belongsTo: the key under the relation's name or the foreign key's", async () => {
        const byRelation = await restWrite("posts", { title: "a", author: 1 });
        const byKey = await restWrite("posts", { title: "b", authorId: 2 });
        const bySdk = await sdkCreate("posts", { title: "c", author: 1 });
        expect(await storedRow("posts", byRelation)).toEqual({ title: "a", author_id: 1 });
        expect(await storedRow("posts", byKey)).toEqual({ title: "b", author_id: 2 });
        expect(await storedRow("posts", bySdk)).toEqual({ title: "c", author_id: 1 });
    });

    it("belongsTo: null and the empty string unlink", async () => {
        const id = await restWrite("posts", { title: "d", author: 1 });
        await restWrite("posts", { author: null }, id);
        expect(await storedRow("posts", id)).toEqual({ title: "d", author_id: null });
        await restWrite("posts", { author: 2 }, id);
        await restWrite("posts", { authorId: "" }, id);
        expect(await storedRow("posts", id)).toEqual({ title: "d", author_id: null });
    });

    it("hasOne: the target's key, or null to unlink", async () => {
        await restWrite("authors", { profile: 1 }, 1);
        expect(await storedRows("SELECT id, author_id FROM profiles ORDER BY id")).toEqual([
            { id: 1, author_id: 1 }, { id: 2, author_id: null }
        ]);
        await restWrite("authors", { profile: null }, 1);
        expect(await storedRows("SELECT id, author_id FROM profiles ORDER BY id")).toEqual([
            { id: 1, author_id: null }, { id: 2, author_id: null }
        ]);
    });

    it("a one-step to-one via: the target's key", async () => {
        await restWrite("authors", { card: 1 }, 2);
        expect(await storedRows("SELECT id, author_id FROM cards")).toEqual([{ id: 1, author_id: 2 }]);
    });

    it("hasMany: the list of the targets' keys", async () => {
        const first = await restWrite("posts", { title: "e" });
        const second = await restWrite("posts", { title: "f" });
        await restWrite("authors", { posts: [first, second] }, 2);
        expect(await storedRows("SELECT id, author_id FROM posts WHERE id = ANY($1) ORDER BY id", [[first, second]])).toEqual([
            { id: first, author_id: 2 }, { id: second, author_id: 2 }
        ]);
        await restWrite("authors", { posts: [{ id: second }] }, 2);
        expect(await storedRows("SELECT id, author_id FROM posts WHERE id = ANY($1) ORDER BY id", [[first, second]])).toEqual([
            { id: first, author_id: null }, { id: second, author_id: 2 }
        ]);
    });

    it("manyToMany: keys and `{ id, _pivot }` objects; a bare key keeps the link's pivot", async () => {
        const id = await restWrite("posts", { title: "g", tags: [1, { id: 2, _pivot: { weight: 5 } }] });
        expect(await storedRows("SELECT tag_id, weight FROM post_tags WHERE post_id = $1 ORDER BY tag_id", [id])).toEqual([
            { tag_id: 1, weight: 1 }, { tag_id: 2, weight: 5 }
        ]);
        await restWrite("posts", { tags: [2, 3] }, id);
        expect(await storedRows("SELECT tag_id, weight FROM post_tags WHERE post_id = $1 ORDER BY tag_id", [id])).toEqual([
            { tag_id: 2, weight: 5 }, { tag_id: 3, weight: 1 }
        ]);
    });

    it("manyToMany through the in-process SDK: the same rows", async () => {
        const id = await sdkCreate("posts", { title: "h", tags: [1, { id: 2, _pivot: { weight: 5 } }] });
        expect(await storedRows("SELECT tag_id, weight FROM post_tags WHERE post_id = $1 ORDER BY tag_id", [id])).toEqual([
            { tag_id: 1, weight: 1 }, { tag_id: 2, weight: 5 }
        ]);
    });

    it("a `_pivot` edit through the relation route", async () => {
        const id = await restWrite("posts", { title: "i", tags: [1] });
        await driver.updateRelationPivot({ path: `posts/${id}/tags`, targetId: 1, pivot: wire({ weight: 9 }) });
        expect(await storedRows("SELECT tag_id, weight FROM post_tags WHERE post_id = $1", [id])).toEqual([{ tag_id: 1, weight: 9 }]);
    });

    it("a two-step to-many via: the list of the targets' keys", async () => {
        const id = await restWrite("posts", { title: "j", labels: [1, { id: 3 }] });
        expect(await storedRows("SELECT tag_id FROM post_labels WHERE post_id = $1 ORDER BY tag_id", [id])).toEqual([
            { tag_id: 1 }, { tag_id: 3 }
        ]);
    });

    it("a nested create: the parent's key set from the path", async () => {
        const saved = await driver.save({ path: "authors/1/posts", values: wire({ title: "k" }), status: "new" });
        expect(await storedRow("posts", Number(saved.id))).toEqual({ title: "k", author_id: 1 });
    });
});

/**
 * What the admin panel sent before it converted its view model in the browser
 * — the JSON of an `EntityRelation` (`{ __type: "relation", id, path, data }`)
 * and of a `Vector` (`{ value }`) — is not the wire, and is refused rather
 * than stored. A membership element is read for its `id` and `_pivot` alone,
 * so a relation ref there is the documented `{ id }` object with extra keys.
 */
describe("the admin's view-model JSON is not accepted", () => {
    const ref = (id: number, path: string) => ({ __type: "relation", id, path, data: { id, path, values: { id } } });

    it("a to-one relation as an object is a 400 that says to write the key", async () => {
        await expect(restWrite("posts", { title: "vm", author: ref(2, "authors") }))
            .rejects.toThrow("'posts.author' links one 'authors' row: write that row's key (a string or a number), or null to unlink — not an object.");
        await expect(restWrite("posts", { title: "vm", author: { id: 2 } })).rejects.toThrow("not an object");
        await expect(restWrite("authors", { profile: { id: 1 } }, 1)).rejects.toThrow("'authors.profile' links one 'profiles' row");
        await expect(restWrite("authors", { card: [1] }, 1)).rejects.toThrow("'authors.card' links one 'cards' row");
        expect(await storedRows("SELECT count(*)::int AS n FROM posts WHERE title = 'vm'")).toEqual([{ n: 0 }]);
    });

    it("a membership element is read for its id", async () => {
        const id = await restWrite("posts", { title: "vm2", tags: [ref(1, "tags"), ref(3, "tags")] });
        expect(await storedRows("SELECT tag_id FROM post_tags WHERE post_id = $1 ORDER BY tag_id", [id])).toEqual([
            { tag_id: 1 }, { tag_id: 3 }
        ]);
    });

    it("a vector as `{ value }` is a 400", () => {
        const column: ColumnDescriptor = { key: "embedding", column: "embedding", type: { kind: "vector", dimensions: 2 }, nullable: true };
        expect(() => serializeColumnToServer({ value: [0.5, 1] }, column)).toThrow("'embedding' expects a vector as a list of numbers");
    });
});
