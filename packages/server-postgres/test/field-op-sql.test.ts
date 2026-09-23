import { describe, expect, it } from "@jest/globals";
import { pgTable, text, integer, jsonb, json, boolean } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Properties } from "@rebasepro/types";
import { compileFieldOp, compileFieldOpBounds, compileFieldOps } from "../src/services/field-op-sql";

/**
 * What a field operation becomes, in SQL.
 *
 * The contract — which operators exist and which property types they are legal
 * on — is `@rebasepro/server`'s and is tested there. What only this layer can
 * decide is the *statement*, and the reason it has to decide it is that an
 * `array` property is a native `text[]` on one collection and a jsonb document
 * on the next (see the DDL generator's `array` arm). Compiling from the
 * property type alone would emit `array_append` against a jsonb column, which
 * Postgres rejects at plan time with a function-does-not-exist error naming
 * neither the collection nor the field.
 *
 * Every expression is NULL-safe, and that is not decoration: `NULL + 1` is
 * `NULL`, so a counter incremented from an unset column would empty itself.
 */

const dialect = new PgDialect();

const table = pgTable("posts", {
    views: integer("views"),
    tags: text("tags").array(),
    jsonTags: jsonb("json_tags"),
    legacyTags: json("legacy_tags"),
    meta: jsonb("meta"),
    legacyMeta: json("legacy_meta"),
    published: boolean("published")
});

const context = { collectionPath: "posts" };

/** The statement text, with parameters inlined enough to read. */
const render = (field: string, operator: string, operand: unknown): string => {
    const query = dialect.sqlToQuery(
        compileFieldOp(table, field, { operator: operator as never, operand }, context)
    );
    return query.sql;
};

const paramsOf = (field: string, operator: string, operand: unknown): unknown[] =>
    dialect.sqlToQuery(
        compileFieldOp(table, field, { operator: operator as never, operand }, context)
    ).params;

describe("$inc", () => {
    it("adds to the column inside the statement, not to a value read earlier", () => {
        // The point of the whole feature: the arithmetic happens where the row
        // lock already is, so two concurrent increments cannot both read 4.
        expect(render("views", "$inc", 1)).toContain('"posts"."views"');
        expect(render("views", "$inc", 1)).toMatch(/COALESCE\("posts"\."views", 0\) \+ \$1/);
        expect(paramsOf("views", "$inc", 1)).toEqual([1]);
    });

    it("coalesces, so the first increment of an unset column is not NULL", () => {
        expect(render("views", "$inc", 1)).toContain("COALESCE");
    });

    it("subtracts with a negative operand rather than a second operator", () => {
        expect(paramsOf("views", "$inc", -2)).toEqual([-2]);
    });
});

describe("$push", () => {
    it("uses array_append on a native array column, so the element type is the column's", () => {
        expect(render("tags", "$push", "new")).toMatch(/array_append\("posts"\."tags", \$1\)/);
        expect(paramsOf("tags", "$push", "new")).toEqual(["new"]);
    });

    it("folds a list into nested appends rather than building an array literal", () => {
        // Nested rather than concatenated, so nothing has to name the element
        // type — Postgres infers it from the column at each step.
        const sql = render("tags", "$push", ["a", "b"]);
        expect(sql).toMatch(/array_append\(array_append\("posts"\."tags", \$1\), \$2\)/);
        expect(paramsOf("tags", "$push", ["a", "b"])).toEqual(["a", "b"]);
    });

    it("concatenates jsonb for an array property stored as a document", () => {
        const sql = render("jsonTags", "$push", "new");
        expect(sql).toContain("::jsonb");
        expect(sql).toContain("||");
        expect(sql).toContain("'[]'::jsonb");
        expect(paramsOf("jsonTags", "$push", "new")).toEqual(['["new"]']);
    });

    it("casts the result back for a `json` column, which has no `||`", () => {
        expect(render("legacyTags", "$push", "new")).toMatch(/\)::json$/);
    });

    it("refuses a column that is neither an array nor json", () => {
        expect(() => render("published", "$push", true)).toThrow(/\$push/);
    });
});

describe("$pull", () => {
    it("uses array_remove on a native array column", () => {
        expect(render("tags", "$pull", "old")).toMatch(/array_remove\("posts"\."tags", \$1\)/);
    });

    it("re-aggregates the survivors for a jsonb column, which has no array_remove", () => {
        const sql = render("jsonTags", "$pull", "old");
        expect(sql).toContain("jsonb_array_elements");
        expect(sql).toContain("jsonb_agg");
        // jsonb_agg over an empty set is NULL, so a column losing its last
        // element would come back NULL rather than `[]` without this.
        expect(sql).toContain("'[]'::jsonb");
    });
});

describe("$merge", () => {
    it("is a shallow merge with the jsonb concatenation operator", () => {
        const sql = render("meta", "$merge", { seen: true });
        expect(sql).toMatch(/COALESCE\("posts"\."meta"::jsonb, '\{\}'::jsonb\) \|\| \$1::jsonb/);
        expect(paramsOf("meta", "$merge", { seen: true })).toEqual(['{"seen":true}']);
    });

    it("casts back for a `json` column", () => {
        expect(render("legacyMeta", "$merge", { a: 1 })).toMatch(/\)::json$/);
    });

    it("refuses a column that is not json", () => {
        expect(() => render("views", "$merge", { a: 1 })).toThrow(/\$merge/);
    });
});

describe("compileFieldOpBounds", () => {
    /**
     * The bound a result must keep, as a condition for the UPDATE's WHERE. The
     * behaviour over a real row is pinned in `field-op-bounds.test.ts`; this is
     * the mapping from each declared rule to its comparison.
     */
    const properties = {
        views: { name: "Views", type: "number", validation: { min: 0, max: 10, moreThan: -1, lessThan: 11, positive: true, negative: true } },
        tags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" }, validation: { min: 1, max: 3 } },
        jsonTags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" }, validation: { min: 1, max: 3 } },
        legacyTags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" }, validation: { max: 3 } },
        meta: { name: "Meta", type: "map", properties: {} }
    } as Properties;

    const boundsFor = (field: string, operator: string, operand: unknown) =>
        compileFieldOpBounds(table, { [field]: { operator: operator as never, operand } }, properties, context)
            .map(bound => ({ code: bound.code, sql: dialect.sqlToQuery(bound.holds).sql }));

    it("compares an increment's result with each of a number's rules", () => {
        const result = String.raw`\(COALESCE\("posts"\."views", 0\) \+ \$1\)`;
        expect(boundsFor("views", "$inc", -1)).toEqual([
            { code: "min", sql: expect.stringMatching(new RegExp(`^${result} >= \\$2::numeric$`)) },
            { code: "max", sql: expect.stringMatching(new RegExp(`^${result} <= \\$2::numeric$`)) },
            { code: "more_than", sql: expect.stringMatching(new RegExp(`^${result} > \\$2::numeric$`)) },
            { code: "less_than", sql: expect.stringMatching(new RegExp(`^${result} < \\$2::numeric$`)) },
            { code: "positive", sql: expect.stringMatching(new RegExp(`^${result} > 0$`)) },
            { code: "negative", sql: expect.stringMatching(new RegExp(`^${result} < 0$`)) }
        ]);
    });

    it("counts a native array with cardinality, and a json one through jsonb", () => {
        expect(boundsFor("tags", "$push", "a")).toEqual([
            { code: "min_items", sql: expect.stringMatching(/^COALESCE\(cardinality\(array_append\("posts"\."tags", \$1\)\) >= \$2::numeric, TRUE\)$/) },
            { code: "max_items", sql: expect.stringMatching(/^COALESCE\(cardinality\(array_append\("posts"\."tags", \$1\)\) <= \$2::numeric, TRUE\)$/) }
        ]);
        expect(boundsFor("jsonTags", "$pull", "a").map(bound => bound.sql))
            .toEqual([expect.stringMatching(/^COALESCE\(jsonb_array_length\(\(.*jsonb_agg.*\)::jsonb\) >= \$\d+::numeric, TRUE\)$/s), expect.anything()]);
        expect(boundsFor("legacyTags", "$push", "a")).toEqual([
            { code: "max_items", sql: expect.stringMatching(/^COALESCE\(jsonb_array_length\(\(\(.*\)::json\)::jsonb\) <= \$\d+::numeric, TRUE\)$/s) }
        ]);
    });

    it("has nothing to hold for a property without bounds, or for $merge", () => {
        expect(compileFieldOpBounds(table, {
            views: { operator: "$inc", operand: 1 },
            meta: { operator: "$merge", operand: { a: 1 } }
        }, { views: { name: "Views", type: "number" }, meta: properties.meta } as Properties, context)).toEqual([]);
        expect(boundsFor("meta", "$merge", { a: 1 })).toEqual([]);
    });
});

describe("compileFieldOps", () => {
    it("compiles a whole map, keyed by field", () => {
        const compiled = compileFieldOps(table, {
            views: { operator: "$inc", operand: 1 },
            tags: { operator: "$push", operand: "x" }
        }, context);

        expect(Object.keys(compiled)).toEqual(["views", "tags"]);
    });

    it("names the field when it is not a column of the table", () => {
        // Otherwise the operation is dropped from the statement and the write
        // is answered 200 — the silent-write defect the whole write path is
        // built to refuse.
        expect(() => compileFieldOps(table, {
            nonsense: { operator: "$inc", operand: 1 }
        }, context)).toThrow(/nonsense/);
    });
});
