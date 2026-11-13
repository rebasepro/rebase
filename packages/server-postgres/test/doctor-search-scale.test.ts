/**
 * `rebase doctor` names the tables whose search reads the whole table.
 *
 * With no `search` block a search is `ILIKE '%term%'` over every text column,
 * which no index can serve: 326 ms per search on 100k rows, and growing with
 * the table. Doctor now says so above 10,000 rows, and points at the block.
 */
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, type TableDescriptor } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import {
    estimateRowCounts,
    formatUnindexedSearches,
    ilikeSearchedTables,
    unindexedSearchFindings,
    UNINDEXED_SEARCH_ROWS
} from "../src/schema/doctor-search-scale";

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey(),
        title: col.text(),
        body: col.text(),
        status: col.enum(["draft", "published"]),
        views: col.numeric()
    },
    rls: "admin-only"
});

const people = defineTable("people", {
    columns: {
        id: col.uuid().primaryKey(),
        name: col.text()
    },
    search: { fields: [{ path: "name", weight: "A" }] },
    rls: "admin-only"
});

const counters = defineTable("counters", {
    columns: {
        id: col.uuid().primaryKey(),
        kind: col.text({ enum: ["a", "b"] }),
        value: col.numeric()
    },
    rls: "admin-only"
});

const described = (...defs: Parameters<typeof compileTables>[0][number][]): TableDescriptor[] => compileTables(defs);

describe("ilikeSearchedTables", () => {
    it("names a table searched by ILIKE, with the columns it reads", () => {
        expect(ilikeSearchedTables(described(posts))).toEqual([
            { slug: "posts", schema: "public", table: "posts", fields: ["title", "body"] }
        ]);
    });

    it("leaves out a table with a search block, and one with nothing ILIKE reads", () => {
        expect(ilikeSearchedTables(described(people, counters))).toEqual([]);
    });
});

describe("unindexedSearchFindings", () => {
    const candidates = ilikeSearchedTables(described(posts));

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
