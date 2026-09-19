/**
 * A search box searches the row, not each column separately.
 *
 * Reported from the field: on a customers collection with `first_name` and
 * `last_name`, searching `sebastian melendez` returned nothing. The fallback
 * path — every collection that has not declared a `search` block — compiled one
 * `ILIKE '%sebastian melendez%'` per column, and no column holds both words.
 * Typing `sebastian ` returned nothing either, because the trailing space was
 * part of the pattern.
 *
 * Both are the same bug: the typed string was treated as one literal needle.
 * The fix splits it into terms, ORs the columns within each term and ANDs the
 * terms — which is what `websearch_to_tsquery` already does for a collection
 * that did declare the block, so the two paths now answer the same question.
 */
import { CollectionConfig } from "@rebasepro/types";
import { pgTable, PgDialect, text, uuid } from "drizzle-orm/pg-core";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

const customers = pgTable("customers", {
    id: uuid("id").primaryKey(),
    first_name: text("first_name"),
    last_name: text("last_name"),
    email: text("email")
});

const collection: CollectionConfig = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: {
        id: { type: "string", isId: "uuid" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" }
    },
    idField: "id"
};

const compile = (searchString: string) => {
    const conditions = DrizzleConditionBuilder.buildSearchConditions(
        searchString, collection.properties, customers, collection
    );
    expect(conditions).toHaveLength(1);
    const { sql, params } = new PgDialect().sqlToQuery(conditions[0]);
    return { sql, params: params.map(String) };
};

describe("the ILIKE fallback across several fields", () => {
    it("finds a name whose halves live in different columns", () => {
        const { sql, params } = compile("sebastian melendez");

        // Two terms, each offered every searchable column.
        expect(params).toEqual([
            "%sebastian%", "%sebastian%", "%sebastian%",
            "%melendez%", "%melendez%", "%melendez%"
        ]);
        // OR within a term, AND between them — the other way round matches
        // every row with either word in it.
        expect(sql).toContain(" and ");
        expect(sql).toContain(" or ");
        expect(sql.indexOf(" and ")).toBeGreaterThan(sql.indexOf(" or "));
    });

    it("ignores the space a user leaves after a word", () => {
        expect(compile("sebastian ").params).toEqual([
            "%sebastian%", "%sebastian%", "%sebastian%"
        ]);
    });

    it("searches a quoted phrase as one term", () => {
        expect(compile("\"sebastian melendez\"").params).toEqual([
            "%sebastian melendez%", "%sebastian melendez%", "%sebastian melendez%"
        ]);
    });

    it("compiles a one-word search exactly as it always did", () => {
        const { sql, params } = compile("sebastian");
        expect(params).toEqual(["%sebastian%", "%sebastian%", "%sebastian%"]);
        expect(sql).not.toContain(" and ");
    });

    it("never searches the uuid id column, which cannot be ILIKE'd", () => {
        expect(compile("sebastian").sql).not.toContain("\"id\"");
    });

    it("matches nothing when the collection has no searchable column", () => {
        const idOnly: CollectionConfig = {
            ...collection,
            properties: { id: { type: "string", isId: "uuid" } }
        };
        expect(DrizzleConditionBuilder.buildSearchConditions(
            "sebastian melendez", idOnly.properties, customers, idOnly
        )).toEqual([]);
    });
});
