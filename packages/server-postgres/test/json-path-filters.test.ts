import { describe, expect, it } from "@jest/globals";
import { SQL } from "drizzle-orm";
import { integer, jsonb, pgTable, PgDialect, serial, varchar } from "drizzle-orm/pg-core";
import { ApiError } from "@rebasepro/server";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

/**
 * Filtering *inside* a jsonb column — `?metadata->>country=eq.US`.
 *
 * Rebase has had jsonb columns since it had columns, and no way to ask a
 * question about what is in one: a filter could compare the whole document and
 * nothing else, so "orders whose metadata says the country is US" meant a
 * custom function or reading the table into the app.
 *
 * Two things carry the feature and neither is the SQL:
 *
 *  - **the path is bound, not interpolated.** It comes from a query string. The
 *    rendered SQL below is asserted to contain placeholders and the path to
 *    appear among the *parameters*, because a builder that concatenated it
 *    would produce output that looks perfectly correct in every honest test.
 *  - **the filter value picks the comparison.** `->>` yields text, so `["<",
 *    100]` compared as text puts "9" above "100"; casting unconditionally turns
 *    any row holding a string into `invalid input syntax for type numeric`,
 *    which is a 500 caused by data rather than by the request.
 */

const orders = pgTable("orders", {
    id: serial("id").primaryKey(),
    total: integer("total"),
    title: varchar("title"),
    metadata: jsonb("metadata")
});

const dialect = new PgDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);

/** The one condition a filter compiles to. */
function compile(filter: Record<string, unknown>): SQL {
    const conditions = DrizzleConditionBuilder.buildFilterConditions(filter as never, orders, "orders");
    expect(conditions).toHaveLength(1);
    return conditions[0];
}

describe("a path into a jsonb column", () => {
    it("compiles to a text extraction", () => {
        const { sql } = render(compile({ "metadata->>country": ["==", "US"] }));

        expect(sql).toContain("->>");
    });

    it("binds the path rather than interpolating it", () => {
        // The security property. A builder that concatenated the path would
        // pass every test above this one.
        const { sql, params } = render(compile({ "metadata->>country": ["==", "US"] }));

        expect(params).toContain("country");
        expect(sql).not.toContain("country");
    });

    it("walks a nested path with -> and takes the leaf with ->>", () => {
        const { sql, params } = render(compile({ "metadata->address->>city": ["==", "Berlin"] }));

        expect(sql).toContain("->");
        expect(sql).toContain("->>");
        expect(params).toEqual(expect.arrayContaining(["address", "city", "Berlin"]));
    });

    it("accepts ->> at every step, since people write it out of habit", () => {
        const { params } = render(compile({ "metadata->>address->>city": ["==", "Berlin"] }));

        expect(params).toEqual(expect.arrayContaining(["address", "city"]));
    });

    it("survives a path segment that looks like SQL", () => {
        const nasty = "'; DROP TABLE orders; --";
        const { sql, params } = render(compile({ [`metadata->>${nasty}`]: ["==", "x"] }));

        expect(params).toContain(nasty);
        expect(sql).not.toContain("DROP TABLE");
    });
});

describe("operators on a path", () => {
    it("supports equality, including against null", () => {
        expect(render(compile({ "metadata->>country": ["==", null] })).sql).toContain("IS NULL");
        expect(render(compile({ "metadata->>country": ["!=", null] })).sql).toContain("IS NOT NULL");
    });

    it("supports pattern matching", () => {
        expect(render(compile({ "metadata->>country": ["ilike", "u%"] })).sql).toContain("ILIKE");
        expect(render(compile({ "metadata->>country": ["not-like", "u%"] })).sql).toContain("NOT LIKE");
    });

    it("supports membership", () => {
        const { sql, params } = render(compile({ "metadata->>country": ["in", ["US", "DE"]] }));

        expect(sql).toContain("IN");
        expect(params).toEqual(expect.arrayContaining(["US", "DE"]));
    });

    it("refuses an empty `in` by matching nothing, not everything", () => {
        // The inversion this codebase keeps finding: dropping the condition
        // widens the read to the whole table.
        expect(render(compile({ "metadata->>country": ["in", []] })).sql).toContain("FALSE");
        expect(render(compile({ "metadata->>country": ["not-in", []] })).sql).toContain("TRUE");
    });

    it("renders a boolean the way ->> renders it", () => {
        // `->>` gives back the text "true", never a SQL boolean.
        const { params } = render(compile({ "metadata->>verified": ["==", true] }));

        expect(params).toContain("true");
    });

    it("refuses an operator that is about the column rather than a value in it", () => {
        expect(() => compile({ "metadata->>tags": ["array-contains", "x"] })).toThrow(ApiError);
    });
});

describe("comparing numbers", () => {
    it("casts to numeric so 9 is not greater than 100", () => {
        const { sql } = render(compile({ "metadata->>score": [">", 100] }));

        expect(sql).toContain("numeric");
    });

    it("excludes rows whose value is not a number rather than failing the query", () => {
        // Without the guard this is `invalid input syntax for type numeric` —
        // a 500 caused by one row's data, on a request that is not wrong.
        const { sql } = render(compile({ "metadata->>score": ["<", 100] }));

        expect(sql).toContain("CASE WHEN");
        expect(sql).toContain("~");
    });

    it("still compares as text when the value is a string", () => {
        const { sql } = render(compile({ "metadata->>version": [">", "1.2"] }));

        expect(sql).not.toContain("numeric");
    });
});

describe("what is not a JSON path", () => {
    it("leaves an ordinary column filter exactly as it was", () => {
        const { sql, params } = render(compile({ total: [">", 10] }));

        expect(sql).not.toContain("->>");
        expect(params).toContain(10);
    });

    it("refuses a path into a column that is not json", () => {
        // `->>` on a varchar is a Postgres error at execution time, which
        // reaches the caller as a 500 on a request whose only fault is a typo.
        expect(() => compile({ "title->>x": ["==", "y"] })).toThrow(ApiError);
        expect(() => compile({ "title->>x": ["==", "y"] })).toThrow(/not a json or jsonb column/);
    });

    it("treats a path into an unknown column as an unknown field, not a JSON path", () => {
        const conditions = DrizzleConditionBuilder.buildFilterConditions(
            { "nope->>x": ["==", "y"] } as never, orders, "orders", { unknownFields: "warn" }
        );

        expect(conditions).toHaveLength(0);
    });
});
