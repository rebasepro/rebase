/**
 * Hooks authored with `defineTable`, run natively by the driver.
 *
 * Every hook here is a `TableHooks` hook or a column's `.transform()`, read by
 * the driver off the compiled table in its registry and called with its real
 * props — `table` is the descriptor, `values` the row. Nothing is lifted from
 * or lowered to a legacy collection callback on the way.
 *
 * - all seven table hooks, in order, with their props;
 * - global hooks (`registry.setGlobalHooks`) before the table's, the table's
 *   before its columns';
 * - a column's `.transform({ beforeSave, afterRead })`, and transforms nested
 *   in a JSON document — a `json.object` field, each `json.array` item, the
 *   value of a `json.oneOf` variant — running at request time on the write and
 *   on every read;
 * - PII masked through an `include`: the TARGET table's `afterRead`, on the
 *   REST/SDK fetch, the driver's own fetch, and a realtime frame;
 * - `beforeQuery` narrowing a read; `beforeDelete` refusing a delete; an
 *   aggregate refused where a transform masks a column.
 *
 * A real driver over PGlite, scoped with `withAuth` where a caller reads.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, jsonb, pgTable, serial, text } from "drizzle-orm/pg-core";
import { col, defineTable, json, rel, type TableDescriptor, type TableHooks } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { buildTableRegistry } from "../src/model/build-registry";
import type { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { testUser } from "./helpers/spg-b-fixtures";

const maskEmail = (email: unknown): unknown => {
    if (typeof email !== "string") return email;
    const [local, domain] = email.split("@");
    return local && domain ? `${local[0]}***@${domain}` : email;
};

/** What every hook saw, in the order it ran. */
let log: unknown[] = [];

const authors = defineTable("authors", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.text(),
        email: col.text()
    },
    relations: {
        posts: rel.hasMany(() => posts, { foreignKey: "author_id" })
    },
    hooks: {
        afterRead: ({ values }) => ({ ...values, email: maskEmail(values.email) })
    },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.serial().primaryKey(),
        title: col.text(),
        // A column transform: shapes the value on the way in and on the way out.
        // Like every field-level hook, it runs for a key the row carries.
        slug: col.text().transform({
            beforeSave: ({ value, values }) => {
                log.push(["slug.beforeSave", value, values.title]);
                return value === null || value === undefined ? value : value.toLowerCase().replace(/\s+/g, "-");
            },
            afterRead: ({ value }) => {
                log.push(["slug.afterRead", value]);
                return value === null || value === undefined ? value : `/${value}`;
            }
        }),
        authorId: col.integer("author_id"),
        meta: col.jsonb(json.object({
            seo: json.object({
                // Two levels down in a document.
                token: json.string().transform({
                    beforeSave: ({ value }) => (value === undefined ? value : `enc:${value}`),
                    afterRead: ({ value }) => (value === undefined ? value : "***")
                })
            }),
            // Each item of an array.
            tags: json.array(json.string().transform({
                beforeSave: ({ value }) => value?.toLowerCase(),
                afterRead: ({ value }) => (value === undefined ? value : `#${value}`)
            }))
        })),
        // The value of one variant of a typed block, inside an array.
        blocks: col.jsonb(json.array(json.oneOf({
            text: json.string(),
            secret: json.string().transform({
                beforeSave: ({ value }) => (value === undefined ? value : value.split("").reverse().join("")),
                afterRead: ({ value }) => (value === undefined ? value : "[redacted]")
            })
        })))
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id" })
    },
    hooks: {
        beforeQuery: ({ table, operation }) => {
            log.push(["posts.beforeQuery", table.slug, operation]);
            return { filter: { title: ["!=", "hidden"] } };
        },
        afterRead: ({ table, values }) => {
            log.push(["posts.afterRead", table.slug, values.slug]);
            // A global hook may have marked the row first.
            const before = "readBy" in values ? String(values.readBy) : "";
            return { ...values, readBy: `${before}table` };
        },
        beforeSave: ({ table, values, status }) => {
            log.push(["posts.beforeSave", table.slug, status, values.slug]);
            return { ...values, title: String(values.title).trim() };
        },
        afterSave: ({ table, id, values, status }) => {
            log.push(["posts.afterSave", table.slug, typeof id, status, values.title]);
        },
        afterSaveError: ({ table, error }) => {
            log.push(["posts.afterSaveError", table.slug, error instanceof Error]);
        },
        beforeDelete: ({ table, values }) => {
            log.push(["posts.beforeDelete", table.slug, values.title]);
            return values.title === "keep" ? false : undefined;
        },
        afterDelete: ({ table, values }) => {
            log.push(["posts.afterDelete", table.slug, values.title]);
        }
    },
    rls: "admin-only"
});

const authorsPg = pgTable("authors", { id: serial("id").primaryKey(), name: text("name"), email: text("email") });
const postsPg = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: text("title"),
    slug: text("slug"),
    authorId: integer("author_id"),
    meta: jsonb("meta"),
    blocks: jsonb("blocks")
});

let db: PGlite;
let registry: PostgresTableRegistry;
let realtime: RealtimeService;
let driver: PostgresBackendDriver;

const ADMIN = testUser({ uid: "u1", roles: ["admin"] });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const stored = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

beforeEach(async () => {
    log = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE authors (id serial PRIMARY KEY, name text, email text);
        CREATE TABLE posts (id serial PRIMARY KEY, title text, slug text, author_id integer, meta jsonb, blocks jsonb);
        INSERT INTO authors (name, email) VALUES ('Sam', 'sam@acme.com');
        INSERT INTO posts (title, slug, author_id) VALUES ('Hello', 'hello', 1), ('hidden', 'hidden', 1), ('keep', 'keep', 1);
    `);
    const defs = [authors, posts];
    registry = buildTableRegistry({
        compiledTables: compileSchema(defs),
        tables: { authors: authorsPg, posts: postsPg }
    });
    const orm = drizzle(db, { schema: { authors: authorsPg, posts: postsPg } });
    realtime = new RealtimeService(orm, registry);
    driver = new PostgresBackendDriver(orm, realtime, registry);
    realtime.setDataDriver(driver);
});

afterEach(async () => {
    await realtime.destroy();
    await db.close();
});

describe("a table's seven hooks", () => {
    it("run on a create, with the descriptor as `table`, in order", async () => {
        const saved = await driver.save({ path: "posts", status: "new", values: { title: "  Big News ", slug: "Big News", authorId: 1 } });

        expect(log.filter(entry => Array.isArray(entry) && entry[0] !== "posts.beforeQuery")).toEqual([
            ["posts.beforeSave", "posts", "new", "Big News"],
            // The column's transform runs after the table's hook, on the values it returned.
            ["slug.beforeSave", "Big News", "Big News"],
            ["posts.afterRead", "posts", "big-news"],
            ["slug.afterRead", "big-news"],
            ["posts.afterSave", "posts", "string", "new", "Big News"]
        ]);
        // The response is the caller's view: through afterRead.
        expect(saved).toMatchObject({ title: "Big News", slug: "/big-news", readBy: "table" });
        // The table holds what the write hooks wrote, not the view.
        expect(await stored("SELECT title, slug FROM posts WHERE title = 'Big News'")).toEqual([{ title: "Big News", slug: "big-news" }]);
    });

    it("run afterSaveError when the write fails", async () => {
        registry.setTableHooks("posts", {
            ...posts.config.hooks,
            beforeSave: ({ values }) => ({ ...values, authorId: "not a number" })
        });
        await expect(driver.save({ path: "posts", status: "new", values: { title: "x" } })).rejects.toBeDefined();
        expect(log).toContainEqual(["posts.afterSaveError", "posts", true]);
    });

    it("narrow every read with beforeQuery", async () => {
        const rows = await driver.fetchCollection({ path: "posts" });
        expect(rows.map(row => row.title)).toEqual(expect.arrayContaining(["Hello", "keep"]));
        expect(rows.map(row => row.title)).not.toContain("hidden");
        expect(log).toContainEqual(["posts.beforeQuery", "posts", "list"]);
        const scoped = await driver.withAuth(ADMIN);
        expect(await scoped.count!({ path: "posts" })).toBe(2);
    });

    it("refuse a delete beforeDelete vetoes, and run afterDelete on one it allows", async () => {
        const [keep] = await stored("SELECT id FROM posts WHERE title = 'keep'");
        await expect(driver.delete({ row: { id: Number(keep.id), path: "posts" } })).rejects.toMatchObject({ code: "CALLBACK_REJECTED" });
        expect(await stored("SELECT title FROM posts WHERE title = 'keep'")).toHaveLength(1);

        const [hello] = await stored("SELECT id FROM posts WHERE title = 'Hello'");
        await driver.delete({ row: { id: Number(hello.id), path: "posts" } });
        expect(log).toContainEqual(["posts.beforeDelete", "posts", "Hello"]);
        expect(log).toContainEqual(["posts.afterDelete", "posts", "Hello"]);
        expect(await stored("SELECT title FROM posts WHERE title = 'Hello'")).toHaveLength(0);
    });
});

describe("global hooks", () => {
    it("run before the table's own, and the table's before its columns'", async () => {
        const seen: TableDescriptor[] = [];
        const global: TableHooks = {
            afterRead: ({ table, values }) => {
                seen.push(table);
                log.push(["global.afterRead", values.slug]);
                return { ...values, readBy: "global>" };
            }
        };
        registry.setGlobalHooks(global);

        const [row] = await driver.fetchCollection({ path: "posts", filter: { title: ["==", "Hello"] } });

        expect(log.filter(entry => Array.isArray(entry) && String(entry[0]).endsWith("afterRead"))).toEqual([
            ["global.afterRead", "hello"],
            ["posts.afterRead", "posts", "hello"],
            ["slug.afterRead", "hello"]
        ]);
        expect(row.readBy).toBe("global>table");
        expect(row.slug).toBe("/hello");
        expect(seen.map(table => table.slug)).toEqual(["posts"]);
    });
});

describe("nested JSON transforms", () => {
    const document = {
        title: "Doc",
        meta: { seo: { token: "abc" }, tags: ["News", "TECH"] },
        blocks: [{ type: "text", value: "plain" }, { type: "secret", value: "hush" }]
    };

    it("run on the write, at every depth", async () => {
        await driver.save({ path: "posts", status: "new", values: document });
        const [row] = await stored("SELECT meta, blocks FROM posts WHERE title = 'Doc'");
        expect(row.meta).toEqual({ seo: { token: "enc:abc" }, tags: ["news", "tech"] });
        expect(row.blocks).toEqual([{ type: "text", value: "plain" }, { type: "secret", value: "hsuh" }]);
    });

    it("run on every read: the driver's, REST/SDK's and a caller's", async () => {
        await driver.save({ path: "posts", status: "new", values: document });
        const expected = {
            meta: { seo: { token: "***" }, tags: ["#news", "#tech"] },
            blocks: [{ type: "text", value: "plain" }, { type: "secret", value: "[redacted]" }]
        };
        const [own] = await driver.fetchCollection({ path: "posts", filter: { title: ["==", "Doc"] } });
        expect(own).toMatchObject(expected);
        const [rest] = await driver.restFetchService.fetchCollectionForRest("posts", { filter: { title: ["==", "Doc"] } });
        expect(rest).toMatchObject(expected);
        const scoped = await driver.withAuth(ADMIN);
        const [asCaller] = await scoped.fetchCollection({ path: "posts", filter: { title: ["==", "Doc"] } });
        expect(asCaller).toMatchObject(expected);
        const one = await scoped.restFetchService!.fetchOneForRest("posts", String(own.id));
        expect(one).toMatchObject(expected);
    });

    it("refuse an aggregate that would read the masked values", async () => {
        await expect(driver.restFetchService.aggregate!("posts", { aggregates: [{ fn: "count", field: "slug", alias: "n" }] }))
            .rejects.toMatchObject({ code: "AGGREGATE_MASKED_BY_AFTER_READ" });
    });
});

describe("the other read doors", () => {
    it("run afterRead on a nested path, with the addressed table's hooks", async () => {
        const rows = await driver.restFetchService.fetchCollectionForRest("authors/1/posts", {});
        expect(rows.map(row => row.slug)).toEqual(expect.arrayContaining(["/hello", "/keep"]));
        expect(rows.every(row => row.readBy === "table")).toBe(true);
    });

    it("run afterRead on a search", async () => {
        const rows = await driver.restFetchService.fetchCollectionForRest("posts", { searchString: "Hello" });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ slug: "/hello", readBy: "table" });
    });
});

describe("PII through an include", () => {
    it("is masked by the TARGET table's afterRead on the REST/SDK path", async () => {
        const [row] = await driver.restFetchService.fetchCollectionForRest("posts", { filter: { title: ["==", "Hello"] } }, ["author"]);
        expect(row.author).toMatchObject({ name: "Sam", email: "s***@acme.com" });
    });

    it("is masked for a caller, and on a single read", async () => {
        const scoped = await driver.withAuth(ADMIN);
        const [row] = await scoped.restFetchService!.fetchCollectionForRest("posts", { filter: { title: ["==", "Hello"] } }, ["author"]);
        expect(row.author).toMatchObject({ email: "s***@acme.com" });
        const one = await scoped.restFetchService!.fetchOneForRest("posts", String(row.id), ["author"]);
        expect(one?.author).toMatchObject({ email: "s***@acme.com" });
    });

    it("is masked inside an included row on the driver's own read (`fetchOne`)", async () => {
        // The driver's SPI serves the REST row: the target's own row under the
        // relation's name, masked by the target's hook.
        const row = await driver.fetchOne({ path: "posts", id: "1", include: ["author"] });
        expect(row?.author).toMatchObject({ name: "Sam", email: "s***@acme.com" });
        expect(row?.author).not.toHaveProperty("__type");
    });

    it("is masked in a realtime frame, the first and every refetch", async () => {
        const scoped = await driver.withAuth(ADMIN);
        const [hello] = await stored("SELECT id FROM posts WHERE title = 'Hello'");
        const frames: (Record<string, unknown> | null)[] = [];
        const unsubscribe = scoped.listenOne!({
            path: "posts", id: String(hello.id), include: ["author"],
            onUpdate: (row) => frames.push(row)
        });
        await wait(150);
        await realtime.notifyUpdate("posts", String(hello.id), { _rebase_invalidated: true });
        await wait(300);
        unsubscribe();

        expect(frames.length).toBeGreaterThanOrEqual(2);
        for (const frame of frames) {
            expect(frame?.author).toMatchObject({ email: "s***@acme.com" });
            expect(frame?.slug).toBe("/hello");
        }
    });

    it("is masked in a realtime collection frame", async () => {
        const scoped = await driver.withAuth(ADMIN);
        const frames: Record<string, unknown>[][] = [];
        const unsubscribe = scoped.listenCollection!({
            path: "posts", include: ["author"], filter: { title: ["==", "Hello"] },
            onUpdate: (rows) => frames.push(rows)
        });
        await wait(150);
        unsubscribe();

        expect(frames.length).toBeGreaterThanOrEqual(1);
        expect(frames[0][0]?.author).toMatchObject({ email: "s***@acme.com" });
    });
});
