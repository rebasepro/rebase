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
import { buildQueryString } from "../../../client/src/transport";
import { parseQueryOptions, MAX_LIST_LIMIT } from "../../src/api/rest/query-parser";

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

/** Field names that are not reserved query parameters — see the collision test below. */
const RESERVED = [
    "limit", "offset", "page", "orderBy", "include", "fields", "searchString",
    "vector_search", "vector", "vector_distance", "vector_threshold", "or", "and", "where"
];
const fieldName = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/).filter(f => !RESERVED.includes(f));

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
            if (params.include?.length) expect(options.include).toEqual(params.include);
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
     * **A real collision, pinned rather than asserted away.**
     *
     * The parser reserves fourteen query-parameter names, and the SDK serializes
     * a filter as `?<field>=<op>.<value>`. A collection with a column named
     * `page` — not exotic in a CMS — therefore sends `?page=eq.home`, which the
     * server reads as a pagination instruction. The filter is not applied and
     * nothing is reported: the read returns every row the caller may see,
     * rather than the ones on the `home` page.
     *
     * `where`, `and`, `or`, `include`, `fields` and `limit` are all plausible
     * column names with the same problem.
     *
     * Not fixed here: the fix is a wire change (namespacing filters, or an
     * explicit `?where=` for colliding fields) and it needs to be chosen
     * deliberately. What this test does is make the set of unusable column
     * names explicit and fail if it grows silently — adding a reserved
     * parameter name is, today, a breaking change for anyone whose schema
     * already uses it.
     */
    it("KNOWN: a filter on a reserved-name column is silently not applied", () => {
        const options = roundTrip({ where: { page: ["==", "home"] } });
        expect(options.where).toBeUndefined();
        // …and it was read as pagination instead.
        expect(options.offset).toBeDefined();
    });

    /**
     * The full classification, because the names do not all fail the same way
     * and the difference is the whole point: thirteen of the fourteen lose the
     * filter with no diagnostic, while `where` happens to 400 because
     * `eq.x` is not JSON. Loud is strictly better than silent here, and the
     * table below is what the fix would have to make uniform.
     */
    it("pins how each reserved name fails", () => {
        const classify = (name: string): "applied" | "silently-dropped" | "rejected" => {
            try {
                const options = roundTrip({ where: { [name]: ["==", "x"] } });
                return options.where && name in options.where ? "applied" : "silently-dropped";
            } catch {
                return "rejected";
            }
        };
        const actual = Object.fromEntries(RESERVED.map(n => [n, classify(n)]));
        expect(actual).toEqual({
            limit: "silently-dropped",
            offset: "silently-dropped",
            page: "silently-dropped",
            orderBy: "silently-dropped",
            include: "silently-dropped",
            fields: "silently-dropped",
            searchString: "silently-dropped",
            vector_search: "silently-dropped",
            vector: "silently-dropped",
            vector_distance: "silently-dropped",
            vector_threshold: "silently-dropped",
            or: "silently-dropped",
            and: "silently-dropped",
            // The only one that tells the caller anything, and only by accident:
            // `eq.x` fails `JSON.parse` in the where-dialect parser.
            where: "rejected"
        });
    });

    /**
     * The complement, and the reassuring half: a field name that is *not*
     * reserved always makes it through. This is what stops the finding above
     * from being read as "filters are unreliable" — they are reliable
     * everywhere except a nameable, finite set.
     */
    it("applies a filter on any non-reserved column name", () => {
        fc.assert(fc.property(fieldName, field => {
            const options = roundTrip({ where: { [field]: ["==", "x"] } });
            expect(options.where && field in options.where).toBe(true);
        }), { numRuns: RUNS });
    });
});
