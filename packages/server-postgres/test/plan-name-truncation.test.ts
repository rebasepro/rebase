/**
 * Tables, junction tables and enum types share one namespace per schema, and
 * Postgres keeps 63 bytes of each name. Distinct in full, one after truncation:
 * the push failed with `type "…" already exists` and nothing said why.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { planCollections } from "./helpers/plan-tables";

const LONG = "a_table_with_a_really_long_name_that_goes_on_and_on_and_on_forever"; // 66 bytes

const tags: CollectionConfig = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { id: { type: "string", isId: "uuid" } }
};

const longOne = (withEnum: boolean): CollectionConfig => ({
    slug: "long_one",
    table: LONG,
    name: "Long",
    properties: {
        id: { type: "string", isId: "uuid" },
        ...(withEnum ? { status: { type: "string", enum: [{ id: "a", label: "A" }] } } : {})
    }
});

describe("derived names that collide only after Postgres truncates them", () => {
    it("refuses a table whose enum type truncates onto the table itself, naming the 63-byte limit", () => {
        expect(() => planCollections([longOne(true)])).toThrow(/keeps only the first 63 bytes/);
    });

    it("refuses two tables that share their first 63 bytes", () => {
        const twin = { ...longOne(false), slug: "long_two", table: `${LONG}_two` } as CollectionConfig;
        expect(() => planCollections([longOne(false), twin])).toThrow(/both become/);
    });

    it("leaves a long name that collides with nothing alone", () => {
        expect(() => planCollections([longOne(false), tags])).not.toThrow();
    });
});
