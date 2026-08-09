/**
 * An operator this dialect does not have must be refused, not reinterpreted.
 *
 * `deserializeFilter` accepted a `[op, value]` tuple only when the operator was
 * spelled canonically. Everything else fell through to the value-list reading
 * and ended at `["in", raw]` — so **the operator string became a value in a
 * membership test**. Observed against a live server holding one row
 * `{ id: 1, title: "Hello" }`:
 *
 *   where={"title":["~~","Nope"]}     → 200, 0 rows
 *   where={"title":["!!","Hello"]}    → 200, 1 row — a false positive
 *   where={"title":["contains","Hell"]} → 200, 0 rows
 *   where={"id":[">>",0]}             → 500, `invalid input syntax for integer`
 *
 * The second is the dangerous one: `title IN ('!!','Hello')` matches, so a
 * filter the caller believed was applied returned rows it was written to
 * exclude. All four are malformed requests and now say so.
 *
 * The other half of this file is the *keeps*: a genuine list of values, the
 * PostgREST dot-string dialect, and every canonical operator have to be
 * untouched, because they share the one ambiguous shape — a two-element array.
 */
import {
    deserializeFilter,
    UnknownFilterOperatorError
} from "../src/data/filter-dialect";
import { ALL_WHERE_FILTER_OPS, CANONICAL_TO_REST, NULL_OPS, toCanonicalOp } from "@rebasepro/types";

/** Assert the rejection, and that it names both the operator and the field. */
function expectRejected(filter: Record<string, unknown>, operator: string, field: string): void {
    let caught: unknown;
    try {
        deserializeFilter(filter);
    } catch (e) {
        caught = e;
    }
    // Guards the case where nothing throws: an empty catch would otherwise let
    // every assertion below silently not run.
    expect(caught).toBeInstanceOf(UnknownFilterOperatorError);
    const error = caught as UnknownFilterOperatorError;
    expect(error.operator).toBe(operator);
    expect(error.field).toBe(field);
    expect(error.message).toContain(`'${operator}'`);
    // The valid set is enumerated, the way UNKNOWN_FILTER_FIELD enumerates
    // `validFields` — a rejection that does not say what would have worked
    // costs the caller another round trip.
    expect(error.message).toContain("array-contains-any");
    expect(error.details).toEqual({
        field,
        operator,
        validOperators: ALL_WHERE_FILTER_OPS
    });
    // Read by the server's Hono error handler off any thrown error, so a decode
    // path that forgets to convert still answers 400 rather than 500.
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("UNKNOWN_FILTER_OPERATOR");
}

describe("deserializeFilter — the four probes from the audit", () => {
    it("refuses a symbolic operator that matches nothing", () => {
        expectRejected({ title: ["~~", "Nope"] }, "~~", "title");
    });

    it("refuses the operator that produced a false positive", () => {
        // `["!!","Hello"]` used to compile to `title IN ('!!','Hello')`, which
        // MATCHES the row — the caller was handed a row their filter excluded.
        expectRejected({ title: ["!!", "Hello"] }, "!!", "title");
    });

    it("refuses `contains`, which is the first name a developer guesses", () => {
        expectRejected({ title: ["contains", "Hell"] }, "contains", "title");
    });

    it("refuses an operator that used to reach Postgres and 500", () => {
        // `id IN ('>>', 0)` on an integer column: `invalid input syntax for
        // type integer: ">>"`, answered as INTERNAL_ERROR. A 400 belongs here.
        expectRejected({ id: [">>", 0] }, ">>", "id");
    });
});

describe("deserializeFilter — other spellings that are plainly an operator", () => {
    it("refuses a respelling of a real operator rather than accepting a second spelling", () => {
        // Admitting `arrayContains` would leave two wire spellings of one
        // operator; the message names the one that works.
        expectRejected({ tags: ["arrayContains", "x"] }, "arrayContains", "tags");
        expectRejected({ tags: ["array_contains", "x"] }, "array_contains", "tags");
        expectRejected({ role: ["notIn", ["a"]] }, "notIn", "role");
        expectRejected({ deleted_at: ["isNotNull", null] }, "isNotNull", "deleted_at");
    });

    it("refuses names borrowed from other query dialects", () => {
        expectRejected({ name: ["startsWith", "Jo"] }, "startsWith", "name");
        expectRejected({ name: ["matches", "^Jo"] }, "matches", "name");
        expectRejected({ age: ["between", 1] }, "between", "age");
        expectRejected({ status: ["equals", "draft"] }, "equals", "status");
    });

    it("refuses `=`, the one single-character operator anyone mistypes", () => {
        expectRejected({ status: ["=", "draft"] }, "=", "status");
    });

    it("checks every tuple when a field carries several conditions", () => {
        // The old test read `raw[0]` and cast the whole array, so a bad
        // operator anywhere after the first travelled on untouched.
        expectRejected({ age: [[">=", 18], ["~~", 65]] }, "~~", "age");
    });
});

describe("deserializeFilter — what must keep working", () => {
    it("reads a genuine two-item list of values as an `in`", () => {
        expect(deserializeFilter({ tags: ["a", "b"] })).toEqual({ tags: ["in", ["a", "b"]] });
        expect(deserializeFilter({ tags: ["cat", "dog"] })).toEqual({ tags: ["in", ["cat", "dog"]] });
        // Words that are near an operator but likelier to be values stay values.
        expect(deserializeFilter({ scope: ["any", "all"] })).toEqual({ scope: ["in", ["any", "all"]] });
        expect(deserializeFilter({ grade: ["-", "+"] })).toEqual({ grade: ["in", ["-", "+"]] });
    });

    it("reads a longer list of values as an `in`", () => {
        expect(deserializeFilter({ tags: ["a", "b", "c"] })).toEqual({ tags: ["in", ["a", "b", "c"]] });
    });

    it("leaves the PostgREST dot-string dialect alone", () => {
        expect(deserializeFilter({ status: "eq.active" })).toEqual({ status: ["==", "active"] });
        expect(deserializeFilter({ role: "in.(admin,editor)" })).toEqual({ role: ["in", ["admin", "editor"]] });
        expect(deserializeFilter({ email: "user@host.com" })).toEqual({ email: ["==", "user@host.com"] });
    });

    it("leaves two repeated dot-string params alone", () => {
        // Two repeated query params arrive as a two-element array of strings —
        // the same shape as a tuple. A dot defers to the dot-string reading.
        expect(deserializeFilter({ age: ["gte.18", "lt.65"] }))
            .toEqual({ age: [[">=", "18"], ["<", "65"]] });
        // `["ilike",""]` serializes to "ilike.", whose letters spell a real
        // operator. The property test found this one.
        expect(deserializeFilter({ name: ["ilike.", "gte.5"] }))
            .toEqual({ name: [["ilike", ""], [">=", "5"]] });
    });

    it("accepts every canonical operator", () => {
        for (const op of ALL_WHERE_FILTER_OPS) {
            const value = NULL_OPS.has(op) ? null : "x";
            expect(deserializeFilter({ field: [op, value] })).toEqual({ field: [op, value] });
        }
    });

    it("accepts every REST short-code, which used to become a value", () => {
        // `{"status":["eq","active"]}` compiled to `status IN ('eq','active')`
        // — the same defect as `["!!","Hello"]`, on the spelling the wire
        // format itself uses. It resolves now.
        for (const [canonical, rest] of Object.entries(CANONICAL_TO_REST)) {
            expect(deserializeFilter({ field: [rest, "x"] })).toEqual({ field: [canonical, "x"] });
        }
    });

    it("accepts values of every type in the second slot", () => {
        expect(deserializeFilter({ age: [">=", 18] })).toEqual({ age: [">=", 18] });
        expect(deserializeFilter({ ok: ["==", true] })).toEqual({ ok: ["==", true] });
        expect(deserializeFilter({ at: ["is-null", null] })).toEqual({ at: ["is-null", null] });
        expect(deserializeFilter({ role: ["in", []] })).toEqual({ role: ["in", []] });
        expect(deserializeFilter({ role: ["in", ["a", "b"]] })).toEqual({ role: ["in", ["a", "b"]] });
    });

    it("keeps reading several conditions on one field", () => {
        expect(deserializeFilter({ age: [[">=", 18], ["<", 65]] }))
            .toEqual({ age: [[">=", 18], ["<", 65]] });
    });
});

describe("toCanonicalOp — a prototype key is not an operator", () => {
    /**
     * `toCanonicalOp` indexed `REST_TO_CANONICAL` as a plain object, so every
     * `Object.prototype` member answered: `toCanonicalOp("valueOf")` returned
     * the inherited *function*, and the operator validation built on top of it
     * would have read that as "known operator" and carried a function into the
     * compilers in place of a `WhereFilterOp`. Sixth instance of the class the
     * REST codec's own lookup tables were converted away from.
     */
    it("returns undefined for inherited members", () => {
        for (const key of ["valueOf", "constructor", "toString", "hasOwnProperty", "__proto__"]) {
            expect(toCanonicalOp(key)).toBeUndefined();
        }
    });

    it("carries no function into a decoded filter", () => {
        const decoded = deserializeFilter({ title: ["valueOf", "x"] });
        // Read as a plain two-item list of values — the operator slot holds a
        // real operator, never a function.
        expect(decoded).toEqual({ title: ["in", ["valueOf", "x"]] });
        expect(typeof (decoded.title as [unknown, unknown])[0]).toBe("string");
    });
});
