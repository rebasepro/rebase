import { col, defineTable, type SearchConfig } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import {
    buildTableSearchColumnSpec,
    searchColumnDefinition,
    fuzzyColumnDefinition,
    searchIndexStatements,
    searchHelperFunctions,
    SearchConfigError
} from "../src/schema/search-column";

const talents = (search?: SearchConfig, table?: string) => defineTable("talents", {
    ...(table !== undefined ? { table } : {}),
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        full_name: col.text(),
        location: col.text(),
        lead_status: col.enum(["new"]),
        interests: col.text().array(),
        scores: col.numeric().array(),
        questionnaire: col.jsonb(),
        legacy_blob: col.json()
    },
    ...(search ? { search } : {}),
    rls: "admin-only"
});

/** The search spec the planner builds for the table: compiled, then read from its descriptor. */
const specOf = (search?: SearchConfig, table?: string) =>
    buildTableSearchColumnSpec(compileSchema([talents(search, table)])[0].descriptor);

describe("buildTableSearchColumnSpec", () => {
    it("returns undefined for a table that has not opted in", () => {
        expect(specOf()).toBeUndefined();
    });

    it("keeps the author's field order and defaults the weight to B", () => {
        const spec = specOf({ fields: ["full_name", "location"] })!;
        expect(spec.fields.map(f => f.path)).toEqual(["full_name", "location"]);
        expect(spec.fields.map(f => f.weight)).toEqual(["B", "B"]);
    });

    it("defaults to the `simple` config, which does not stem", () => {
        const spec = specOf({ fields: ["full_name"] })!;
        expect(spec.language).toBe("simple");
        expect(spec.expression).toContain("to_tsvector('simple'");
    });

    it("reads a plain string column directly", () => {
        const spec = specOf({ fields: [{ path: "full_name", weight: "A" }] })!;
        expect(spec.expression).toBe(`setweight(to_tsvector('simple', coalesce("full_name", '')), 'A')`);
    });

    it("routes a string[] through the array helper, since array_to_string is not immutable", () => {
        const spec = specOf({ fields: ["interests"] })!;
        expect(spec.expression).toContain(`public.rebase_search_text(coalesce("interests", '{}'::text[]))`);
    });

    it("addresses a single JSONB key with -> and a deep path with #>", () => {
        const shallow = specOf({ fields: ["questionnaire.certifications"] })!;
        expect(shallow.expression).toContain(`"questionnaire" -> 'certifications'`);

        const deep = specOf({ fields: ["questionnaire.a.b"] })!;
        expect(deep.expression).toContain(`"questionnaire" #> '{a,b}'`);
    });

    it("indexes a whole map when the path names no key inside it", () => {
        const spec = specOf({ fields: ["questionnaire"] })!;
        expect(spec.expression).toContain(`public.rebase_search_text(coalesce("questionnaire", '{}'::jsonb))`);
    });

    it("wraps every field in the unaccent helper when asked, and only then", () => {
        const off = specOf({ fields: ["full_name"] })!;
        expect(off.expression).not.toContain("rebase_search_unaccent");
        expect(off.extensions).toEqual([]);

        const on = specOf({ fields: ["full_name"], unaccent: true })!;
        expect(on.expression).toContain(`public.rebase_search_unaccent(coalesce("full_name", ''))`);
        expect(on.extensions).toEqual(["unaccent"]);
    });

    it("concatenates fields with || so weights survive into one vector", () => {
        const spec = specOf({
            fields: [{ path: "full_name", weight: "A" }, { path: "location", weight: "C" }]
        })!;
        expect(spec.expression.split(" || ")).toHaveLength(2);
        expect(spec.expression).toContain("'A')");
        expect(spec.expression).toContain("'C')");
    });

    it("names the column and index deterministically", () => {
        const spec = specOf({ fields: ["full_name"] })!;
        expect(spec.column).toBe("search_vector");
        expect(spec.indexName).toBe("talents_search_vector_gin");
    });

    it("truncates a generated index name to Postgres's 63-byte limit", () => {
        const long = "t".repeat(60);
        const spec = specOf({ fields: ["full_name"] }, long)!;
        expect(Buffer.from(spec.indexName, "utf8").byteLength).toBeLessThanOrEqual(63);
    });

    describe("refuses configurations it cannot honour", () => {
        it("rejects an unknown column rather than dropping it (the compiler refuses it first)", () => {
            expect(() => specOf({ fields: ["nope"] }))
                .toThrow(/"nope" is no column key of the table/);
        });

        it("rejects an enum, pointing at `where` instead", () => {
            expect(() => specOf({ fields: ["lead_status"] }))
                .toThrow(/fixed vocabulary/);
        });

        it("rejects a uuid column", () => {
            expect(() => specOf({ fields: ["id"] }))
                .toThrow(/UUID/);
        });

        it("rejects a json (not jsonb) column, naming the immutability reason", () => {
            expect(() => specOf({ fields: ["legacy_blob"] }))
                .toThrow(/not immutable/);
        });

        it("rejects an array that carries no text", () => {
            expect(() => specOf({ fields: ["scores"] }))
                .toThrow(/numbers or booleans/);
        });

        it("rejects a path inside a column that is not a JSON document (the compiler refuses it first)", () => {
            expect(() => specOf({ fields: ["full_name.nested"] }))
                .toThrow(/"full_name" is `text`, not a JSON column/);
        });

        it("rejects an empty field list (the compiler refuses it first)", () => {
            expect(() => specOf({ fields: [] }))
                .toThrow(/lists no field/);
        });

        it("rejects a duplicate path", () => {
            expect(() => specOf({ fields: ["full_name", "full_name"] }))
                .toThrow(/listed twice/);
        });

        it("rejects a generated column that would collide with a declared property", () => {
            expect(() => specOf({ fields: ["full_name"], column: "location" }))
                .toThrow(/collides/);
        });

        it("throws SearchConfigError, so boot can report it as a config fault", () => {
            expect(() => specOf({ fields: ["full_name", "full_name"] }))
                .toThrow(SearchConfigError);
        });
    });
});

describe("rendered SQL", () => {
    it("emits a stored generated column", () => {
        const spec = specOf({ fields: ["full_name"] })!;
        expect(searchColumnDefinition(spec))
            .toBe(`"search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("full_name", '')), 'B')) STORED`);
    });

    it("emits a GIN index on the tsvector", () => {
        const spec = specOf({ fields: ["full_name"] })!;
        expect(searchIndexStatements(spec)[0])
            .toContain(`USING GIN ("search_vector")`);
    });

    it("always declares both text helpers, and unaccent only when used", () => {
        const plain = specOf({ fields: ["full_name"] })!;
        expect(searchHelperFunctions(plain)).toHaveLength(2);

        const accented = specOf({ fields: ["full_name"], unaccent: true })!;
        const fns = searchHelperFunctions(accented);
        expect(fns).toHaveLength(3);
        expect(fns[2]).toContain("regdictionary");
    });

    describe("fuzzy", () => {
        it("adds no second column unless asked", () => {
            const spec = specOf({ fields: ["full_name"] })!;
            expect(spec.fuzzy).toBeUndefined();
            expect(fuzzyColumnDefinition(spec)).toBeUndefined();
        });

        it("adds a text column and a trigram index when asked", () => {
            const spec = specOf({ fields: ["full_name", "location"], fuzzy: true })!;
            expect(spec.fuzzy!.column).toBe("search_vector_text");
            expect(spec.extensions).toContain("pg_trgm");
            expect(fuzzyColumnDefinition(spec)).toContain("text GENERATED ALWAYS AS");
            expect(searchIndexStatements(spec)[1]).toContain("gin_trgm_ops");
        });

        it("separates fields with a space so no trigram spans two of them", () => {
            const spec = specOf({ fields: ["full_name", "location"], fuzzy: true })!;
            expect(spec.fuzzy!.expression).toContain(`|| ' ' ||`);
        });

        it("defaults the similarity floor to 0.3", () => {
            const spec = specOf({ fields: ["full_name"], fuzzy: true })!;
            expect(spec.fuzzy!.threshold).toBe(0.3);
        });
    });
});

describe("buildTableSearchColumnSpec", () => {
    const talentsTable = (search?: SearchConfig) => defineTable("talents", {
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            fullName: col.text(),
            location: col.varchar({ length: 120 }),
            leadStatus: col.enum(["new", "won"]),
            interests: col.text().array(),
            scores: col.integer().array(),
            questionnaire: col.jsonb(),
            seenAt: col.timestamp({ withTimezone: true })
        },
        ...(search ? { search } : {}),
        rls: "admin-only"
    });
    const descriptorOf = (search?: SearchConfig) => compileSchema([talentsTable(search)])[0].descriptor;

    it("returns undefined for a table that declares no search", () => {
        expect(buildTableSearchColumnSpec(descriptorOf())).toBeUndefined();
    });

    it("names each field's SQL column, whatever its key", () => {
        const search: SearchConfig = {
            fields: ["fullName", { path: "location", weight: "B" }, "interests", "questionnaire.bio"],
            unaccent: true,
            fuzzy: true
        };
        const fromTable = buildTableSearchColumnSpec(descriptorOf(search))!;
        expect(fromTable.fields.map(field => field.column)).toEqual(["full_name", "location", "interests", "questionnaire"]);
    });

    it("refuses what holds no text, naming the column type", () => {
        expect(() => buildTableSearchColumnSpec(descriptorOf({ fields: ["seenAt"] }))).toThrow(/`timestamptz` column, which holds no text/);
        expect(() => buildTableSearchColumnSpec(descriptorOf({ fields: ["leadStatus"] }))).toThrow(/fixed vocabulary/);
        expect(() => buildTableSearchColumnSpec(descriptorOf({ fields: ["id"] }))).toThrow(/UUID/);
        expect(() => buildTableSearchColumnSpec(descriptorOf({ fields: ["scores"] }))).toThrow(/numbers or booleans/);
    });

    it("refuses a generated column that collides with a declared column's SQL name", () => {
        expect(() => buildTableSearchColumnSpec(descriptorOf({ fields: ["fullName"], column: "full_name" }))).toThrow(/collides/);
    });
});
