/**
 * PostgREST's spellings of a null test and of negation, which this dialect
 * writes differently, must be refused with the spelling that works.
 *
 * Found through the MCP `list_documents` tool: an agent counting rows with no
 * `difficulty` wrote `"is.null"`, then `"eq.null"`. `is` names no operator
 * here, so the first became `difficulty = 'is.null'`; the second is the text
 * "null" by design. On a smallint column both answered "not a valid smallint",
 * and the agent fell back to paging the whole collection. On a text column
 * they answer zero rows, with nothing to say why.
 *
 * `status=not.eq.draft` failed the same way: an equality on the whole string.
 */
import {
    deserializeFilter,
    deserializeLogicalCondition,
    serializeFilter,
    UnknownFilterOperatorError
} from "../src/data/filter-dialect";

function rejection(run: () => unknown): UnknownFilterOperatorError {
    let caught: unknown;
    try {
        run();
    } catch (e) {
        caught = e;
    }
    expect(caught).toBeInstanceOf(UnknownFilterOperatorError);
    return caught as UnknownFilterOperatorError;
}

describe("a query parameter in PostgREST's spelling", () => {
    it.each([
        ["is.null", "is", "difficulty=isnull.null"],
        ["IS.NULL", "is", "difficulty=isnull.null"],
        ["not.is.null", "not.is", "difficulty=notnull.null"],
        ["is.not.null", "is.not", "difficulty=notnull.null"],
        ["is-null.null", "is-null", "difficulty=isnull.null"],
        ["isNull.true", "isNull", "difficulty=isnull.null"],
        ["is-not-null.null", "is-not-null", "difficulty=notnull.null"],
        ["not_null.null", "not_null", "difficulty=notnull.null"]
    ])("refuses %s and names the null test", (raw, operator, spelling) => {
        const error = rejection(() => deserializeFilter({ difficulty: raw }));
        expect(error.field).toBe("difficulty");
        expect(error.operator).toBe(operator);
        expect(error.message).toContain(spelling);
    });

    it.each([
        ["not.eq.draft", "status=neq.draft"],
        ["not.in.(a,b)", "status=nin.(a,b)"],
        ["not.ilike.%x%", "status=nilike.%x%"],
        ["not.gt.5", "not=(status.gt.5)"]
    ])("refuses %s and names the negation that works", (raw, spelling) => {
        expect(rejection(() => deserializeFilter({ status: raw })).message).toContain(spelling);
    });

    it.each([
        [">=.18", "age=gte.18"],
        ["array-contains.x", "age=cs.x"],
        ["not-in.(1,2)", "age=nin.(1,2)"]
    ])("refuses the canonical name %s, which only tuples and groups read", (raw, spelling) => {
        expect(rejection(() => deserializeFilter({ age: raw })).message).toContain(spelling);
    });

    it("refuses it among repeated params too", () => {
        rejection(() => deserializeFilter({ difficulty: ["gte.1", "is.null"] }));
    });
});

describe("a group leaf in PostgREST's spelling", () => {
    it("refuses `is.null` inside a disjunction, in the group's own form", () => {
        const error = rejection(() => deserializeLogicalCondition("or(difficulty.is.null,difficulty.eq.1)"));
        expect(error.field).toBe("difficulty");
        expect(error.message).toContain("difficulty.isnull.null");
    });

    it("refuses `not.is.null` and `not.eq` inside a negation", () => {
        expect(rejection(() => deserializeLogicalCondition("not(d.not.is.null)")).message).toContain("d.notnull.null");
        // This one found its `eq` and filtered a column named `status.not`.
        expect(rejection(() => deserializeLogicalCondition("and(status.not.eq.draft)")).message).toContain("status.neq.draft");
    });

    it("keeps canonical names, which a group reads", () => {
        expect(deserializeLogicalCondition("d.is-null.null")).toEqual({ column: "d", operator: "is-null", value: null });
        expect(deserializeLogicalCondition("age.>=.18")).toEqual({ column: "age", operator: ">=", value: "18" });
    });

    it("refuses it on a relation path", () => {
        expect(rejection(() => deserializeLogicalCondition("author.name.is.null")).field).toBe("author.name");
    });
});

describe("what must keep working", () => {
    it("keeps values that merely start with `is.` or `not.`", () => {
        expect(deserializeFilter({ host: "is.gd" })).toEqual({ host: ["==", "is.gd"] });
        expect(deserializeFilter({ s: "not.a.value" })).toEqual({ s: ["==", "not.a.value"] });
        expect(deserializeFilter({ s: "is.null.x" })).toEqual({ s: ["==", "is.null.x"] });
    });

    it("keeps the spellings this dialect has", () => {
        expect(deserializeFilter({ d: "isnull.null" })).toEqual({ d: ["is-null", null] });
        expect(deserializeFilter({ d: "notnull.null" })).toEqual({ d: ["is-not-null", null] });
        expect(deserializeFilter({ d: "eq.null" })).toEqual({ d: ["==", "null"] });
    });

    it("keeps a foreign spelling written as the value of a real operator", () => {
        expect(deserializeFilter({ note: "eq.is.null" })).toEqual({ note: ["==", "is.null"] });
        expect(deserializeLogicalCondition("note.eq.not.is.null"))
            .toEqual({ column: "note", operator: "==", value: "not.is.null" });
    });
});

describe("serializeFilter — a bare value is an equality", () => {
    it("sends `null` as the null test, as the server reads it", () => {
        expect(serializeFilter({ difficulty: null })).toEqual({ difficulty: "isnull.null" });
    });

    it("sends a number or a boolean as `eq`", () => {
        expect(serializeFilter({ level: 3, active: false })).toEqual({ level: "eq.3", active: "eq.false" });
    });

    it("round-trips through the server's reading", () => {
        expect(deserializeFilter(serializeFilter({ difficulty: null }))).toEqual({ difficulty: ["is-null", null] });
    });
});
