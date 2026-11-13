/**
 * Hostile values through the two places the security review could read but
 * not fuzz (SEC-FIX-2, "could not verify"): the Postgres array-literal parser
 * (`parsePgArrayLiteral`, which every native array column is read through)
 * and the `via` join aliases (`__via_src`, `__via_j<n>`) a `via` include reads
 * with, keyed by the parent rows' ids.
 *
 * Property-style, with a seeded generator (the same cases every run): quotes,
 * backslashes, braces, commas, whitespace and newlines, every spelling of
 * NULL, the empty string, unicode beyond the BMP, very long items, null items.
 * The oracle is Postgres itself (PGlite): it writes the literal, the parser
 * must read back exactly what went in; and a `via` read keyed by hostile ids
 * must return exactly the rows SQL joins to them, through the real driver.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { parsePgArrayLiteral } from "../src/utils/pg-array-null-patch";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

/** A small deterministic PRNG (mulberry32): the same hostile cases every run. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const PIECES = ["\"", "\\", "{", "}", ",", " ", "\t", "\n", "NULL", "null", "NuLl", "'", ";", "=", "[0:1]", "é", "😀", "\u0000".slice(1), "a", "Z", "0", "\"\"", "\\\\", "${x}", "%", "_"];
const SPECIAL_ITEMS = ["", "NULL", "null", " NULL ", "\"NULL\"", "{}", "{a,b}", "x".repeat(20_000), "\\", "\"", " lead", "trail ", "multi\nline"];

function hostileString(next: () => number): string {
    if (next() < 0.2) return SPECIAL_ITEMS[Math.floor(next() * SPECIAL_ITEMS.length)];
    const length = Math.floor(next() * 12);
    let out = "";
    for (let i = 0; i < length; i++) out += PIECES[Math.floor(next() * PIECES.length)];
    return out;
}

function hostileArray(next: () => number): (string | null)[] {
    const length = Math.floor(next() * 8);
    return Array.from({ length }, () => (next() < 0.15 ? null : hostileString(next)));
}

let db: PGlite;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
});

afterAll(async () => {
    await db.close();
});

describe("parsePgArrayLiteral reads back exactly what Postgres wrote", () => {
    it("for 400 hostile text[] values, nulls and empty arrays among them", async () => {
        const next = prng(0x5EC_F1C2);
        const failures: string[] = [];
        for (let n = 0; n < 400; n++) {
            const value = hostileArray(next);
            const { rows } = await db.query<{ literal: string }>("SELECT $1::text[]::text AS literal", [value]);
            const literal = rows[0].literal;
            const parsed = parsePgArrayLiteral(literal);
            if (JSON.stringify(parsed) !== JSON.stringify(value)) failures.push(`${JSON.stringify(value)} → ${literal} → ${JSON.stringify(parsed)}`);
        }
        expect(failures.slice(0, 5)).toEqual([]);
    });

    it("for two-dimensional arrays and an explicit lower bound", async () => {
        const next = prng(0xB0_0B5);
        for (let n = 0; n < 100; n++) {
            const width = 1 + Math.floor(next() * 3);
            const value = Array.from({ length: 2 }, () => Array.from({ length: width }, () => (next() < 0.2 ? null : hostileString(next))));
            const { rows } = await db.query<{ literal: string }>("SELECT $1::text[][]::text AS literal", [value]);
            expect(parsePgArrayLiteral(rows[0].literal)).toEqual(value);
        }
        const { rows } = await db.query<{ literal: string }>("SELECT '[0:1]={\"a,b\",NULL}'::text[]::text AS literal");
        expect(parsePgArrayLiteral(rows[0].literal)).toEqual(["a,b", null]);
    });
});

describe("hostile values through a `via` read and a native array column, on the real driver", () => {
    const tags = defineTable("tags", {
        columns: { id: col.text().primaryKey(), label: col.text(), items: col.text().array() },
        rls: "admin-only"
    });
    const songTags = defineTable("song_tags", {
        columns: { id: col.serial().primaryKey(), songId: col.text().notNull(), tagId: col.text().notNull() },
        rls: "admin-only"
    });
    const songs = defineTable("songs", {
        columns: { id: col.text().primaryKey(), title: col.text() },
        relations: {
            // Two joins: songs → song_tags → tags, keyed by text ids.
            tagged: rel.via(() => tags, {
                steps: [
                    { table: "song_tags", on: { from: "id", to: "song_id" } },
                    { table: "tags", on: { from: "tag_id", to: "id" } }
                ]
            })
        },
        rls: "admin-only"
    });

    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;
    const ids: string[] = [];

    beforeAll(async () => {
        const compiled = compileSchema([tags, songTags, songs]);
        await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
            includePolicies: false, includeSearch: false, includeVector: false
        }));
        const catalogue = await readCatalogueSchema({
            client: { query: async <T = unknown>(text: string, values?: unknown[]) => ({ rows: (await db.query<T>(text, values)).rows }) },
            tables: compiled.map(t => t.descriptor),
            defaultSchema: "public"
        });
        const registry = new PostgresTableRegistry();
        registry.registerTables(compiled);
        // The catalogue's tables are the runtime's own build (`buildDrizzleTablesFromSchema`),
        // which carries the array-null patch.
        for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
        const orm = pgliteNodePg(db, { schema: catalogue.tables });
        realtime = new RealtimeService(orm, registry);
        driver = new PostgresBackendDriver(orm, realtime, registry);

        const next = prng(0x7A65);
        const seen = new Set<string>();
        while (ids.length < 40) {
            const id = hostileString(next);
            if (id === "" || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
        for (const [index, id] of ids.entries()) {
            await db.query("INSERT INTO songs (id, title) VALUES ($1, $2)", [id, `song ${index}`]);
            await db.query("INSERT INTO tags (id, label, items) VALUES ($1, $2, $3)", [`t:${id}`, `tag ${index}`, hostileArray(next)]);
            // Each song tagged with its own tag and its neighbour's.
            await db.query("INSERT INTO song_tags (song_id, tag_id) VALUES ($1, $2), ($1, $3)", [id, `t:${id}`, `t:${ids[(index + 1) % 40] ?? id}`]);
        }
    });

    afterAll(async () => {
        await realtime.destroy();
    });

    it("joins every hostile id to exactly the rows SQL joins it to", async () => {
        const rows = await driver.restFetchService.fetchCollectionForRest("songs", { limit: 100 }, ["tagged"]);
        expect(rows).toHaveLength(ids.length);
        for (const row of rows) {
            const { rows: expected } = await db.query<{ id: string }>(
                "SELECT t.id FROM song_tags st JOIN tags t ON t.id = st.tag_id WHERE st.song_id = $1 ORDER BY t.id", [row.id]
            );
            const got = (Array.isArray(row.tagged) ? row.tagged : []).map(tag => (tag as { id: string }).id).sort();
            expect(got).toEqual(expected.map(e => e.id).sort());
        }
    });

    it("reads every hostile array item back as stored, through the driver", async () => {
        const rows = await driver.restFetchService.fetchCollectionForRest("tags", { limit: 100 });
        for (const row of rows) {
            const { rows: stored } = await db.query<{ items: (string | null)[] | null }>("SELECT items FROM tags WHERE id = $1", [row.id]);
            expect(row.items).toEqual(stored[0].items);
        }
    });
});
