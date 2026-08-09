import { describe, it, expect } from "@jest/globals";
import { buildQueryString } from "../src/transport";
import { RebaseClientError } from "../src/errors";

// --------------------------------------------------------------------------
// 1. buildQueryString — logical conditions null safety
// --------------------------------------------------------------------------
describe("buildQueryString — logical conditions null safety", () => {
    it("does not crash when logical.conditions is undefined", () => {
        const result = buildQueryString({
            logical: { type: "and", conditions: undefined } as any,
        });
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
    });

    it("does not crash when logical.conditions is null", () => {
        const result = buildQueryString({
            logical: { type: "and", conditions: null } as any,
        });
        expect(result).toBeDefined();
        expect(typeof result).toBe("string");
    });

    it("produces a valid (empty) logical string when conditions is an empty array", () => {
        const result = buildQueryString({
            logical: { type: "and", conditions: [] },
        });
        // Should encode `and=()` — the empty parentheses
        expect(result).toContain("and=");
        expect(result).toContain(encodeURIComponent("()"));
    });

    it("preserves existing behavior with valid conditions", () => {
        const result = buildQueryString({
            logical: {
                type: "and",
                conditions: [
                    { column: "status", operator: "==", value: "active" },
                    { column: "age", operator: ">=", value: 18 },
                ],
            },
        });
        expect(result).toContain("and=");
        // Verify both conditions are serialized
        const decoded = decodeURIComponent(result);
        expect(decoded).toContain("status.eq.active");
        expect(decoded).toContain("age.gte.18");
    });

    it("does not crash on nested logical conditions with inner conditions: undefined", () => {
        const result = buildQueryString({
            logical: {
                type: "and",
                conditions: [
                    { type: "or", conditions: undefined } as any,
                    { column: "name", operator: "==", value: "test" },
                ],
            },
        });
        expect(result).toBeDefined();
        const decoded = decodeURIComponent(result);
        expect(decoded).toContain("or()");
        expect(decoded).toContain("name.eq.test");
    });

    it("does not crash on nested logical conditions with inner conditions: null", () => {
        const result = buildQueryString({
            logical: {
                type: "or",
                conditions: [
                    { type: "and", conditions: null } as any,
                ],
            },
        });
        expect(result).toBeDefined();
        const decoded = decodeURIComponent(result);
        expect(decoded).toContain("and()");
    });

    it("produces and=() when type is 'and' and conditions is undefined", () => {
        const result = buildQueryString({
            logical: { type: "and", conditions: undefined } as any,
        });
        expect(result).toContain("and=");
        expect(result).toContain(encodeURIComponent("()"));
    });

    it("produces or=() when type is 'or' and conditions is undefined", () => {
        const result = buildQueryString({
            logical: { type: "or", conditions: undefined } as any,
        });
        expect(result).toContain("or=");
        expect(result).toContain(encodeURIComponent("()"));
    });
});

// --------------------------------------------------------------------------
// 2. buildQueryString — where clause array edge cases
// --------------------------------------------------------------------------
describe("buildQueryString — where clause array edge cases", () => {
    it("serializes a null comparison as the null test it means", () => {
        // Was `eq.null`, which the decoder could not tell from a search for the
        // four-character string — so this compiled to `status = 'null'` server
        // side. These tests pinned only the encoder, so both halves agreed with
        // each other and neither agreed with the database.
        expect(buildQueryString({ where: { status: ["==", null] } })).toBe("?status=isnull.null");
    });

    it("serializes single tuple ['in', [1,2,3]] correctly", () => {
        const result = buildQueryString({
            where: { status: ["in", [1, 2, 3]] },
        });
        const decoded = decodeURIComponent(result);
        expect(decoded).toBe("?status=in.(1,2,3)");
    });

    it("serializes multi-condition array [['>=', 5], ['<=', 10]]", () => {
        const result = buildQueryString({
            where: { age: [[">=", 5], ["<=", 10]] },
        });
        const decoded = decodeURIComponent(result);
        // Multi-condition produces two separate query parameters for the same field
        expect(decoded).toContain("age=gte.5");
        expect(decoded).toContain("age=lte.10");
    });

    it("serializes ['in', []] with the empty-list token", () => {
        // `in.()` is the empty string between the parens, which decodes to
        // `[""]` — so an empty selection became a search for the empty string.
        // A lone backslash spells "zero items" and cannot collide with a real
        // value, because escaping doubles every backslash.
        const decoded = decodeURIComponent(buildQueryString({ where: { category: ["in", []] } }));
        expect(decoded).toBe("?category=in.(\\)");
    });

    it("serializes ['!=', null] as the not-null test", () => {
        expect(buildQueryString({ where: { status: ["!=", null] } })).toBe("?status=notnull.null");
    });
});

// --------------------------------------------------------------------------
// 3. buildQueryString — combined params with null arrays
// --------------------------------------------------------------------------
describe("buildQueryString — combined params with null arrays", () => {
    it("does not add include parameter when include is undefined", () => {
        const result = buildQueryString({ include: undefined });
        expect(result).toBe("");
    });

    it("does not add include parameter when include is null", () => {
        const result = buildQueryString({ include: null as any });
        expect(result).toBe("");
    });

    it("does not add include parameter when include is empty array", () => {
        const result = buildQueryString({ include: [] });
        expect(result).toBe("");
    });

    it("handles gracefully when logical + where + include all have edge cases", () => {
        const result = buildQueryString({
            include: [],
            logical: { type: "and", conditions: undefined } as any,
            where: { status: ["==", null] },
        });
        expect(result).toBeDefined();
        // include=[] should not appear
        expect(result).not.toContain("include=");
        // logical should produce and=()
        expect(result).toContain("and=");
        expect(result).toContain(encodeURIComponent("()"));
        // where null should produce the null test, not `eq.null`
        expect(result).toContain("status=isnull.null");
    });

    it("does not add search parameter when searchString is undefined", () => {
        const result = buildQueryString({ searchString: undefined });
        expect(result).toBe("");
    });
});

// --------------------------------------------------------------------------
// 4. serializeFilter edge cases (tested indirectly through buildQueryString)
// --------------------------------------------------------------------------
describe("serializeFilter edge cases (via buildQueryString)", () => {
    it("refuses ['==', undefined] instead of filtering on the string \"undefined\"", () => {
        // This used to emit `field=eq.undefined`, so the server searched for
        // rows whose `field` is the literal text "undefined" and the caller got
        // an empty page rather than an error. Omitting the condition would be
        // worse still — the query would come back unfiltered.
        expect(() => buildQueryString({
            where: { field: ["==", undefined] },
        })).toThrow(RebaseClientError);
        expect(() => buildQueryString({
            where: { field: ["==", undefined] },
        })).toThrow(/undefined value/);
    });

    it("refuses an undefined item inside an ['in', [...]] list", () => {
        expect(() => buildQueryString({
            where: { field: ["in", ["a", undefined]] },
        })).toThrow(RebaseClientError);
    });

    it("still omits a field whose whole condition is undefined", () => {
        // The documented way to skip a filter, and the reason the guard above
        // has to look at the tuple's value rather than the entry.
        expect(buildQueryString({ where: { field: undefined } as any })).toBe("");
    });

    it("still serializes ['is-null', null] — SQL NULL is a real filter", () => {
        const decoded = decodeURIComponent(buildQueryString({
            where: { field: ["is-null", null] },
        }));
        expect(decoded).toContain("field=isnull.null");
    });

    it("serializes ['==', ''] as eq. (empty string value)", () => {
        const result = buildQueryString({
            where: { field: ["==", ""] },
        });
        const decoded = decodeURIComponent(result);
        expect(decoded).toContain("field=eq.");
    });
});
