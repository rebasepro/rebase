/**
 * The values a read hands back, family by family and relation kind by relation
 * kind, pinned against a real Postgres (PGlite) — the oracle of the "one read
 * shape" slice.
 *
 * Two consumers read rows in-process and must keep reading exactly these
 * values:
 *
 * - the in-process SDK (`buildSdkData(driver)` — `rebase.data`, a hook's
 *   `context.data`, the cloud control plane's backend): `find` / `findById`,
 *   with and without `include`;
 * - the wire: what REST and every socket frame serialise (`JSON.stringify` of
 *   the same row), which is what the admin panel builds its view model from in
 *   the browser (see `cms/test/tables/wire_row_view_model.test.ts`, which pins
 *   the view model of the very rows asserted here).
 *
 * And the driver's own read SPI (`fetchCollection` / `fetchOne`), which every
 * other in-process caller uses (the socket's one-shot frames, MCP, the RLS
 * simulator, plugins, user functions): the same rows, through the same walk.
 *
 * PGlite carries no pgvector, so a vector column is pinned at the codec level
 * (`row-pipeline` `toRestScalar` serves it as the driver returns it).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, json, rel } from "@rebasepro/types";
import { buildSdkData, compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { toRestScalar } from "../src/services/row-pipeline";
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
        doc: col.jsonb(json.object({ when: json.date(), n: json.number(), label: json.string() })),
        plain: col.json(),
        tags: col.text().array(),
        blob: col.bytea(),
        place: col.geopoint(),
        mood: col.enum(["happy", "sad"]),
        note: col.text()
    },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), label: col.text() },
    rls: "admin-only"
});

const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text(),
        joinedAt: col.timestamp({ withTimezone: true })
    },
    relations: {
        posts: rel.hasMany(() => posts),
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
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
        publishedAt: col.timestamp({ withTimezone: true })
    },
    relations: {
        author: rel.belongsTo(() => authors),
        tags: rel.manyToMany(() => tags, { through: "post_tags", sourceKey: "post_id", targetKey: "tag_id" })
    },
    rls: "admin-only"
});

const profiles = defineTable("profiles", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), bio: col.text(), authorId: col.integer() },
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
    const compiled = compileSchema([samples, tags, authors, posts, profiles]);
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
        INSERT INTO samples (day, at, clock, price, big, count, doc, plain, tags, blob, place, mood, note) VALUES (
            '2026-03-04', '2026-08-24 01:37:57.647+02', '09:30:00', 9.99, 9007199254740991, 42,
            '{"when": "2026-01-02T03:04:05.000Z", "n": "7", "label": "x", "extra": true}',
            '{"a": [1, 2]}', ARRAY['red', 'green'], '\\x00ff10', '{"latitude": 41.4, "longitude": 2.17}',
            'happy', 'hello'
        );
        INSERT INTO samples (note) VALUES (NULL);
        INSERT INTO authors (name, joined_at) VALUES ('Ada', '2020-01-02 04:04:05+01'), ('Bo', NULL);
        INSERT INTO tags (label) VALUES ('red'), ('green');
        INSERT INTO posts (title, published_at, author_id) VALUES ('first', '2026-05-06 07:08:09+00', 1), ('second', NULL, 1);
        INSERT INTO profiles (bio, author_id) VALUES ('Ada writes', 1);
        INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1), (1, 2);
    `);
});

afterAll(async () => {
    await db.close();
});

/** What the wire carries for a row: its JSON. */
const wire = (row: unknown): unknown => JSON.parse(JSON.stringify(row));

const BLOB = Buffer.from([0x00, 0xff, 0x10]);

/** The first sample row, as every in-process read serves it today. */
const SAMPLE = {
    id: 1,
    day: "2026-03-04",
    at: "2026-08-23T23:37:57.647Z",
    clock: "09:30:00",
    price: 9.99,
    big: 9007199254740991,
    count: 42,
    doc: { when: "2026-01-02T03:04:05.000Z", n: "7", label: "x", extra: true },
    plain: { a: [1, 2] },
    tags: ["red", "green"],
    blob: BLOB,
    place: { latitude: 41.4, longitude: 2.17 },
    mood: "happy",
    note: "hello"
};

/** The same row on the wire. */
const SAMPLE_WIRE = { ...SAMPLE, blob: { type: "Buffer", data: [0, 255, 16] } };

/** An all-null row: every column present, as `null`. */
const EMPTY = {
    id: 2, day: null, at: null, clock: null, price: null, big: null, count: null, doc: null, plain: null,
    tags: null, blob: null, place: null, mood: null, note: null
};

describe("in-process SDK values (buildSdkData)", () => {
    const sdk = () => buildSdkData(driver);

    it("find: every value family as the read serves it", async () => {
        const { data } = await sdk().table("samples").find({ orderBy: [["id", "asc"]] });
        expect(data).toEqual([SAMPLE, EMPTY]);
        expect(Buffer.isBuffer(data[0].blob)).toBe(true);
    });

    it("findById: the same row", async () => {
        expect(await sdk().table("samples").findById(1)).toEqual(SAMPLE);
    });

    it("the wire is the JSON of the same row", async () => {
        const { data } = await sdk().table("samples").find({ orderBy: [["id", "asc"]] });
        expect(wire(data)).toEqual([SAMPLE_WIRE, EMPTY]);
    });

    it("a vector is served as the driver returns it", () => {
        const column = { key: "embedding", column: "embedding", type: { kind: "vector", dimensions: 3 }, nullable: true } as const;
        expect(toRestScalar([0.1, 0.2], column)).toEqual([0.1, 0.2]);
        expect(toRestScalar("[0.1,0.2]", column)).toBe("[0.1,0.2]");
    });

    it("belongsTo: the foreign key, and the target's columns when included", async () => {
        const plain = await sdk().table("posts").findById(1);
        expect(plain).toEqual({ id: 1, title: "first", publishedAt: "2026-05-06T07:08:09.000Z", authorId: 1 });
        const included = await sdk().table("posts").findById(1, { include: ["author"] });
        expect(included).toEqual({
            id: 1, title: "first", publishedAt: "2026-05-06T07:08:09.000Z", authorId: 1,
            author: { id: 1, name: "Ada", joinedAt: "2020-01-02T03:04:05.000Z" }
        });
    });

    it("hasMany, hasOne and via: absent unless included", async () => {
        const plain = await sdk().table("authors").findById(1);
        expect(plain).toEqual({ id: 1, name: "Ada", joinedAt: "2020-01-02T03:04:05.000Z" });
        const included = await sdk().table("authors").findById(1, { include: ["posts", "profile", "postTags"] });
        expect(included).toEqual({
            id: 1, name: "Ada", joinedAt: "2020-01-02T03:04:05.000Z",
            posts: [
                { id: 1, title: "first", publishedAt: "2026-05-06T07:08:09.000Z", authorId: 1 },
                { id: 2, title: "second", publishedAt: null, authorId: 1 }
            ],
            profile: { id: 1, bio: "Ada writes", authorId: 1 },
            postTags: [{ id: 1, label: "red" }, { id: 2, label: "green" }]
        });
    });

    it("manyToMany: absent unless included, then the targets' columns", async () => {
        const { data } = await sdk().table("posts").find({ orderBy: [["id", "asc"]], include: ["tags"] });
        expect(data).toEqual([
            { id: 1, title: "first", publishedAt: "2026-05-06T07:08:09.000Z", authorId: 1, tags: [{ id: 1, label: "red" }, { id: 2, label: "green" }] },
            { id: 2, title: "second", publishedAt: null, authorId: 1, tags: [] }
        ]);
        const plain = await sdk().table("posts").find({ orderBy: [["id", "asc"]] });
        expect(plain.data.map(row => Object.keys(row).sort())).toEqual([
            ["authorId", "id", "publishedAt", "title"], ["authorId", "id", "publishedAt", "title"]
        ]);
    });

    it("an author with nothing related: an empty list, a null hasOne", async () => {
        const included = await sdk().table("authors").findById(2, { include: ["posts", "profile", "postTags"] });
        expect(included).toEqual({ id: 2, name: "Bo", joinedAt: null, posts: [], profile: null, postTags: [] });
    });
});
