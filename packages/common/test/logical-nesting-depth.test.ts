import { deserializeLogicalCondition, MAX_LOGICAL_NESTING_DEPTH } from "../src/data/filter-dialect";

/**
 * How deeply a `?or=` group may nest.
 *
 * `deserializeLogicalCondition` recurses once per level, on a value that
 * arrives in a query string, and had no limit. Twenty thousand levels — an
 * 80 KB parameter — reached `RangeError: Maximum call stack size exceeded`,
 * which surfaces as a 500 with a message about the call stack rather than a
 * 400 about the filter.
 *
 * The realistic ceiling is lower than that and worth stating: Node caps request
 * headers at 16 KB by default, and the URL counts toward it, so roughly four
 * thousand levels is as deep as a GET can reach. That is not a stack overflow —
 * it is about 120 ms of parsing, because each level rescans the string it was
 * handed. Neither number is a catastrophe on its own; both are avoided by
 * refusing a nesting depth no real filter has.
 */
function nested(depth: number): string {
    return "or(".repeat(depth) + "a.eq.1" + ")".repeat(depth);
}

describe("logical group nesting", () => {
    it("parses the depths a real filter uses", () => {
        const parsed = deserializeLogicalCondition("or(a.eq.1,and(b.eq.2,c.eq.3))");

        expect(parsed).toMatchObject({ type: "or" });
    });

    it("accepts nesting right up to the limit", () => {
        expect(() => deserializeLogicalCondition(nested(MAX_LOGICAL_NESTING_DEPTH))).not.toThrow();
    });

    it("refuses to recurse past it, and says so", () => {
        expect(() => deserializeLogicalCondition(nested(MAX_LOGICAL_NESTING_DEPTH + 1)))
            .toThrow(/nest/i);
    });

    it("refuses a depth that would have overflowed the stack", () => {
        // The case that produced `RangeError: Maximum call stack size exceeded`.
        let message = "";
        try { deserializeLogicalCondition(nested(20000)); } catch (e) { message = (e as Error).message; }

        expect(message).toMatch(/nest/i);
        expect(message).not.toMatch(/call stack/i);
    });
});
