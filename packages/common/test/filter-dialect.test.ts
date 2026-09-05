import { describe, it, expect } from "@jest/globals";
import {
    serializeFilter,
    deserializeFilter,
    serializeLogicalCondition,
    deserializeLogicalCondition
} from "../src/data/filter-dialect";
import { EntityRelation } from "@rebasepro/types";
import type { WhereFilterOp, FilterValues } from "@rebasepro/types";

// ---------------------------------------------------------------------------
// Helper: round-trip assertion
// ---------------------------------------------------------------------------
function assertRoundTrip(filter: FilterValues<string>): void {
    const serialized = serializeFilter(filter);
    const deserialized = deserializeFilter(serialized);
    expect(deserialized).toEqual(filter);
}

// ---------------------------------------------------------------------------
// 1. Basic serialize / deserialize
// ---------------------------------------------------------------------------
describe("serializeFilter", () => {
    it("serializes a simple equality condition", () => {
        const result = serializeFilter({ status: ["==", "active"] });
        expect(result).toEqual({ status: "eq.active" });
    });

    it("serializes multiple operators on the same field", () => {
        const result = serializeFilter({
            age: [[">=", 18], ["<", 65]]
        } as FilterValues<string>);
        expect(result).toEqual({ age: ["gte.18", "lt.65"] });
    });

    it("serializes an 'in' condition", () => {
        const result = serializeFilter({ role: ["in", ["admin", "editor"]] });
        expect(result).toEqual({ role: "in.(admin,editor)" });
    });

    it("skips undefined values", () => {
        const result = serializeFilter({ a: ["==", "x"], b: undefined });
        expect(result).toEqual({ a: "eq.x" });
    });

    it("serializes null values as a null test", () => {
        // See "serializes a null comparison as the null test it means" below.
        const result = serializeFilter({ status: ["==", null] });
        expect(result).toEqual({ status: "isnull.null" });
    });

    it("serializes boolean values", () => {
        const result = serializeFilter({ active: ["==", true] });
        expect(result).toEqual({ active: "eq.true" });
    });

    it("serializes numeric values", () => {
        const result = serializeFilter({ count: [">=", 42] });
        expect(result).toEqual({ count: "gte.42" });
    });

    it("serializes EntityRelation values as their id", () => {
        const result = serializeFilter({ company: ["==", new EntityRelation("167", "company")] });
        expect(result).toEqual({ company: "eq.167" });
    });

    it("serializes plain relation wire objects as their id", () => {
        const result = serializeFilter({ company: ["==", { __type: "relation", id: 167, path: "company" }] });
        expect(result).toEqual({ company: "eq.167" });
    });

    it("serializes lists of relation values as their ids", () => {
        const result = serializeFilter({
            company: ["in", [new EntityRelation("1", "company"), { __type: "relation", id: "2", path: "company" }]]
        });
        expect(result).toEqual({ company: "in.(1,2)" });
    });
});

describe("deserializeFilter", () => {
    it("deserializes a simple equality condition", () => {
        const result = deserializeFilter({ status: "eq.active" });
        expect(result).toEqual({ status: ["==", "active"] });
    });

    it("deserializes multiple conditions (repeated params)", () => {
        const result = deserializeFilter({ age: ["gte.18", "lt.65"] });
        expect(result).toEqual({ age: [[">=", "18"], ["<", "65"]] });
    });

    it("deserializes an 'in' condition", () => {
        const result = deserializeFilter({ role: "in.(admin,editor)" });
        expect(result).toEqual({ role: ["in", ["admin", "editor"]] });
    });

    it("passes through already-canonical tuples", () => {
        const result = deserializeFilter({ status: ["==", "active"] });
        expect(result).toEqual({ status: ["==", "active"] });
    });

    it("passes through already-canonical tuple arrays", () => {
        const result = deserializeFilter({ age: [[">=", 18], ["<", 65]] });
        expect(result).toEqual({ age: [[">=", 18], ["<", 65]] });
    });

    it("treats unknown dot-prefix as equality value", () => {
        // "user@host.com" has a dot but "user@host" is not a known REST op
        const result = deserializeFilter({ email: "user@host.com" });
        expect(result).toEqual({ email: ["==", "user@host.com"] });
    });

    it("treats dotless string as equality value", () => {
        const result = deserializeFilter({ status: "active" });
        expect(result).toEqual({ status: ["==", "active"] });
    });
});

// ---------------------------------------------------------------------------
// 2. Leading-zero and numeric string preservation
// ---------------------------------------------------------------------------
describe("leading-zero preservation", () => {
    it("preserves leading zeros through round-trip", () => {
        assertRoundTrip({ zip: ["==", "01234"] });
    });

    it("preserves phone-number-like strings", () => {
        assertRoundTrip({ phone: ["==", "+15551234567"] });
    });

    it("preserves version strings", () => {
        assertRoundTrip({ version: ["==", "2.0.1"] });
    });

    it("deserializes numeric strings as strings, not numbers", () => {
        const result = deserializeFilter({ zip: "eq.01234" });
        expect(result).toEqual({ zip: ["==", "01234"] });
        // Must be a string, not the number 1234
        expect(typeof (result.zip as [WhereFilterOp, unknown])[1]).toBe("string");
    });
});

// ---------------------------------------------------------------------------
// 3. Boolean and null string preservation
// ---------------------------------------------------------------------------
describe("boolean/null string preservation", () => {
    it("deserializes 'true' as string, not boolean", () => {
        const result = deserializeFilter({ flag: "eq.true" });
        expect(result).toEqual({ flag: ["==", "true"] });
        expect(typeof (result.flag as [WhereFilterOp, unknown])[1]).toBe("string");
    });

    it("deserializes 'false' as string, not boolean", () => {
        const result = deserializeFilter({ flag: "eq.false" });
        expect(result).toEqual({ flag: ["==", "false"] });
        expect(typeof (result.flag as [WhereFilterOp, unknown])[1]).toBe("string");
    });

    it("deserializes 'null' as string, not null", () => {
        const result = deserializeFilter({ field: "eq.null" });
        expect(result).toEqual({ field: ["==", "null"] });
        expect(typeof (result.field as [WhereFilterOp, unknown])[1]).toBe("string");
    });

    it("serializes a null comparison as the null test it means", () => {
        // Was `eq.null`, which `deserializeFilter` could not tell from a search
        // for the four-character string — so `.where(f, "==", null)` came back
        // as `["==", "null"]` and compiled to `f = 'null'`. SQL `= NULL` is
        // never true, so `== null` can only mean IS NULL; saying so on the wire
        // is unambiguous and leaves `eq.null` free to mean the string.
        expect(serializeFilter({ field: ["==", null] })).toEqual({ field: "isnull.null" });
        expect(serializeFilter({ field: ["!=", null] })).toEqual({ field: "notnull.null" });
    });

    it("still serializes the literal string 'null' as eq.null", () => {
        expect(serializeFilter({ field: ["==", "null"] })).toEqual({ field: "eq.null" });
    });

    it("serializes actual boolean true as the string 'true'", () => {
        const result = serializeFilter({ field: ["==", true] });
        expect(result).toEqual({ field: "eq.true" });
    });
});

// ---------------------------------------------------------------------------
// 4. Comma escaping in list values
// ---------------------------------------------------------------------------
describe("comma escaping in list values", () => {
    it("escapes commas in list items during serialization", () => {
        const result = serializeFilter({ tag: ["in", ["hello, world", "foo"]] });
        expect(result).toEqual({ tag: "in.(hello\\, world,foo)" });
    });

    it("round-trips list values containing commas", () => {
        assertRoundTrip({ tag: ["in", ["hello, world", "foo"]] });
    });

    it("round-trips list values containing backslashes", () => {
        assertRoundTrip({ path: ["in", ["C:\\Users", "D:\\Data"]] });
    });

    it("round-trips list values containing both commas and backslashes", () => {
        assertRoundTrip({ field: ["in", ["a\\,b", "c,d", "e\\f"]] });
    });

    it("handles empty list items", () => {
        assertRoundTrip({ field: ["in", ["", "a", ""]] });
    });

    it("handles single-item lists", () => {
        assertRoundTrip({ field: ["in", ["only"]] });
    });

    it("deserializes escaped commas in list values", () => {
        const result = deserializeFilter({ tag: "in.(hello\\, world,foo)" });
        expect(result).toEqual({ tag: ["in", ["hello, world", "foo"]] });
    });
});

// ---------------------------------------------------------------------------
// 5. serializeTuple rejects invalid input
// ---------------------------------------------------------------------------
describe("serializeTuple strictness", () => {
    it("passes through pre-serialized PostgREST strings (WireFilterValues)", () => {
        // serializeFilter accepts WireFilterValues which may include pre-serialized
        // PostgREST strings. These should pass through unchanged.
        const result = serializeFilter({ status: "eq.active" as unknown as [WhereFilterOp, unknown] });
        expect(result).toEqual({ status: "eq.active" });
    });

    it("throws TypeError for malformed tuple (wrong arity)", () => {
        expect(() => {
            serializeFilter({ status: ["==", "active", "extra"] as unknown as [WhereFilterOp, unknown] });
        }).toThrow(TypeError);
    });

    it("throws TypeError for unknown operator", () => {
        expect(() => {
            serializeFilter({ status: ["LIKE", "active"] as unknown as [WhereFilterOp, unknown] });
        }).toThrow(TypeError);
    });

    it("throws TypeError for non-string operator", () => {
        expect(() => {
            serializeFilter({ status: [42, "active"] as unknown as [WhereFilterOp, unknown] });
        }).toThrow(TypeError);
    });

    it("throws TypeError for null tuple", () => {
        expect(() => {
            serializeFilter({ status: null as unknown as [WhereFilterOp, unknown] });
        }).toThrow(TypeError);
    });
});

// ---------------------------------------------------------------------------
// 6. Full round-trip tests
// ---------------------------------------------------------------------------
describe("full round-trip", () => {
    it("round-trips a complex filter", () => {
        const filter: FilterValues<string> = {
            status: ["==", "active"],
            role: ["in", ["admin", "editor"]],
            age: [[">=", "18"], ["<", "65"]] as [WhereFilterOp, unknown][],
            name: ["!=", "test"]
        };
        assertRoundTrip(filter);
    });

    it("round-trips array-contains", () => {
        assertRoundTrip({ tags: ["array-contains", "featured"] });
    });

    it("round-trips not-in", () => {
        assertRoundTrip({ status: ["not-in", ["deleted", "archived"]] });
    });

    it("round-trips array-contains-any", () => {
        assertRoundTrip({ tags: ["array-contains-any", ["a", "b", "c"]] });
    });
});

// ---------------------------------------------------------------------------
// 7. Logical conditions
// ---------------------------------------------------------------------------
describe("serializeLogicalCondition", () => {
    it("serializes a simple filter condition", () => {
        const result = serializeLogicalCondition({
            column: "status", operator: "==", value: "active"
        });
        expect(result).toBe("status.eq.active");
    });

    it("serializes an OR group", () => {
        const result = serializeLogicalCondition({
            type: "or",
            conditions: [
                { column: "status", operator: "==", value: "active" },
                { column: "status", operator: "==", value: "pending" }
            ]
        });
        expect(result).toBe("or(status.eq.active,status.eq.pending)");
    });

    it("serializes list values with comma escaping", () => {
        const result = serializeLogicalCondition({
            column: "tag", operator: "in", value: ["hello, world", "foo"]
        });
        expect(result).toBe("tag.in.(hello\\, world,foo)");
    });
});

describe("deserializeLogicalCondition", () => {
    it("deserializes a simple filter condition", () => {
        const result = deserializeLogicalCondition("status.eq.active");
        expect(result).toEqual({
            column: "status", operator: "==", value: "active"
        });
    });

    it("deserializes an OR group", () => {
        const result = deserializeLogicalCondition(
            "or(status.eq.active,status.eq.pending)"
        );
        expect(result).toEqual({
            type: "or",
            conditions: [
                { column: "status", operator: "==", value: "active" },
                { column: "status", operator: "==", value: "pending" }
            ]
        });
    });

    it("deserializes a column with no dot as boolean equality", () => {
        const result = deserializeLogicalCondition("active");
        expect(result).toEqual({ column: "active", operator: "==", value: true });
    });

    it("deserializes column.value as equality", () => {
        const result = deserializeLogicalCondition("status.active");
        expect(result).toEqual({
            column: "status", operator: "==", value: "active"
        });
    });

    it("deserializes list values in logical conditions", () => {
        const result = deserializeLogicalCondition("role.in.(admin,editor)");
        expect(result).toEqual({
            column: "role", operator: "in", value: ["admin", "editor"]
        });
    });

    it("round-trips logical conditions with escaped commas", () => {
        const original = {
            column: "tag", operator: "in" as WhereFilterOp, value: ["hello, world", "foo"]
        };
        const serialized = serializeLogicalCondition(original);
        const deserialized = deserializeLogicalCondition(serialized);
        expect(deserialized).toEqual(original);
    });

    it("round-trips nested logical conditions", () => {
        const original = {
            type: "and" as const,
            conditions: [
                {
                    type: "or" as const,
                    conditions: [
                        { column: "status", operator: "==" as WhereFilterOp, value: "active" },
                        { column: "status", operator: "==" as WhereFilterOp, value: "pending" }
                    ]
                },
                { column: "age", operator: ">=" as WhereFilterOp, value: "18" }
            ]
        };
        const serialized = serializeLogicalCondition(original);
        const deserialized = deserializeLogicalCondition(serialized);
        expect(deserialized).toEqual(original);
    });
});

// ---------------------------------------------------------------------------
// Pattern-matching and null operators
// ---------------------------------------------------------------------------
describe("pattern-matching and null operators", () => {
    it("serializes like / ilike with SQL wildcards", () => {
        expect(serializeFilter({ name: ["ilike", "%john%"] })).toEqual({ name: "ilike.%john%" });
        expect(serializeFilter({ slug: ["like", "post-%"] })).toEqual({ slug: "like.post-%" });
        expect(serializeFilter({ slug: ["not-ilike", "draft-%"] })).toEqual({ slug: "nilike.draft-%" });
    });

    it("round-trips like / ilike conditions", () => {
        assertRoundTrip({ name: ["ilike", "%john%"] });
        assertRoundTrip({ slug: ["like", "post-%"] });
        assertRoundTrip({ slug: ["not-like", "tmp\\_%"] });
    });

    it("serializes null operators with the short-code and no meaningful value", () => {
        expect(serializeFilter({ deleted_at: ["is-null", null] })).toEqual({ deleted_at: "isnull.null" });
        expect(serializeFilter({ published_at: ["is-not-null", null] })).toEqual({ published_at: "notnull.null" });
    });

    it("normalizes null-operator values back to null on deserialize", () => {
        expect(deserializeFilter({ deleted_at: "isnull.null" })).toEqual({ deleted_at: ["is-null", null] });
        expect(deserializeFilter({ published_at: "notnull.anything" })).toEqual({ published_at: ["is-not-null", null] });
    });

    it("round-trips null operators", () => {
        assertRoundTrip({ deleted_at: ["is-null", null] });
        assertRoundTrip({ published_at: ["is-not-null", null] });
    });

    it("carries the new operators through logical conditions", () => {
        const original = {
            column: "name", operator: "ilike" as WhereFilterOp, value: "%doe%"
        };
        const serialized = serializeLogicalCondition(original);
        expect(serialized).toBe("name.ilike.%doe%");
        expect(deserializeLogicalCondition(serialized)).toEqual(original);
    });
});

// ---------------------------------------------------------------------------
// The four leaf encodings a group used to get wrong
//
// `serializeLogicalCondition` carried its own copy of the leaf encoder, and
// the copy had drifted from `serializeTuple` on every rule the top-level codec
// had been fixed for. Each of these is a filter that ran, returned rows, and
// answered a different question than the one asked — no error anywhere.
// ---------------------------------------------------------------------------
describe("logical leaf encoding", () => {
    const cond = (column: string, operator: string, value: unknown) =>
        ({ column, operator: operator as WhereFilterOp, value });

    it("encodes a null comparison as the null-testing operator", () => {
        // Was `deleted_at.eq.null`, i.e. a search for the four-character
        // string, which on a timestamp column is a 500 and on a text column is
        // silently the wrong rows.
        const wire = serializeLogicalCondition(cond("deleted_at", "==", null));
        expect(wire).toBe("deleted_at.isnull.null");
        expect(deserializeLogicalCondition(wire)).toEqual({
            column: "deleted_at", operator: "is-null", value: null
        });
        // Stable through a re-encode: the SDK builds it, the server parses it,
        // a retry serializes it again.
        expect(serializeLogicalCondition(deserializeLogicalCondition(wire))).toBe(wire);
    });

    it("encodes `!= null` as the negated null test", () => {
        const wire = serializeLogicalCondition(cond("published_at", "!=", null));
        expect(wire).toBe("published_at.notnull.null");
        expect(deserializeLogicalCondition(wire)).toEqual({
            column: "published_at", operator: "is-not-null", value: null
        });
    });

    it("keeps the dots of a relation path in the column", () => {
        // Was column `author`, operator `name` — which resolves to nothing, so
        // the fallback made it `author == "eq.bob"`.
        const wire = serializeLogicalCondition(cond("author.name", "==", "bob"));
        expect(wire).toBe("author.name.eq.bob");
        expect(deserializeLogicalCondition(wire)).toEqual({
            column: "author.name", operator: "==", value: "bob"
        });
    });

    it("keeps a JSON path in the column", () => {
        const wire = serializeLogicalCondition(cond("metadata->>tier", "==", "gold"));
        expect(wire).toBe("metadata->>tier.eq.gold");
        expect(deserializeLogicalCondition(wire)).toEqual({
            column: "metadata->>tier", operator: "==", value: "gold"
        });
    });

    it("accepts the REST spelling of an operator", () => {
        // Was silently rewritten to `eq`: `age.eq.18` instead of `age.gte.18`.
        const wire = serializeLogicalCondition(cond("age", "gte", 18));
        expect(wire).toBe("age.gte.18");
        expect(deserializeLogicalCondition(wire)).toEqual({
            column: "age", operator: ">=", value: "18"
        });
    });

    it("refuses an operator the dialect does not have", () => {
        expect(() => serializeLogicalCondition(cond("title", "contains", "x")))
            .toThrow(TypeError);
        expect(() => serializeLogicalCondition(cond("title", "contains", "x")))
            .toThrow(/unknown operator "contains"/);
    });

    it("encodes the empty list distinctly from a list holding the empty string", () => {
        // Was `id.in.()`, which splits to `[""]` — a uuid column answers 500,
        // a text column silently answers with the wrong rows.
        const wire = serializeLogicalCondition(cond("id", "in", []));
        expect(deserializeLogicalCondition(wire)).toEqual({
            column: "id", operator: "in", value: []
        });
        const oneEmpty = serializeLogicalCondition(cond("id", "in", [""]));
        expect(wire).not.toBe(oneEmpty);
        expect(deserializeLogicalCondition(oneEmpty)).toEqual({
            column: "id", operator: "in", value: [""]
        });
    });

    it("round-trips a relation path inside an or group", () => {
        const group = {
            type: "or" as const,
            conditions: [
                cond("author.name", "==", "bob"),
                cond("deleted_at", "==", null)
            ]
        };
        const wire = serializeLogicalCondition(group);
        expect(wire).toBe("or(author.name.eq.bob,deleted_at.isnull.null)");
        expect(deserializeLogicalCondition(wire)).toEqual({
            type: "or",
            conditions: [
                { column: "author.name", operator: "==", value: "bob" },
                { column: "deleted_at", operator: "is-null", value: null }
            ]
        });
    });
});
