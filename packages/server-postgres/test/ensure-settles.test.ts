/**
 * A second boot against an unchanged database plans nothing.
 *
 * The boot ensure is additive and idempotent, and "idempotent" used to be the
 * whole of its contract: every helper function was `CREATE OR REPLACE`d and
 * every index `CREATE INDEX CONCURRENTLY IF NOT EXISTS`'d on every boot, and
 * Postgres was left to decide that nothing needed doing. The example app logged
 * "Applied 7 additive schema change(s)" on every one of 14 restarts — three
 * function rewrites (each one a `pg_proc` row rewritten and every cached plan
 * that calls it invalidated, on every replica) and four index statements that
 * each took a table lock just to find the name taken.
 *
 * So the contract is now the stronger one: the second ensure reads the
 * catalogue and plans zero actions. A function whose body or attributes
 * drifted, or an index that was dropped by hand, is still planned — see the
 * last two tests.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables, type Queryable } from "../src/schema/ensure-collection-tables";

const authors = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string" }
    }
} as unknown as CollectionConfig;

/** Shaped like the example app's `posts`: a search block, declared indexes, an `on_update` stamp. */
const posts = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    search: {
        language: "english",
        fields: [
            { path: "title", weight: "A" },
            { path: "tags", weight: "C" },
            { path: "meta", weight: "D" }
        ]
    },
    indexes: [
        { on: ["status", { prop: "publish_date", direction: "desc" }], reason: "admin list" },
        { on: ["publish_date"], where: { prop: "status", op: "=", value: "published" }, reason: "public feed" },
        { on: ["author"], reason: "an author's posts" }
    ],
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" },
        status: { type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { type: "date" },
        tags: { type: "array", of: { type: "string" } },
        meta: { type: "map", properties: { note: { type: "string" } } },
        updated_at: { type: "date", autoValue: "on_update" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, relationName: "author" } }
    }
} as unknown as CollectionConfig;

const collections = [authors, posts];

describe("the boot ensure settles", () => {
    let db: PGlite;
    let client: Queryable;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        client = { query: async <T,>(text: string) => ({ rows: (await db.query<T>(text)).rows }) };
    });

    afterEach(async () => {
        await db.close();
    });

    it("plans functions and indexes on the first boot", async () => {
        const first = await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        const kinds = first.actions.map(a => a.kind);
        expect(kinds).toContain("create-function");
        expect(kinds).toContain("create-index");
        expect(first.failures).toEqual([]);
    });

    it("plans zero actions on the second boot", async () => {
        await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        const second = await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        expect(second.actions.map(a => `${a.kind} ${a.target}: ${a.sql.split("\n")[0]}`)).toEqual([]);
    });

    it("still re-plans a helper function whose body was changed by hand", async () => {
        await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        await db.query(
            "CREATE OR REPLACE FUNCTION public.rebase_search_text(text[]) RETURNS text " +
            "LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT 'tampered' $$"
        );
        const second = await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        expect(second.actions.map(a => a.kind)).toEqual(["create-function"]);
        expect(second.actions[0].sql).toContain("public.rebase_search_text(text[])");
    });

    it("still re-plans a helper function whose volatility was changed by hand", async () => {
        await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        await db.query("ALTER FUNCTION rebase.set_updated_at() STRICT");
        const second = await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        expect(second.actions.map(a => `${a.kind} ${a.target}`)).toEqual(["create-function rebase.set_updated_at"]);
    });

    it("still re-plans an index that was dropped by hand", async () => {
        const first = await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        const authorIndex = first.actions.find(a => a.kind === "create-index" && /\("author_id"\)/.test(a.sql));
        const name = /INDEX\s+(?:CONCURRENTLY\s+)?IF NOT EXISTS\s+"([^"]+)"/.exec(authorIndex!.sql)![1];
        await db.query(`DROP INDEX "public"."${name}"`);
        const second = await ensureCollectionTables(client, collections, undefined, { databaseExtensions: [] });
        // On a table that already exists it goes to the index builder, not
        // the actions — see `test/live-index-builds.test.ts`.
        expect(second.actions).toEqual([]);
        expect(second.deferredIndexes.map(d => d.indexName)).toEqual([name]);
        expect(second.indexBuilds?.built).toEqual([`public.${name}`]);
    });
});
