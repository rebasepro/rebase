/**
 * The client→server query contract.
 *
 * Two modules, two packages, no shared type between them: the SDK's
 * `buildQueryString` writes a URL, and the server's `parseQueryOptions` reads
 * one. Everything in between — the operator codes, the escaping, which
 * parameter names are reserved — is agreement by convention, and a convention
 * that drifts fails in one specific way: the server builds a query with one
 * fewer constraint than the caller asked for, and answers 200.
 *
 * A dropped `where` runs the read unfiltered and returns everything RLS happens
 * to allow. A dropped `orderBy` returns rows in whatever order the planner
 * chose, to a caller that is paginating and will therefore skip some and repeat
 * others. Neither raises anything.
 *
 * So the property is not "the round trip is faithful" — the wire is lossy about
 * types on purpose. It is **nothing is silently lost**: every constraint the
 * client expressed is still present, and no constraint the client did not
 * express has appeared.
 */

import fc from "fast-check";
import { ALL_WHERE_FILTER_OPS, NULL_OPS, WhereFilterOp } from "@rebasepro/types";
import { RESERVED_QUERY_KEYS } from "@rebasepro/common";
import { buildAggregateQueryString, buildQueryString } from "../../../client/src/transport";
import { parseQueryOptions, MAX_LIST_LIMIT } from "../../src/api/rest/query-parser";
import { DELETED_QUERY_PARAM, HARD_DELETE_QUERY_PARAM } from "../../src/api/rest/soft-delete-params";

const RUNS = Number(process.env.FC_RUNS ?? 2000);

/**
 * What Hono's `c.req.queries()` hands the parser: every key mapped to the list
 * of its values, repeated parameters preserved. Reproduced here rather than
 * mocked, because the parser's handling of repeated parameters — a field with
 * several conditions on it — is one of the things being checked.
 */
function honoQueries(queryString: string): Record<string, string[]> {
    const params = new URLSearchParams(queryString.replace(/^\?/, ""));
    const out: Record<string, string[]> = {};
    for (const [key, value] of params.entries()) {
        (out[key] ??= []).push(value);
    }
    return out;
}

const roundTrip = (params: Record<string, unknown>) =>
    parseQueryOptions(honoQueries(buildQueryString(params as never)));

/** Field names that are not reserved query parameters — see the tests at the bottom. */
const fieldName = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/).filter(f => !RESERVED_QUERY_KEYS.has(f));

const scalarValue = fc.oneof(
    fc.stringMatching(/^[a-zA-Z0-9 @._%+-]{0,12}$/),
    fc.constantFrom("a,b", "a\\b", "x y", "100%", ""),
    fc.integer({ min: -999, max: 999 }),
    fc.boolean()
);

const whereOp: fc.Arbitrary<WhereFilterOp> = fc.constantFrom(...ALL_WHERE_FILTER_OPS);

const filterTuple = whereOp.chain(op => {
    if (op === "in" || op === "not-in" || op === "array-contains-any") {
        return fc.array(scalarValue, { minLength: 1, maxLength: 3 })
            .map(v => [op, v] as [WhereFilterOp, unknown]);
    }
    if (NULL_OPS.has(op)) return fc.constant([op, null] as [WhereFilterOp, unknown]);
    return scalarValue.map(v => [op, v] as [WhereFilterOp, unknown]);
});

const findParams = fc.record({
    limit: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
    offset: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
    orderBy: fc.option(
        fc.tuple(fieldName, fc.constantFrom("asc" as const, "desc" as const)),
        { nil: undefined }
    ),
    where: fc.option(fc.dictionary(fieldName, filterTuple, { maxKeys: 4 }), { nil: undefined }),
    include: fc.option(fc.array(fieldName, { minLength: 1, maxLength: 3 }), { nil: undefined })
}, { requiredKeys: [] });

describe("client → server query contract", () => {

    it("survives the trip without throwing, for any well-formed params", () => {
        fc.assert(fc.property(findParams, params => {
            expect(() => roundTrip(params as never)).not.toThrow();
        }), { numRuns: RUNS });
    });

    /**
     * The one that matters. A filter the caller wrote must still be a filter
     * the server will apply — losing it does not narrow the read, it widens it
     * to the whole table.
     */
    it("keeps every filtered field", () => {
        fc.assert(fc.property(findParams, params => {
            if (!params.where || Object.keys(params.where).length === 0) return;
            const options = roundTrip(params as never);
            for (const field of Object.keys(params.where)) {
                expect(Object.keys(options.where ?? {})).toContain(field);
            }
        }), { numRuns: RUNS });
    });

    /** …and the operator on it, since a degraded operator widens just as well. */
    it("keeps the operator on every filtered field", () => {
        fc.assert(fc.property(findParams, params => {
            if (!params.where) return;
            const options = roundTrip(params as never);
            for (const [field, tuple] of Object.entries(params.where)) {
                const received = (options.where ?? {})[field] as [WhereFilterOp, unknown];
                expect({ field, op: Array.isArray(received[0]) ? received[0] : received[0] })
                    .toEqual({ field, op: (tuple as [WhereFilterOp, unknown])[0] });
            }
        }), { numRuns: RUNS });
    });

    /**
     * Nothing appears that the caller did not ask for. An invented filter is
     * the mirror image and just as silent — it narrows a read, so the caller
     * sees missing rows rather than an error.
     */
    it("invents no filter the client did not send", () => {
        fc.assert(fc.property(findParams, params => {
            const options = roundTrip(params as never);
            const sent = new Set(Object.keys(params.where ?? {}));
            for (const field of Object.keys(options.where ?? {})) {
                expect(sent.has(field)).toBe(true);
            }
        }), { numRuns: RUNS });
    });

    /**
     * A dropped sort is invisible: the rows come back, just not in the order
     * the caller is paginating against, so they skip some and repeat others.
     * The repo already treats a *misspelled* sort field as a 400 for this
     * reason; this is the same guarantee one layer earlier.
     */
    it("keeps the sort field and direction", () => {
        fc.assert(fc.property(findParams, params => {
            if (!params.orderBy) return;
            const options = roundTrip(params as never);
            expect(options.orderBy?.[0]).toEqual({
                field: params.orderBy[0],
                direction: params.orderBy[1]
            });
        }), { numRuns: RUNS });
    });

    it("keeps offset and every requested relation include", () => {
        fc.assert(fc.property(findParams, params => {
            const options = roundTrip(params as never);
            if (params.offset) expect(options.offset).toBe(params.offset);
            if (params.include?.length) {
                // The *set*, not the array. `include` is a graph now, so the
                // codec de-duplicates: asking for one relation twice is the
                // same request, and loading it twice would be two identical
                // queries. Order is not meaningful either — the relations of
                // one row are loaded independently of each other.
                const asked = new Set(params.include);
                const got = new Set(
                    Array.isArray(options.include)
                        ? options.include
                        : Object.keys(options.include ?? {})
                );
                expect([...got].sort()).toEqual([...asked].sort());
            }
        }), { numRuns: RUNS });
    });

    /**
     * The limit is the one parameter that is *deliberately* not preserved — it
     * is clamped, because honouring `?limit=100000000` buffers the table into a
     * JSON response. The property is that the clamp is the only thing that
     * happens to it: never larger than asked for, never larger than the cap,
     * and always present so a bare read cannot become unbounded.
     */
    it("clamps the limit downward and never leaves it unset", () => {
        fc.assert(fc.property(findParams, params => {
            const options = roundTrip(params as never);
            expect(typeof options.limit).toBe("number");
            expect(options.limit!).toBeGreaterThan(0);
            expect(options.limit!).toBeLessThanOrEqual(MAX_LIST_LIMIT);
            if (params.limit != null) expect(options.limit!).toBeLessThanOrEqual(params.limit);
        }), { numRuns: RUNS });
    });

    /**
     * Several conditions on one field travel as repeated query parameters, and
     * the server reads them with `c.req.queries()` — which is what this test
     * reproduces. Reading them with `c.req.query()` instead would keep only the
     * first, turning `18 <= age < 65` into `age >= 18`: a wider result set, no
     * error.
     */
    it("keeps every condition when a field carries several", () => {
        fc.assert(fc.property(
            fieldName,
            fc.array(filterTuple, { minLength: 2, maxLength: 4 }),
            (field, tuples) => {
                const options = roundTrip({ where: { [field]: tuples } });
                const received = (options.where ?? {})[field];
                expect(Array.isArray(received?.[0])).toBe(true);
                expect(received as unknown[]).toHaveLength(tuples.length);
            }
        ), { numRuns: RUNS });
    });
});

describe("reserved parameter names", () => {

    /**
     * A collection is free to have a column named `page`, `select`, `hard` or
     * `where`, and the SDK serialized every filter as `?<field>=<op>.<value>`.
     * On a name the parser reads as a parameter, the filter was never applied:
     * most were dropped with no diagnostic, so the read returned every row the
     * caller may see; the window parameters answered 400. The SDK now sends a
     * filter on such a column inside `?where=`, which the parser merges in.
     */
    it("reserves the soft-delete switches the parser reads", () => {
        expect(RESERVED_QUERY_KEYS.has(DELETED_QUERY_PARAM)).toBe(true);
        expect(RESERVED_QUERY_KEYS.has(HARD_DELETE_QUERY_PARAM)).toBe(true);
    });

    it.each([...RESERVED_QUERY_KEYS])("applies a filter on a column named %p", (name) => {
        const options = roundTrip({ where: { [name]: ["==", "x"], status: ["!=", "gone"] } });
        expect(options.where).toEqual({ [name]: ["==", "x"], status: ["!=", "gone"] });
    });

    it("keeps every condition on a reserved-name column", () => {
        const options = roundTrip({ where: { page: [[">=", 2], ["<", 5]], hard: ["in", ["a", "b,c"]] } });
        expect(options.where).toEqual({ page: [[">=", "2"], ["<", "5"]], hard: ["in", ["a", "b,c"]] });
    });

    it("applies it through an aggregate's query string too", () => {
        const qs = buildAggregateQueryString({
            select: [{ fn: "count" }],
            groupBy: ["status"],
            where: { select: ["==", "x"], groupBy: ["is-null", null] }
        } as never);
        const query = honoQueries(qs);
        expect(query.select).toEqual(["count()"]);
        expect(query.groupBy).toEqual(["status"]);
        expect(parseQueryOptions(query).where).toEqual({ select: ["==", "x"], groupBy: ["is-null", null] });
    });

    /**
     * The complement: a field name that is not reserved still travels as its
     * own parameter, exactly as before.
     */
    it("applies a filter on any non-reserved column name", () => {
        fc.assert(fc.property(fieldName, field => {
            const options = roundTrip({ where: { [field]: ["==", "x"] } });
            expect(options.where && field in options.where).toBe(true);
            expect(buildQueryString({ where: { [field]: ["==", "x"] } } as never))
                .toBe(`?${encodeURIComponent(field)}=eq.x`);
        }), { numRuns: RUNS });
    });
});
