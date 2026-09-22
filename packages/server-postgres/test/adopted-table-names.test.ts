/**
 * Boot against a database that already has tables nobody declared.
 *
 * `readExistingSchema` asks every ordinary table in the collections' schemas
 * whether it holds rows, because that decides whether a NOT NULL can be added
 * without reading the data. The tables it asks are whatever `pg_class` lists,
 * not what the configuration names, so on an adopted database they include
 * names no collection would ever be allowed to declare: `2024_archive`,
 * `order-items`, `Sales Data`. The probe has to quote those, not refuse them —
 * a refusal there is a boot that never finishes.
 *
 * PGlite because the point is the SQL Postgres accepts for those names.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import {
    ensureCollectionTables,
    readExistingSchema
} from "../src/schema/ensure-collection-tables";

const posts = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" }
    }
} as unknown as CollectionConfig;

/** PGlite's handle, as the ensure path's `Queryable`. */
const queryable = (db: PGlite) => ({
    query: async <T = unknown>(sql: string) => {
        const result = await db.query<T>(sql);
        return { rows: result.rows };
    }
});

describe("tables Rebase does not manage, with names it would not choose", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        await db.exec(`
            CREATE TABLE "public"."2024_archive" (id int);
            INSERT INTO "public"."2024_archive" VALUES (1);
            CREATE TABLE "public"."order-items" (id int);
            CREATE TABLE "public"."Sales Data" (id int);
            INSERT INTO "public"."Sales Data" VALUES (1);
            CREATE TABLE "public"."créé" (id int);
            CREATE TABLE "public"."quote""inside" (id int);
            INSERT INTO "public"."quote""inside" VALUES (1);
        `);
    });

    afterEach(async () => {
        await db.close();
    });

    it("reads the catalogue, and knows which of them hold rows", async () => {
        const existing = await readExistingSchema(queryable(db), ["public"]);

        expect(existing.populatedTables).toEqual(new Set([
            "public.2024_archive",
            "public.Sales Data",
            "public.quote\"inside"
        ]));
        expect(existing.tables.has("public.order-items")).toBe(true);
        expect(existing.tables.has("public.créé")).toBe(true);
    });

    it("boots: the collections' own tables are created and the others left alone", async () => {
        const outcome = await ensureCollectionTables(queryable(db), [posts]);

        expect(outcome.failures).toEqual([]);
        const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "public"."2024_archive";`);
        expect(rows[0].n).toBe(1);
        const created = await db.query<{ name: string }>(
            `SELECT relname AS name FROM pg_class WHERE relname = 'posts' AND relkind = 'r';`
        );
        expect(created.rows).toHaveLength(1);
    });
});
