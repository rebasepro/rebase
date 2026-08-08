/**
 * A `search` block that changes after its column exists must not be inert.
 *
 * Every writer of the generated column is additive — `addColumn` returns early
 * when the name is present, and `search.sql` emits `ADD COLUMN IF NOT EXISTS` —
 * so adding a field, flipping `unaccent`, changing the language or moving a
 * weight produced no statement anywhere. Boot logged nothing, `db push` planned
 * nothing, and the column kept indexing the previous field set forever. The
 * symptom is a search that returns nothing for content plainly in the row,
 * which from outside is indistinguishable from "no such record".
 *
 * The comparison is a fingerprint recorded in the column's comment rather than
 * the stored generation expression: Postgres hands that expression back
 * deparsed — casts made explicit, identifiers requoted — so comparing text
 * would report drift on wording, and this comparison decides whether a boot
 * refuses.
 */
import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import {
    planCollectionSchemaEnsure,
    ensureCollectionTables,
    type ExistingSchema
} from "../src/schema/ensure-collection-tables";
import { generatePostgresSearchDdl } from "../src/schema/generate-postgres-ddl-logic";
import { buildSearchColumnSpec, searchColumnStamps } from "../src/schema/search-column";

const talents = (fields: string[], extra: Partial<PostgresCollectionConfig["search"]> = {}): PostgresCollectionConfig => ({
    slug: "talents",
    table: "talents",
    name: "Talents",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" },
        headline: { type: "string" }
    },
    search: { fields, ...extra } as PostgresCollectionConfig["search"]
});

const before = talents(["full_name"]);
const after = talents(["full_name", "headline"]);

const stampOf = (collection: CollectionConfig): string =>
    searchColumnStamps(buildSearchColumnSpec(collection)!)[0].fingerprint;

/** A database that already has the table, the column, and a given stamp. */
const withColumn = (stamp?: string): ExistingSchema => ({
    tables: new Map([["public.talents", new Set(["id", "full_name", "headline", "search_vector"])]]),
    enums: new Set<string>(),
    constraints: new Set<string>(),
    columnComments: stamp
        ? new Map([["public.talents.search_vector", stamp]])
        : new Map<string, string>()
});

const empty = (): ExistingSchema => ({
    tables: new Map(),
    enums: new Set(),
    constraints: new Set(),
    columnComments: new Map()
});

describe("drift between the block and the column it built", () => {
    it("is reported when the recorded fingerprint is another block's", () => {
        const plan = planCollectionSchemaEnsure([after], withColumn(stampOf(before)));

        expect(plan.searchDrift).toHaveLength(1);
        expect(plan.searchDrift[0]).toMatchObject({
            table: "public.talents",
            column: "search_vector",
            found: stampOf(before),
            expected: stampOf(after)
        });
    });

    it("is not reported when the block is unchanged", () => {
        const plan = planCollectionSchemaEnsure([after], withColumn(stampOf(after)));

        expect(plan.searchDrift).toEqual([]);
        // And nothing is re-stamped: the comment already says the right thing.
        expect(plan.actions.filter(a => a.kind === "comment-column")).toEqual([]);
    });

    it("hands the operator the statements that resolve it", () => {
        const [drift] = planCollectionSchemaEnsure([after], withColumn(stampOf(before))).searchDrift;

        expect(drift.rebuild[0]).toBe(`ALTER TABLE "public"."talents" DROP COLUMN "search_vector";`);
        expect(drift.rebuild[1]).toContain("ADD COLUMN \"search_vector\" tsvector GENERATED ALWAYS AS (");
        expect(drift.rebuild[1]).toContain("headline");
        expect(drift.rebuild[2]).toContain("COMMENT ON COLUMN");
    });

    it("keeps the old stamp, since it is the only evidence of what the column holds", () => {
        const plan = planCollectionSchemaEnsure([after], withColumn(stampOf(before)));

        expect(plan.actions.filter(a => a.kind === "comment-column")).toEqual([]);
    });

    it("refuses to apply the plan, naming the column and the cost", async () => {
        // A database that answers the four catalogue reads `readExistingSchema`
        // makes: it has the table, the column, and a stamp from the old block.
        const applied: string[] = [];
        const client = {
            query: jest.fn(async (sql: string) => {
                if (sql.includes("information_schema.columns")) {
                    return {
                        rows: ["id", "full_name", "headline", "search_vector"].map(column_name => ({
                            table_schema: "public", table_name: "talents", column_name
                        }))
                    };
                }
                if (sql.includes("pg_description")) {
                    return {
                        rows: [{
                            schema: "public", table: "talents", column: "search_vector",
                            comment: stampOf(before)
                        }]
                    };
                }
                applied.push(sql);
                return { rows: [] };
            })
        };

        await expect(ensureCollectionTables(client as never, [after]))
            .rejects.toThrow(/search_vector/);
        await expect(ensureCollectionTables(client as never, [after]))
            .rejects.toThrow(/ACCESS EXCLUSIVE/);
        // Nothing was applied: the refusal happens before the first statement.
        expect(applied.filter(sql => /^(ALTER|CREATE|COMMENT)/.test(sql))).toEqual([]);
    });
});

describe("stamping", () => {
    it("stamps a column it creates", () => {
        const plan = planCollectionSchemaEnsure([after], empty());
        const comment = plan.actions.find(a => a.kind === "comment-column");

        expect(comment!.sql).toContain(`COMMENT ON COLUMN "public"."talents"."search_vector" IS '${stampOf(after)}'`);
        // After the column, or it comments a column that does not exist yet.
        expect(plan.actions.indexOf(comment!))
            .toBeGreaterThan(plan.actions.findIndex(a => a.target === "public.talents.search_vector" && a.kind === "add-column"));
    });

    it("adopts an unstamped column and says so, rather than assuming it matches", () => {
        const plan = planCollectionSchemaEnsure([after], withColumn(undefined));

        expect(plan.searchDrift).toEqual([]);
        expect(plan.searchAdopted).toEqual([{ table: "public.talents", column: "search_vector" }]);
        expect(plan.actions.some(a => a.kind === "comment-column")).toBe(true);
    });

    it("fingerprints the fuzzy column separately, so turning `fuzzy` on is not drift", () => {
        const fuzzy = talents(["full_name"], { fuzzy: true });
        const plan = planCollectionSchemaEnsure([fuzzy], withColumn(stampOf(before)));

        // Same tsvector expression, second column added beside it: additive,
        // and a spec-wide fingerprint would have refused the boot over it.
        expect(plan.searchDrift).toEqual([]);
        expect(plan.actions.some(a => a.target === "public.talents.search_vector_text")).toBe(true);
    });
});

describe("the generated search.sql", () => {
    it("refuses before altering anything when the database disagrees", () => {
        const sql = generatePostgresSearchDdl([after]);

        expect(sql).toContain("RAISE EXCEPTION");
        expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(sql.indexOf("ADD COLUMN IF NOT EXISTS"));
        expect(sql).toContain(stampOf(after));
    });

    it("stamps what it adds, so the next run can compare", () => {
        const sql = generatePostgresSearchDdl([after]);

        expect(sql).toContain(`COMMENT ON COLUMN "public"."talents"."search_vector" IS '${stampOf(after)}';`);
    });

    it("changes the fingerprint when the block changes", () => {
        expect(stampOf(before)).not.toBe(stampOf(after));
        expect(stampOf(talents(["full_name"], { unaccent: true }))).not.toBe(stampOf(before));
        expect(stampOf(talents(["full_name"], { language: "spanish" }))).not.toBe(stampOf(before));
        expect(stampOf(talents([{ path: "full_name", weight: "A" } as never]))).not.toBe(stampOf(before));
    });
});
