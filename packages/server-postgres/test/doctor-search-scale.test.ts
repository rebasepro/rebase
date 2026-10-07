/**
 * `rebase doctor` names the collections whose search reads the whole table.
 *
 * With no `search` block a search is `ILIKE '%term%'` over every text column,
 * which no index can serve: 326 ms per search on 100k rows, and growing with
 * the table. Doctor now says so above 10,000 rows, and points at the block.
 */
import { PGlite } from "@electric-sql/pglite";
import { CollectionConfig } from "@rebasepro/types";
import {
    estimateRowCounts,
    formatUnindexedSearches,
    ilikeSearchedCollections,
    unindexedSearchFindings,
    UNINDEXED_SEARCH_ROWS
} from "../src/schema/doctor-search-scale";

const posts = {
    name: "Posts", slug: "posts", table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", columnType: "text" },
        status: { name: "Status", type: "string", enum: ["draft", "published"] },
        views: { name: "Views", type: "number" }
    }
} as unknown as CollectionConfig;

const people = {
    name: "People", slug: "people", table: "people",
    search: { fields: [{ path: "name", weight: "A" }] },
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const counters = {
    name: "Counters", slug: "counters", table: "counters",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        kind: { name: "Kind", type: "string", enum: ["a", "b"] },
        value: { name: "Value", type: "number" }
    }
} as unknown as CollectionConfig;

describe("ilikeSearchedCollections", () => {
    it("names a collection searched by ILIKE, with the fields it reads", () => {
        expect(ilikeSearchedCollections([posts])).toEqual([
            { slug: "posts", schema: "public", table: "posts", fields: ["title", "body"] }
        ]);
    });

    it("leaves out a collection with a search block, and one with nothing ILIKE reads", () => {
        expect(ilikeSearchedCollections([people, counters])).toEqual([]);
    });
});

describe("unindexedSearchFindings", () => {
    const candidates = ilikeSearchedCollections([posts]);

    it("warns above the threshold", () => {
        const findings = unindexedSearchFindings(candidates, new Map([["public.posts", 120_000]]));
        expect(findings.map(f => [f.slug, f.rows])).toEqual([["posts", 120_000]]);
        const text = formatUnindexedSearches(findings).join("\n");
        expect(text).toContain("posts — about 120,000 rows, no `search` block");
        expect(text).toContain("ILIKE '%term%' over title, body");
        expect(text).toContain("rebase.pro/docs/backend/search");
    });

    it("stays quiet at or below it, and for a table it cannot see", () => {
        expect(unindexedSearchFindings(candidates, new Map([["public.posts", UNINDEXED_SEARCH_ROWS]]))).toEqual([]);
        expect(unindexedSearchFindings(candidates, new Map())).toEqual([]);
        expect(formatUnindexedSearches([])).toEqual([]);
    });
});

describe("estimateRowCounts", () => {
    it("reads the planner's estimate without scanning the table", async () => {
        const db = new PGlite();
        try {
            await db.exec(`CREATE TABLE "public"."posts" ("id" TEXT PRIMARY KEY, "title" TEXT);
                INSERT INTO "public"."posts" SELECT 'p' || g, 't' || g FROM generate_series(1, 12000) g;
                ANALYZE "public"."posts";
                CREATE TABLE "public"."empty" ("id" TEXT PRIMARY KEY);`);
            const statements: string[] = [];
            const estimates = await estimateRowCounts(async (text, values) => {
                statements.push(text);
                return db.query(text, values);
            }, ["public"]);
            expect(estimates.get("public.posts")).toBe(12_000);
            expect(estimates.get("public.empty")).toBe(0);
            expect(statements.join("\n")).not.toMatch(/count\(/i);
        } finally {
            await db.close();
        }
    }, 30_000);
});
