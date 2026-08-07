/**
 * The opt-in search block, against a real Postgres.
 *
 * Everything else about this feature is checked by comparing strings. This is
 * the only test that answers the question that matters: does the SQL those
 * strings contain actually create a working, matching, ranked search?
 *
 * It matters more than usual here because the constraint the whole design turns
 * on — that a `GENERATED ALWAYS AS … STORED` expression must be strictly
 * IMMUTABLE — is not visible to any amount of static reasoning. `unaccent`,
 * `array_to_string` and casting `text[]` to `text` all look fine and are all
 * rejected by the server.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { PostgresCollectionConfig, CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup";
import { generatePostgresDdl } from "../../src/schema/generate-postgres-ddl-logic";
import { buildSearchColumnSpec } from "../../src/schema/search-column";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Talents",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" },
        professional_objective: { type: "string" },
        interests: { type: "array", of: { type: "string" } },
        questionnaire: { type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fuzzy: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "professional_objective", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};

const spec = buildSearchColumnSpec(talents)!;

/** The query the condition builder compiles, as parameterized SQL. */
const MATCH = `"${spec.column}" @@ websearch_to_tsquery('spanish', public.rebase_search_unaccent($1))`;
const RANK = `ts_rank("${spec.column}", websearch_to_tsquery('spanish', public.rebase_search_unaccent($1)))`;

describe("opt-in full-text search, end to end", () => {
    let container: PgContainer;
    let client: pg.Client;

    beforeAll(async () => {
        container = await startPgContainer();
        client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();

        // Exactly what `rebase db push` would write — no hand-edits.
        const ddl = await generatePostgresDdl([talents as CollectionConfig], { includePolicies: false });
        await client.query(ddl);

        await client.query(`
            INSERT INTO talents (full_name, professional_objective, interests, questionnaire) VALUES
            ('Ana Gutiérrez', 'Auditoría de sistemas de gestión ambiental', ARRAY['gestión ambiental'],
             '{"certifications":["ISO 14001 Lead Auditor","GRI Standards"],"degree":["Ingeniería Ambiental"]}'::jsonb),
            ('Beatriz Soler', 'Especialista en economía circular', ARRAY['residuos'],
             '{"certifications":[{"name":"Verificador de huella de carbono","level":"advanced"}],
               "career_motivation":"Impacto climático"}'::jsonb),
            ('Carlos Marketing', 'Growth y performance', ARRAY['ads'],
             '{"certifications":["Google Ads"]}'::jsonb)
        `);
    }, 180_000);

    afterAll(async () => {
        await client?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("creates the generated column and its GIN index", async () => {
        const columns = await client.query(
            `SELECT column_name, is_generated, udt_name FROM information_schema.columns
             WHERE table_name='talents' AND column_name IN ($1,$2)`,
            [spec.column, spec.fuzzy!.column]
        );
        expect(columns.rows).toHaveLength(2);
        expect(columns.rows.every(r => r.is_generated === "ALWAYS")).toBe(true);
        expect(columns.rows.find(r => r.column_name === spec.column)!.udt_name).toBe("tsvector");

        const indexes = await client.query(
            "SELECT indexname FROM pg_indexes WHERE tablename='talents'"
        );
        const names = indexes.rows.map(r => r.indexname);
        expect(names).toContain(spec.indexName);
        expect(names).toContain(spec.fuzzy!.indexName);
    });

    it("refuses a direct write to the generated column", async () => {
        await expect(
            client.query(`UPDATE talents SET "${spec.column}" = to_tsvector('simple','forged')`)
        ).rejects.toThrow(/can only be updated to DEFAULT|generated column/i);
    });

    it("reaches inside JSONB — the thing ILIKE could never do", async () => {
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["ISO 14001"]);
        expect(rows.map(r => r.full_name)).toEqual(["Ana Gutiérrez"]);
    });

    it("walks the whole subtree under the declared path — objects, not just strings", async () => {
        // `certifications` holds objects here, not bare strings. Every string
        // leaf below the declared path is indexed, at any depth.
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["huella de carbono"]);
        expect(rows.map(r => r.full_name)).toEqual(["Beatriz Soler"]);
    });

    it("indexes only the declared path, not the whole document", async () => {
        // `career_motivation` sits beside `certifications` in the same JSONB
        // column and is not named in `fields`. A path that did not actually
        // narrow would match here, and nothing else in this file would notice.
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["climático"]);
        expect(rows).toHaveLength(0);
    });

    it("indexes values, never JSON keys", async () => {
        // Every row's questionnaire has a `certifications` key. If keys were
        // indexed, this would match all three.
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["certifications"]);
        expect(rows).toHaveLength(0);
    });

    it("reaches text[] elements", async () => {
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["residuos"]);
        expect(rows.map(r => r.full_name)).toEqual(["Beatriz Soler"]);
    });

    it("matches without accents what was written with them", async () => {
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["auditoria"]);
        expect(rows.map(r => r.full_name)).toEqual(["Ana Gutiérrez"]);
    });

    it("matches with accents what was written without them", async () => {
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["gutierrez"]);
        expect(rows.map(r => r.full_name)).toEqual(["Ana Gutiérrez"]);
    });

    it("drops stopwords and ANDs the remaining terms", async () => {
        // "de" is a Spanish stopword; the other two must both be present.
        const hit = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["auditoria de gestion"]);
        expect(hit.rows).toHaveLength(1);

        const miss = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["auditoria de marketing"]);
        expect(miss.rows).toHaveLength(0);
    });

    it("stems, so a plural query finds a singular row", async () => {
        const { rows } = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["auditorias"]);
        expect(rows.map(r => r.full_name)).toEqual(["Ana Gutiérrez"]);
    });

    it("ranks a name hit above a description hit, per the declared weights", async () => {
        // "ambiental" appears in Ana's objective (weight D) and in her
        // interests (weight B). Beatriz has neither.
        const { rows } = await client.query(
            `SELECT full_name, ${RANK} AS score FROM talents WHERE ${MATCH} ORDER BY score DESC`,
            ["ambiental"]
        );
        expect(rows[0].full_name).toBe("Ana Gutiérrez");
        expect(Number(rows[0].score)).toBeGreaterThan(0);
    });

    it("weights an A field above a D field for the same term", async () => {
        const a = await client.query(`SELECT ${RANK} AS s FROM talents WHERE full_name='Carlos Marketing'`, ["Carlos"]);
        const d = await client.query(`SELECT ${RANK} AS s FROM talents WHERE full_name='Carlos Marketing'`, ["Growth"]);
        expect(Number(a.rows[0].s)).toBeGreaterThan(Number(d.rows[0].s));
    });

    it("finds ISO 14001 from the typo'd `iso14000`, via trigram similarity", async () => {
        // The exact path cannot: `iso14000` and `iso14001` are different
        // lexemes and no stemmer bridges them. This is what `fuzzy` buys.
        const exact = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["iso14000"]);
        expect(exact.rows).toHaveLength(0);

        const fuzzy = await client.query(
            `SELECT full_name, public.word_similarity(public.rebase_search_unaccent($1), "${spec.fuzzy!.column}") AS sim
             FROM talents
             WHERE public.word_similarity(public.rebase_search_unaccent($1), "${spec.fuzzy!.column}") >= $2
             ORDER BY sim DESC`,
            ["iso14000", spec.fuzzy!.threshold]
        );
        expect(fuzzy.rows[0]?.full_name).toBe("Ana Gutiérrez");
    });

    it("recomputes the column when the row changes, so the index cannot go stale", async () => {
        await client.query(
            `UPDATE talents SET questionnaire = '{"certifications":["EMAS Verifier"]}'::jsonb WHERE full_name='Carlos Marketing'`
        );
        const now = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["EMAS"]);
        expect(now.rows.map(r => r.full_name)).toEqual(["Carlos Marketing"]);

        const gone = await client.query(`SELECT full_name FROM talents WHERE ${MATCH}`, ["Google Ads"]);
        expect(gone.rows).toHaveLength(0);
    });

    it("uses the GIN index rather than scanning", async () => {
        // Postgres will not choose an index on three rows, so this asks the
        // planner directly with sequential scans disabled — the point is that
        // the index is *usable* for this predicate, not that it is chosen here.
        await client.query("SET enable_seqscan = off");
        const plan = await client.query(
            `EXPLAIN (FORMAT JSON) SELECT full_name FROM talents WHERE ${MATCH}`,
            ["auditoria"]
        );
        await client.query("SET enable_seqscan = on");
        expect(JSON.stringify(plan.rows[0])).toContain(spec.indexName);
    });
});

describe("a collection that did not opt in", () => {
    it("produces DDL with no search objects at all", async () => {
        const plain: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" } }
        };
        const ddl = await generatePostgresDdl([plain], { includePolicies: false });
        expect(ddl).not.toContain("tsvector");
        expect(ddl).not.toContain("rebase_search");
    });
});
