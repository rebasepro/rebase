/**
 * What each `search` configuration actually finds, measured rather than
 * reasoned about.
 *
 * Both existing branches have a hole a real search box falls into, and the
 * holes are in different places — which is the whole reason `mode: "hybrid"`
 * exists:
 *
 * - The **ILIKE default** (no `search` block) matches substrings, so `seb`
 *   finds `Sebastian` and `audit` finds `Lead Auditor`. It cannot fold accents,
 *   so `munoz` never finds `Muñoz` and `nunez` never finds `Núñez`.
 * - The **FTS path** folds accents (with `unaccent`), so `munoz` finds `Muñoz`.
 *   It matches whole lexemes, so `seb` finds nothing at all.
 * - **`fuzzy`** covers both, at the price of a similarity threshold somebody
 *   has to tune: the 0.3 default is loose enough that `iso 14001` drags in an
 *   `ISO 9001` row, and 0.75 is where that stops.
 * - **`hybrid`** is FTS `OR` a folded substring match over the same declared
 *   fields: both halves, no threshold.
 *
 * The table below is the output of this file, not a claim about it. Nothing is
 * stubbed — the DDL comes from `generatePostgresDdl`, the tables carry the real
 * generated columns, and the queries go through `FetchService`.
 *
 *   variant             munoz          Muñoz          seb        audit   iso 14001
 *   plain (ILIKE)       Ana            Sebastian      both       Seb     Seb
 *   fts + unaccent      Ana, Seb       Ana, Seb       —          —       Seb
 *   fts, no unaccent    Ana            Sebastian      —          —       Seb
 *   fuzzy (0.3)         Ana, Seb       Ana, Seb       both       Seb     Seb + Bea ✗
 *   fuzzy (0.75)        Ana, Seb       Ana, Seb       both       Seb     Seb
 *   hybrid              Ana, Seb       Ana, Seb       both       Seb     Seb
 *   hybrid, no unaccent Ana, Seb       Ana, Seb       both       Seb     Seb
 *
 * The last row is the migration story in one line: `hybrid` folds accents on
 * its substring half without `unaccent`, and `unaccent` is the setting that
 * cannot be turned on later without rebuilding a stored generated column.
 *
 * `buildFullTextCondition` falls back to ILIKE, silently, when the drizzle
 * table has no generated column — so every table here declares its own, or
 * every row of the table above would read the same.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, text, serial, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { buildSearchColumnSpec } from "../src/schema/search-column";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { FetchService } from "../src/services/FetchService";

/** Five rows, chosen so each query below separates the configurations. */
const ROWS: [string, string][] = [
    ["Sebastian Muñoz", "ISO 14001 Lead Auditor"],
    ["Sebastián Torres", "B Corp"],
    ["Ana Munoz", "Google Ads"],
    ["Carlos Marketing", "Scrum Master"],
    ["Beatriz Núñez", "ISO 9001 Quality"]
];

type Variant = { slug: string; search?: PostgresCollectionConfig["search"] };

const VARIANTS: Variant[] = [
    { slug: "plain" },
    { slug: "fts", search: { language: "spanish", unaccent: true, fields: ["name", "cert"] } },
    { slug: "fts_no_unaccent", search: { language: "spanish", fields: ["name", "cert"] } },
    { slug: "fuzzy03", search: { language: "spanish", unaccent: true, fuzzy: true, fields: ["name", "cert"] } },
    {
        slug: "fuzzy075",
        search: { language: "spanish", unaccent: true, fuzzy: true, fuzzyThreshold: 0.75, fields: ["name", "cert"] }
    },
    { slug: "hybrid", search: { language: "spanish", unaccent: true, mode: "hybrid", fields: ["name", "cert"] } },
    { slug: "hybrid_no_unaccent", search: { language: "spanish", mode: "hybrid", fields: ["name", "cert"] } }
];

const collectionFor = (v: Variant): PostgresCollectionConfig => ({
    slug: v.slug,
    table: v.slug,
    name: v.slug,
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        cert: { type: "string" }
    },
    ...(v.search ? { search: v.search } : {})
});

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

let db: PGlite;
const services: Record<string, FetchService> = {};

/** First names of the rows a search returns, sorted so order is not asserted. */
async function found(slug: string, searchString: string): Promise<string[]> {
    const rows = await services[slug].fetchCollection(slug, { searchString, limit: 50 });
    return rows.map(r => String(r.name).split(" ")[0]).sort();
}

beforeAll(async () => {
    db = new PGlite({ extensions: { pg_trgm, unaccent } });
    await db.waitReady;

    const collections = VARIANTS.map(v => collectionFor(v) as CollectionConfig);
    await db.exec(await generatePostgresDdl(collections, { includePolicies: false }));

    for (const v of VARIANTS) {
        for (const [name, cert] of ROWS) {
            await db.query(`INSERT INTO "${v.slug}" (name, cert) VALUES ($1, $2)`, [name, cert]);
        }
    }

    const orm = drizzle(db) as never;
    for (const v of VARIANTS) {
        const collection = collectionFor(v) as CollectionConfig;
        const spec = v.search ? buildSearchColumnSpec(collection) : undefined;
        const columns: Record<string, unknown> = {
            id: serial("id").primaryKey(),
            name: text("name"),
            cert: text("cert")
        };
        // The generated columns, on the drizzle table. Without them
        // `buildFullTextCondition` returns undefined and every variant silently
        // becomes the ILIKE default.
        if (spec) {
            columns[spec.column] = tsvector(spec.column).generatedAlwaysAs(sql.raw(spec.expression));
            if (spec.fuzzy) {
                columns[spec.fuzzy.column] = text(spec.fuzzy.column)
                    .generatedAlwaysAs(sql.raw(spec.fuzzy.expression));
            }
        }
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([collection]);
        registry.registerTable(pgTable(v.slug, columns as never), v.slug);
        services[v.slug] = new FetchService(orm, registry);
    }
}, 120_000);

afterAll(async () => {
    await db?.close();
});

describe("the generated columns exist, so the variants are really different", () => {
    it("puts a tsvector column on every opted-in table and none on the plain one", async () => {
        const res = await db.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.columns WHERE column_name = 'search_vector' ORDER BY table_name"
        );
        expect(res.rows.map(r => r.table_name)).toEqual([
            "fts", "fts_no_unaccent", "fuzzy03", "fuzzy075", "hybrid", "hybrid_no_unaccent"
        ]);
    });

    it("does not silently answer every variant the same way", async () => {
        // The single assertion that makes the rest non-vacuous: if the generated
        // columns were missing, every variant would fall back to ILIKE and
        // `seb` would find both Sebastians everywhere.
        expect(await found("fts", "seb")).toEqual([]);
        expect(await found("plain", "seb")).toEqual(["Sebastian", "Sebastián"]);
    });
});

describe("the ILIKE default cannot fold accents", () => {
    it("misses the accented row a query typed without accents means", async () => {
        expect(await found("plain", "munoz")).toEqual(["Ana"]);
        expect(await found("plain", "nunez")).toEqual([]);
    });

    it("but does match substrings", async () => {
        expect(await found("plain", "audit")).toEqual(["Sebastian"]);
        expect(await found("plain", "marketin")).toEqual(["Carlos"]);
    });
});

describe("the FTS path folds accents and matches whole lexemes only", () => {
    it("finds the accented row from an unaccented query", async () => {
        expect(await found("fts", "munoz")).toEqual(["Ana", "Sebastian"]);
        expect(await found("fts", "nunez")).toEqual(["Beatriz"]);
    });

    it("needs `unaccent` for that — without it the two spellings are two lexemes", async () => {
        expect(await found("fts_no_unaccent", "munoz")).toEqual(["Ana"]);
        expect(await found("fts_no_unaccent", "nunez")).toEqual([]);
    });

    it("finds nothing for a prefix or an infix", async () => {
        expect(await found("fts", "seb")).toEqual([]);
        expect(await found("fts", "audit")).toEqual([]);
        expect(await found("fts", "marketin")).toEqual([]);
    });
});

describe("`fuzzy` covers both, at the price of a tuned threshold", () => {
    it("is too loose at its 0.3 default: `iso 14001` reaches the ISO 9001 row", async () => {
        expect(await found("fuzzy03", "iso 14001")).toEqual(["Beatriz", "Sebastian"]);
    });

    it("stops doing that at 0.75", async () => {
        expect(await found("fuzzy075", "iso 14001")).toEqual(["Sebastian"]);
    });
});

describe("`hybrid` is both halves, with no threshold to tune", () => {
    it("folds accents like the FTS path", async () => {
        expect(await found("hybrid", "munoz")).toEqual(["Ana", "Sebastian"]);
        expect(await found("hybrid", "Muñoz")).toEqual(["Ana", "Sebastian"]);
        expect(await found("hybrid", "nunez")).toEqual(["Beatriz"]);
    });

    it("matches prefixes and infixes like the ILIKE default", async () => {
        expect(await found("hybrid", "seb")).toEqual(["Sebastian", "Sebastián"]);
        expect(await found("hybrid", "audit")).toEqual(["Sebastian"]);
        expect(await found("hybrid", "marketin")).toEqual(["Carlos"]);
    });

    it("stays precise where a loose `fuzzy` threshold does not", async () => {
        expect(await found("hybrid", "iso 14001")).toEqual(["Sebastian"]);
    });

    it("still AND-es terms across fields, like both paths it combines", async () => {
        // "sebastian" is in `name`, "auditor" in `cert`. Both terms must match,
        // and neither column holds both.
        expect(await found("hybrid", "sebastian auditor")).toEqual(["Sebastian"]);
        // A term no row holds excludes every row, rather than being dropped.
        expect(await found("hybrid", "sebastian nonesuch")).toEqual([]);
    });

    it("folds accents on the substring half without `unaccent`, which is what makes the switch free", async () => {
        // `unaccent` rebuilds a stored generated column; `mode` does not. So
        // this row of the matrix is the one a live collection can reach.
        expect(await found("hybrid_no_unaccent", "munoz")).toEqual(["Ana", "Sebastian"]);
        expect(await found("hybrid_no_unaccent", "seb")).toEqual(["Sebastian", "Sebastián"]);
        expect(await found("hybrid_no_unaccent", "audit")).toEqual(["Sebastian"]);
    });

    it("ranks a lexeme match above a substring-only one", async () => {
        // `sebastian` is a lexeme of two rows and a substring of the same two,
        // while `seb` is only ever a substring. So the first query's scores are
        // real `ts_rank` values and the second's are the substring floor.
        const lexeme = await services.hybrid.fetchCollection("hybrid", { searchString: "sebastian" });
        const prefix = await services.hybrid.fetchCollection("hybrid", { searchString: "seb" });
        const min = (rows: Record<string, unknown>[]) => Math.min(...rows.map(r => Number(r._score)));
        expect(min(lexeme)).toBeGreaterThan(min(prefix));
        expect(min(prefix)).toBeGreaterThan(0);
    });

    it("names the field a substring-only hit came from, when asked to explain", async () => {
        const [row] = await services.hybrid.fetchCollection("hybrid", {
            searchString: "audit", searchExplain: true
        });
        const matches = row._matches as { field: string; snippet: string }[];
        expect(matches.map(m => m.field)).toEqual(["cert"]);
    });
});
