import { describe, expect, it } from "@jest/globals";
import { and, cond, or } from "@rebasepro/common";
import type { SDKTableClient, WhereFilterOp } from "@rebasepro/types";
import { SDKQueryBuilder } from "../src/sdk_query_builder";
import { buildQueryString } from "../src/transport";

/**
 * The client's builder (`client.data.<table>.where(…)`), read through the
 * query string it turns into. The admin accessor's builder has its own cases
 * (`@rebasepro/cms-types` `query_builder_params`).
 */

/**
 * The params a builder has collected. They are private, and these tests are
 * about exactly what they hold, so they are read by name and checked.
 */
function getParams(qb: SDKQueryBuilder): Record<string, unknown> {
    const params: unknown = Reflect.get(qb, "params");
    if (typeof params !== "object" || params === null) throw new Error("the builder holds no params");
    return Object.fromEntries(Object.entries(params));
}

/** A table the builder runs against; these cases never reach it. */
function createMockCollection(): SDKTableClient {
    return new Proxy({} as SDKTableClient, {
        get: () => () => { throw new Error("the builder does not call its table here"); }
    });
}

// ---------------------------------------------------------------------------
// Repeated where() on the SAME column
//
// The only non-trivial branch in `where()`: a second condition on a column
// that already has one does not overwrite it — the two collapse into an array
// of tuples, which is how a range (`>= 18` AND `< 65`) is expressed at all.
// Overwriting instead would silently widen every range query to its second
// bound alone.
// ---------------------------------------------------------------------------
describe("SDKQueryBuilder — repeated where() on one column", () => {
    it("collapses two conditions into an array of tuples", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65);
        expect(getParams(qb).where).toEqual({ age: [[">=", 18], ["<", 65]] });
    });

    it("appends a third condition to the existing array", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65).where("age", "!=", 40);
        expect(getParams(qb).where).toEqual({
            age: [[">=", 18], ["<", 65], ["!=", 40]]
        });
    });

    it("keeps other columns as single tuples", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65).where("status", "==", "active");
        expect(getParams(qb).where).toEqual({
            age: [[">=", 18], ["<", 65]],
            status: ["==", "active"]
        });
    });

    it("survives the trip to the wire as repeated params", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where("age", ">=", 18).where("age", "<", 65);
        const decoded = decodeURIComponent(buildQueryString(getParams(qb)));
        expect(decoded).toContain("age=gte.18");
        expect(decoded).toContain("age=lt.65");
    });
});

// ---------------------------------------------------------------------------
// where(logicalCondition) overload
// ---------------------------------------------------------------------------
describe("SDKQueryBuilder — where(logicalCondition)", () => {
    it("stores an or(...) group under `logical`, not under `where`", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where(or(cond("status", "==", "draft"), cond("status", "==", "review")));

        const params = getParams(qb);
        expect(params.logical).toEqual({
            type: "or",
            conditions: [
                { column: "status", operator: "==", value: "draft" },
                { column: "status", operator: "==", value: "review" }
            ]
        });
        // The group is a separate axis: it must not leak into the column
        // filters, where it would serialize as a nonsense `status=` param.
        expect(params.where).toEqual({});
    });

    it("composes with ordinary column filters", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where("published", "==", true)
            .where(or(cond("author", "==", "a"), cond("author", "==", "b")));

        const decoded = decodeURIComponent(buildQueryString(getParams(qb)));
        expect(decoded).toContain("published=eq.true");
        expect(decoded).toContain("or=(author.eq.a,author.eq.b)");
    });

    /**
     * A second group **narrows**, like every other `.where()` on the chain.
     *
     * It used to replace the first, silently — the one call on the builder that
     * made a query match *more* rows rather than fewer. `find()`'s own
     * `where`/`logical`/`search` are AND-ed with each other, and a dropped `or`
     * returns rows the caller wrote the filter to exclude, which is the
     * direction that does not announce itself.
     */
    it("a second logical group ANDs with the first", () => {
        const qb = new SDKQueryBuilder(createMockCollection());
        qb.where(or(cond("a", "==", 1))).where(and(cond("b", "==", 2)));
        expect(getParams(qb).logical).toEqual({
            type: "and",
            conditions: [
                { type: "or", conditions: [{ column: "a", operator: "==", value: 1 }] },
                { type: "and", conditions: [{ column: "b", operator: "==", value: 2 }] }
            ]
        });
    });
});

// ---------------------------------------------------------------------------
// REST wire mapping
//
// This is the layer the builder's tests used to claim: canonical operators
// become PostgREST short codes here, and nowhere earlier.
// ---------------------------------------------------------------------------
describe("canonical → REST mapping (buildQueryString)", () => {
    const wire = (op: WhereFilterOp, value: unknown) =>
        decodeURIComponent(buildQueryString({ where: { a: [op, value] } }));

    it.each([
        ["==", 1, "?a=eq.1"],
        ["!=", 1, "?a=neq.1"],
        [">", 1, "?a=gt.1"],
        [">=", 1, "?a=gte.1"],
        ["<", 1, "?a=lt.1"],
        ["<=", 1, "?a=lte.1"],
        ["like", "x%", "?a=like.x%"],
        ["ilike", "x%", "?a=ilike.x%"],
        ["not-like", "x%", "?a=nlike.x%"],
        ["not-ilike", "x%", "?a=nilike.x%"],
        ["is-null", null, "?a=isnull.null"],
        ["is-not-null", null, "?a=notnull.null"]
    ] as [WhereFilterOp, unknown, string][])("%s serializes to %s", (op, value, expected) => {
        expect(wire(op, value)).toBe(expected);
    });

    it.each([
        ["in", ["x", "y"], "?a=in.(x,y)"],
        ["not-in", ["x", "y"], "?a=nin.(x,y)"],
        ["array-contains", "x", "?a=cs.x"],
        ["array-contains-any", ["x", "y"], "?a=csa.(x,y)"]
    ] as [WhereFilterOp, unknown, string][])("%s serializes to %s", (op, value, expected) => {
        expect(wire(op, value)).toBe(expected);
    });

    it("rejects an operator that is not canonical", () => {
        // The builder happily stores whatever it is handed, so an unknown
        // operator only surfaces here — loudly, rather than as a query the
        // server cannot parse.
        // Deliberately invalid: a REST short code where a canonical operator belongs, which the types rule out.
        expect(() => buildQueryString({ where: { a: ["gt" as never, 5] } }))
            .toThrow(/unknown operator/);
    });
});
