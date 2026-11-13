/**
 * Which foreign-key indexes `rebase db push` builds before Atlas plans.
 *
 * The derived index on an existing table was left to Atlas, which builds it
 * with a plain `CREATE INDEX` inside the push's transaction — holding the
 * table's writes for the whole build. The push now builds those first,
 * CONCURRENTLY; these pin which ones it picks: a live table missing the index
 * on a column it already has, and nothing else.
 */
import { PGlite } from "@electric-sql/pglite";
import { LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { ensureTables, type Queryable } from "../src/schema/ensure-tables";
import { missingForeignKeyIndexes } from "../src/schema/push-index-prebuild";
import { compileSet } from "./helpers/plan-tables";

const authors: LegacyCollectionConfig = {
    slug: "authors", table: "authors", name: "Authors",
    properties: { id: { type: "number", isId: "increment" }, name: { type: "string" } }
};

const posts: LegacyPostgresCollectionConfig = {
    slug: "posts", table: "posts", name: "Posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
    }
};

async function database(): Promise<{ db: PGlite; queryable: Queryable }> {
    const db = new PGlite();
    const queryable: Queryable = {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            const results = await db.exec(text);
            return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
        }
    };
    return { db, queryable };
}

async function derivedIndexOnPosts(db: PGlite): Promise<string> {
    const { rows } = await db.query<{ name: string }>(
        "SELECT indexname AS name FROM pg_indexes WHERE tablename = 'posts' AND indexname LIKE 'posts_author_id_ix_%'"
    );
    return rows[0]?.name;
}

describe("missingForeignKeyIndexes", () => {
    it("names the derived index an existing table lacks", async () => {
        const { db, queryable } = await database();
        try {
            await ensureTables(queryable, compileSet([authors, posts]));
            const name = await derivedIndexOnPosts(db);
            expect(name).toBeDefined();
            // A table from before the release that derived it.
            await db.exec(`DROP INDEX "public"."${name}"`);

            const missing = await missingForeignKeyIndexes(queryable, compileSet([authors, posts]));
            expect(missing.map(m => [m.table, m.indexName])).toEqual([["posts", name]]);
            expect(missing[0].sql).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("names nothing when the index is there", async () => {
        const { db, queryable } = await database();
        try {
            await ensureTables(queryable, compileSet([authors, posts]));
            expect(await missingForeignKeyIndexes(queryable, compileSet([authors, posts]))).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("leaves a table the push creates to Atlas, which creates its index with it", async () => {
        const { db, queryable } = await database();
        try {
            await ensureTables(queryable, compileSet([authors]));
            expect(await missingForeignKeyIndexes(queryable, compileSet([authors, posts]))).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("leaves a column the push adds to Atlas: there is nothing to build the index over yet", async () => {
        const { db, queryable } = await database();
        try {
            await ensureTables(queryable, compileSet([authors, posts]));
            const name = await derivedIndexOnPosts(db);
            await db.exec(`DROP INDEX "public"."${name}"; ALTER TABLE "public"."posts" DROP COLUMN "author_id";`);
            expect(await missingForeignKeyIndexes(queryable, compileSet([authors, posts]))).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("leaves a declared index alone — only the derived ones are the push's to build ahead", async () => {
        const { db, queryable } = await database();
        try {
            const indexed: LegacyCollectionConfig = { ...posts, indexes: [{ on: ["title"], reason: "list by title" }] };
            await ensureTables(queryable, compileSet([authors, indexed]));
            const { rows } = await db.query<{ name: string }>(
                "SELECT indexname AS name FROM pg_indexes WHERE tablename = 'posts' AND indexname LIKE 'posts_title_ix_%'"
            );
            await db.exec(`DROP INDEX "public"."${rows[0].name}"`);
            expect(await missingForeignKeyIndexes(queryable, compileSet([authors, indexed]))).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);
});
