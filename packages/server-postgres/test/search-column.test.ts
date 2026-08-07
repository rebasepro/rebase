import { PostgresCollectionConfig } from "@rebasepro/types";
import {
    buildSearchColumnSpec,
    searchColumnDefinition,
    fuzzyColumnDefinition,
    searchIndexStatements,
    searchHelperFunctions,
    SearchConfigError
} from "../src/schema/search-column";

const talents = (search: PostgresCollectionConfig["search"]): PostgresCollectionConfig => ({
    slug: "talents",
    table: "talents",
    name: "Talents",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" },
        location: { type: "string" },
        lead_status: { type: "string", enum: [{ id: "new", label: "New" }] },
        interests: { type: "array", of: { type: "string" } },
        scores: { type: "array", of: { type: "number" } },
        questionnaire: { type: "map", properties: {} },
        legacy_blob: { type: "map", columnType: "json", properties: {} }
    },
    search
});

describe("buildSearchColumnSpec", () => {
    it("returns undefined for a collection that has not opted in", () => {
        expect(buildSearchColumnSpec(talents(undefined))).toBeUndefined();
    });

    it("keeps the author's field order and defaults the weight to B", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["full_name", "location"] }))!;
        expect(spec.fields.map(f => f.path)).toEqual(["full_name", "location"]);
        expect(spec.fields.map(f => f.weight)).toEqual(["B", "B"]);
    });

    it("defaults to the `simple` config, which does not stem", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
        expect(spec.language).toBe("simple");
        expect(spec.expression).toContain("to_tsvector('simple'");
    });

    it("reads a plain string column directly", () => {
        const spec = buildSearchColumnSpec(talents({ fields: [{ path: "full_name", weight: "A" }] }))!;
        expect(spec.expression).toBe(`setweight(to_tsvector('simple', coalesce("full_name", '')), 'A')`);
    });

    it("routes a string[] through the array helper, since array_to_string is not immutable", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["interests"] }))!;
        expect(spec.expression).toContain(`public.rebase_search_text(coalesce("interests", '{}'::text[]))`);
    });

    it("addresses a single JSONB key with -> and a deep path with #>", () => {
        const shallow = buildSearchColumnSpec(talents({ fields: ["questionnaire.certifications"] }))!;
        expect(shallow.expression).toContain(`"questionnaire" -> 'certifications'`);

        const deep = buildSearchColumnSpec(talents({ fields: ["questionnaire.a.b"] }))!;
        expect(deep.expression).toContain(`"questionnaire" #> '{a,b}'`);
    });

    it("indexes a whole map when the path names no key inside it", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["questionnaire"] }))!;
        expect(spec.expression).toContain(`public.rebase_search_text(coalesce("questionnaire", '{}'::jsonb))`);
    });

    it("wraps every field in the unaccent helper when asked, and only then", () => {
        const off = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
        expect(off.expression).not.toContain("rebase_search_unaccent");
        expect(off.extensions).toEqual([]);

        const on = buildSearchColumnSpec(talents({ fields: ["full_name"], unaccent: true }))!;
        expect(on.expression).toContain(`public.rebase_search_unaccent(coalesce("full_name", ''))`);
        expect(on.extensions).toEqual(["unaccent"]);
    });

    it("concatenates fields with || so weights survive into one vector", () => {
        const spec = buildSearchColumnSpec(talents({
            fields: [{ path: "full_name", weight: "A" }, { path: "location", weight: "C" }]
        }))!;
        expect(spec.expression.split(" || ")).toHaveLength(2);
        expect(spec.expression).toContain("'A')");
        expect(spec.expression).toContain("'C')");
    });

    it("names the column and index deterministically", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
        expect(spec.column).toBe("search_vector");
        expect(spec.indexName).toBe("talents_search_vector_gin");
    });

    it("truncates a generated index name to Postgres's 63-byte limit", () => {
        const long = "t".repeat(80);
        const spec = buildSearchColumnSpec({
            ...talents({ fields: ["full_name"] }),
            table: long
        })!;
        expect(Buffer.from(spec.indexName, "utf8").byteLength).toBeLessThanOrEqual(63);
    });

    describe("refuses configurations it cannot honour", () => {
        it("rejects an unknown property rather than dropping it", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["nope"] })))
                .toThrow(/does not declare/);
        });

        it("rejects an enum, pointing at `where` instead", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["lead_status"] })))
                .toThrow(/fixed vocabulary/);
        });

        it("rejects a uuid column", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["id"] })))
                .toThrow(/UUID/);
        });

        it("rejects a json (not jsonb) column, naming the immutability reason", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["legacy_blob"] })))
                .toThrow(/not immutable/);
        });

        it("rejects an array that carries no text", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["scores"] })))
                .toThrow(/numbers or booleans/);
        });

        it("rejects a path inside a non-map property", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["full_name.nested"] })))
                .toThrow(/not a `map`/);
        });

        it("rejects an empty field list", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: [] })))
                .toThrow(/is empty/);
        });

        it("rejects a duplicate path", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["full_name", "full_name"] })))
                .toThrow(/listed twice/);
        });

        it("rejects a generated column that would collide with a declared property", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["full_name"], column: "location" })))
                .toThrow(/collides/);
        });

        it("throws SearchConfigError, so boot can report it as a config fault", () => {
            expect(() => buildSearchColumnSpec(talents({ fields: ["nope"] })))
                .toThrow(SearchConfigError);
        });
    });
});

describe("rendered SQL", () => {
    it("emits a stored generated column", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
        expect(searchColumnDefinition(spec))
            .toBe(`"search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("full_name", '')), 'B')) STORED`);
    });

    it("emits a GIN index on the tsvector", () => {
        const spec = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
        expect(searchIndexStatements(spec)[0])
            .toContain(`USING GIN ("search_vector")`);
    });

    it("always declares both text helpers, and unaccent only when used", () => {
        const plain = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
        expect(searchHelperFunctions(plain)).toHaveLength(2);

        const accented = buildSearchColumnSpec(talents({ fields: ["full_name"], unaccent: true }))!;
        const fns = searchHelperFunctions(accented);
        expect(fns).toHaveLength(3);
        expect(fns[2]).toContain("regdictionary");
    });

    describe("fuzzy", () => {
        it("adds no second column unless asked", () => {
            const spec = buildSearchColumnSpec(talents({ fields: ["full_name"] }))!;
            expect(spec.fuzzy).toBeUndefined();
            expect(fuzzyColumnDefinition(spec)).toBeUndefined();
        });

        it("adds a text column and a trigram index when asked", () => {
            const spec = buildSearchColumnSpec(talents({ fields: ["full_name", "location"], fuzzy: true }))!;
            expect(spec.fuzzy!.column).toBe("search_vector_text");
            expect(spec.extensions).toContain("pg_trgm");
            expect(fuzzyColumnDefinition(spec)).toContain("text GENERATED ALWAYS AS");
            expect(searchIndexStatements(spec)[1]).toContain("gin_trgm_ops");
        });

        it("separates fields with a space so no trigram spans two of them", () => {
            const spec = buildSearchColumnSpec(talents({ fields: ["full_name", "location"], fuzzy: true }))!;
            expect(spec.fuzzy!.expression).toContain(`|| ' ' ||`);
        });

        it("defaults the similarity floor to 0.3", () => {
            const spec = buildSearchColumnSpec(talents({ fields: ["full_name"], fuzzy: true }))!;
            expect(spec.fuzzy!.threshold).toBe(0.3);
        });
    });
});
