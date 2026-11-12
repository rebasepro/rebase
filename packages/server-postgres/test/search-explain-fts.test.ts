/**
 * Asking which fields matched works on a collection that searches by full
 * text alone — no `unaccent`, no `hybrid`, as the demo's blog posts do.
 *
 * The explanation read every field twice: as the tsvector saw it and folded
 * through `rebase_search_unaccent`, which only a collection with `unaccent`
 * or `hybrid` creates. So on any other one, every search that asked which
 * fields matched failed with "function rebase_search_unaccent(text) does not
 * exist". The search tests all share one database with a `hybrid` table,
 * which had created the function for everyone; this one has no such table.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, text, serial, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { buildSearchColumnSpec } from "../src/schema/search-column";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { FetchService } from "../src/services/FetchService";
import type { PgColumnBuilderBase } from "drizzle-orm/pg-core";
import { compileSet } from "./helpers/plan-tables";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        content: { type: "string" }
    },
    search: { language: "english", fields: [{ path: "title", weight: "A" }, { path: "content", weight: "D" }] }
};

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

let db: PGlite;
let service: FetchService;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const collection = posts as CollectionConfig;
    await db.exec(await generatePostgresDdl(compileSet([collection]), { includePolicies: false }));
    await db.query(`INSERT INTO posts (title, content) VALUES ($1, $2), ($3, $4)`, [
        "Admin panels for Postgres", "Generated from the schema you already have.",
        "Release notes", "This one mentions panels only in its body."
    ]);

    const spec = buildSearchColumnSpec(collection)!;
    const columns: Record<string, PgColumnBuilderBase> = {
        id: serial("id").primaryKey(),
        title: text("title"),
        content: text("content"),
        [spec.column]: tsvector(spec.column).generatedAlwaysAs(sql.raw(spec.expression))
    };
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([collection]);
    registry.registerPgTable(pgTable("posts", columns), "posts");
    service = new FetchService(drizzle(db), registry);
}, 60_000);

afterAll(async () => {
    await db?.close();
});

describe("explaining a full-text search", () => {
    it("names the fields that matched, with no accent-folding function in the database", async () => {
        const rows = await service.fetchCollection("posts", { searchString: "panels", searchExplain: true, limit: 10 });
        const byTitle = Object.fromEntries(rows.map(row => [String(row.title), (row._matches as { field: string }[]).map(m => m.field)]));
        expect(byTitle).toEqual({
            "Admin panels for Postgres": ["title"],
            "Release notes": ["content"]
        });
    });
});
