/**
 * The search block through the real read path, not raw SQL.
 *
 * `search-fts-e2e` proves the generated DDL produces a working index. This
 * proves the driver actually uses it: that `.search()` compiles to the `@@`
 * predicate rather than the ILIKE fallback, that `_score` comes back and can
 * order the rows, and — the part most likely to regress silently — that the
 * generated columns never reach a caller.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, uuid, customType, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { PostgresCollectionConfig, CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { FetchService } from "../../src/services/FetchService.js";
import { generatePostgresDdl } from "../../src/schema/generate-postgres-ddl-logic.js";
import { buildSearchColumnSpec } from "../../src/schema/search-column.js";

const searched: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Talents",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" },
        questionnaire: { type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [{ path: "full_name", weight: "A" }, "questionnaire.certifications"]
    }
};

/** The same shape without the block — the control for "nothing changed". */
const plain: PostgresCollectionConfig = {
    slug: "notes",
    table: "notes",
    name: "Notes",
    properties: {
        id: { type: "string", isId: "uuid" },
        body: { type: "string" }
    }
};

/** Same shape again, with `fuzzy` on — the trigram half of the score. */
const fuzzied: PostgresCollectionConfig = {
    slug: "fuzzies",
    table: "fuzzies",
    name: "Fuzzies",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" }
    },
    search: { language: "spanish", unaccent: true, fuzzy: true, fields: ["full_name"] }
};

const spec = buildSearchColumnSpec(searched)!;
const fuzzySpec = buildSearchColumnSpec(fuzzied)!;
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const talentsTable = pgTable("talents", {
    id: uuid("id").primaryKey().defaultRandom(),
    full_name: text("full_name"),
    questionnaire: jsonb("questionnaire"),
    search_vector: tsvector("search_vector").generatedAlwaysAs(sql.raw(spec.expression))
});

const notesTable = pgTable("notes", {
    id: uuid("id").primaryKey().defaultRandom(),
    body: text("body")
});

const fuzziesTable = pgTable("fuzzies", {
    id: uuid("id").primaryKey().defaultRandom(),
    full_name: text("full_name"),
    search_vector: tsvector("search_vector").generatedAlwaysAs(sql.raw(fuzzySpec.expression)),
    search_vector_text: text("search_vector_text").generatedAlwaysAs(sql.raw(fuzzySpec.fuzzy!.expression))
});

describe("search through the driver", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let fetchService: FetchService;
    let fuzzyService: FetchService;

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();

        const ddl = await generatePostgresDdl(
            [searched as CollectionConfig, plain as CollectionConfig, fuzzied as CollectionConfig],
            { includePolicies: false }
        );
        await admin.query(ddl);
        await admin.query(`
            INSERT INTO talents (full_name, questionnaire) VALUES
            ('Ana Gutiérrez', '{"certifications":["ISO 14001 Lead Auditor"]}'::jsonb),
            ('Consultora ISO Ibérica', '{"certifications":["B Corp"]}'::jsonb),
            ('Carlos Marketing', '{"certifications":["Google Ads"]}'::jsonb)
        `);
        await admin.query(`INSERT INTO notes (body) VALUES ('a plain note')`);
        await admin.query(`
            INSERT INTO fuzzies (full_name) VALUES
            ('Ana ISO 14001 Lead Auditor'),
            ('Beto ISO 9001 Quality'),
            ('Caro Marketing Growth')
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([searched as CollectionConfig, plain as CollectionConfig]);
        registry.registerTable(talentsTable, "talents");
        registry.registerTable(notesTable, "notes");

        fetchService = new FetchService(drizzle(pool) as never, registry);

        const fuzzyRegistry = new PostgresCollectionRegistry();
        fuzzyRegistry.registerMultiple([fuzzied as CollectionConfig]);
        fuzzyRegistry.registerTable(fuzziesTable, "fuzzies");
        fuzzyService = new FetchService(drizzle(pool) as never, fuzzyRegistry);
    }, 180_000);

    afterAll(async () => {
        await pool?.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("finds a candidate by a certification buried in JSONB", async () => {
        const rows = await fetchService.fetchCollection("talents", { searchString: "ISO 14001" });
        expect(rows.map(r => r.full_name)).toEqual(["Ana Gutiérrez"]);
    });

    it("matches an accentless query against accented content", async () => {
        const rows = await fetchService.fetchCollection("talents", { searchString: "iberica" });
        expect(rows.map(r => r.full_name)).toEqual(["Consultora ISO Ibérica"]);
    });

    it("never returns the generated column", async () => {
        const rows = await fetchService.fetchCollection("talents", {});
        expect(rows.length).toBe(3);
        for (const row of rows) {
            expect(row).not.toHaveProperty(spec.column);
        }
    });

    it("keeps the generated column out of a single-row read too", async () => {
        const [first] = await fetchService.fetchCollection("talents", {});
        const one = await fetchService.fetchOne("talents", String(first.id));
        expect(one).toBeDefined();
        expect(one).not.toHaveProperty(spec.column);
    });

    it("returns a relevance score with each searched row", async () => {
        const rows = await fetchService.fetchCollection("talents", { searchString: "ISO" });
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(typeof row._score).toBe("number");
            expect(row._score as number).toBeGreaterThan(0);
        }
    });

    it("attaches no score when the request carried no search string", async () => {
        const rows = await fetchService.fetchCollection("talents", {});
        expect(rows.every(r => r._score === undefined)).toBe(true);
    });

    it("orders by relevance, putting the name hit above the certification hit", async () => {
        // "ISO" appears in one row's name (weight A) and another's
        // certifications (weight B). Weighting is the whole reason to declare
        // one, so this is the assertion that would catch it being dropped.
        const rows = await fetchService.fetchCollection("talents", {
            searchString: "ISO",
            orderBy: "_score",
            order: "desc"
        });
        expect(rows.length).toBe(2);
        expect(rows[0].full_name).toBe("Consultora ISO Ibérica");
        expect(rows[0]._score as number).toBeGreaterThan(rows[1]._score as number);
    });

    it("refuses `_score` on a collection that did not opt in", async () => {
        await expect(
            fetchService.fetchCollection("notes", { searchString: "plain", orderBy: "_score", order: "desc" })
        ).rejects.toThrow(/Unknown orderBy field/);
    });

    it("refuses cursor pagination by relevance rather than paging wrongly", async () => {
        await expect(
            fetchService.fetchCollection("talents", {
                searchString: "ISO",
                orderBy: "_score",
                order: "desc",
                startAfter: { id: "00000000-0000-0000-0000-000000000000", values: { _score: 0.1 } }
            })
        ).rejects.toThrow(/cannot be combined with/);
    });

    it("ranks a fuzzy-only match, which ts_rank alone scores at zero", async () => {
        // A typo matches nothing on the exact path, so every row it finds has
        // ts_rank 0. Without the trigram term in the score the best match comes
        // back in arbitrary order — which is what `fuzzy` is supposed to fix.
        const rows = await fuzzyService.fetchCollection("fuzzies", {
            searchString: "iso14000",
            orderBy: "_score",
            order: "desc"
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].full_name).toBe("Ana ISO 14001 Lead Auditor");
        expect(rows[0]._score as number).toBeGreaterThan(0);
    });

    it("still puts an exact match above a merely-similar one", async () => {
        const rows = await fuzzyService.fetchCollection("fuzzies", {
            searchString: "auditor",
            orderBy: "_score",
            order: "desc"
        });
        expect(rows[0].full_name).toBe("Ana ISO 14001 Lead Auditor");
    });

    it("leaves a collection without the block on the old ILIKE behaviour", async () => {
        // Substring, mid-word — something `websearch_to_tsquery` would not match
        // and ILIKE does. Its presence proves the fallback still runs.
        const rows = await fetchService.fetchCollection("notes", { searchString: "lain not" });
        expect(rows.map(r => r.body)).toEqual(["a plain note"]);
    });
});
