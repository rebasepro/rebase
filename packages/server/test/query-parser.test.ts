import { mapOperator, parseQueryOptions, DEFAULT_LIST_LIMIT, DEFAULT_VECTOR_LIST_LIMIT, MAX_LIST_LIMIT } from "../src/api/rest/query-parser";
import { deserializeFilter } from "@rebasepro/common";
import { ALL_WHERE_FILTER_OPS, NULL_OPS } from "@rebasepro/types";

/**
 * Assert that a query is rejected as a 400 carrying `code`.
 *
 * The status and code are what make the difference between a client seeing
 * what it got wrong and the API error handler reporting an incident with an
 * opaque "An unexpected error occurred" — so both are asserted, not just the
 * fact that something threw.
 *
 * `expected` is asserted for every one of them, on all the rejections this
 * parser raises. It is the flag `errorHandler` reads to log at debug rather
 * than warn, and a malformed query parameter is not an incident: the request
 * never reached the database and the response body already says what to fix.
 * Without this pin, one rejection added without the flag puts a `⚠️` line in
 * production logs on every request from a client holding a stale field name.
 */
function expectBadRequest(query: Record<string, unknown>, code: string): void {
    let caught: unknown;
    try {
        parseQueryOptions(query);
    } catch (e) {
        caught = e;
    }
    // Guards the case where nothing throws at all: an empty catch would
    // otherwise let the assertions below never run.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { statusCode?: number }).statusCode).toBe(400);
    expect((caught as { code?: string }).code).toBe(code);
    expect((caught as { expected?: boolean }).expected).toBe(true);
}

// ─────────────────────────────────────────────────────────────
// mapOperator
// ─────────────────────────────────────────────────────────────
describe("mapOperator", () => {
    it("maps PostgREST operators to Rebase operators", () => {
        expect(mapOperator("eq")).toBe("==");
        expect(mapOperator("neq")).toBe("!=");
        expect(mapOperator("gt")).toBe(">");
        expect(mapOperator("gte")).toBe(">=");
        expect(mapOperator("lt")).toBe("<");
        expect(mapOperator("lte")).toBe("<=");
        expect(mapOperator("in")).toBe("in");
        expect(mapOperator("nin")).toBe("not-in");
        expect(mapOperator("cs")).toBe("array-contains");
        expect(mapOperator("csa")).toBe("array-contains-any");
        // LIKE family + null checks (added with the filter-operators feature)
        expect(mapOperator("like")).toBe("like");
        expect(mapOperator("ilike")).toBe("ilike");
        expect(mapOperator("nlike")).toBe("not-like");
        expect(mapOperator("nilike")).toBe("not-ilike");
        expect(mapOperator("isnull")).toBe("is-null");
        expect(mapOperator("notnull")).toBe("is-not-null");
    });

    it("returns null for unknown operators", () => {
        expect(mapOperator("between")).toBeNull();
        expect(mapOperator("xyz")).toBeNull();
        expect(mapOperator("")).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Pagination
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — pagination", () => {
    it("parses limit", () => {
        const result = parseQueryOptions({ limit: "25" });
        expect(result.limit).toBe(25);
    });

    it("parses offset", () => {
        const result = parseQueryOptions({ offset: "50" });
        expect(result.offset).toBe(50);
    });

    it("calculates offset from page number", () => {
        const result = parseQueryOptions({ page: "3",
limit: "10" });
        expect(result.offset).toBe(20); // (3-1) * 10
    });

    it("uses the default limit for page calculation when limit not set", () => {
        const result = parseQueryOptions({ page: "2" });
        expect(result.offset).toBe(DEFAULT_LIST_LIMIT); // (2-1) * DEFAULT_LIST_LIMIT
        // The returned page size must match the offset stride so pages neither
        // overlap nor gap.
        expect(result.limit).toBe(DEFAULT_LIST_LIMIT);
    });

    it("injects the default limit when none is provided (no unbounded reads)", () => {
        const result = parseQueryOptions({});
        expect(result.limit).toBe(DEFAULT_LIST_LIMIT);
        expect(result.offset).toBeUndefined();
    });

    it("refuses an over-large limit with a 400 naming the ceiling", () => {
        // The core DoS fix was to stop honouring `?limit=100000000` verbatim.
        // Answering it with 1 000 rows was the second half of the bug: a page
        // the caller cannot distinguish from the end of the collection. It is a
        // 400 now, and the message has to carry the number to page by.
        expectBadRequest({ limit: "100000000" }, "INVALID_LIMIT");
        expectBadRequest({ limit: String(MAX_LIST_LIMIT + 1) }, "INVALID_LIMIT");
        expect(() => parseQueryOptions({ limit: "100000000" }))
            .toThrow(new RegExp(`maximum of ${MAX_LIST_LIMIT}`));
    });

    it("honours a limit at or below the maximum unchanged", () => {
        expect(parseQueryOptions({ limit: "50" }).limit).toBe(50);
        expect(parseQueryOptions({ limit: String(MAX_LIST_LIMIT) }).limit).toBe(MAX_LIST_LIMIT);
    });

    it("refuses zero and negative limits (never an unlimited bypass, never a silent 1 row)", () => {
        expectBadRequest({ limit: "0" }, "INVALID_LIMIT");
        expectBadRequest({ limit: "-5" }, "INVALID_LIMIT");
    });

    it("refuses a non-numeric limit rather than serving the default", () => {
        // `?limit=1O0` (letter O) used to serve 50 rows and say nothing.
        expectBadRequest({ limit: "abc" }, "INVALID_LIMIT");
        expectBadRequest({ limit: "50rows" }, "INVALID_LIMIT");
        // An *empty* parameter is still the caller naming no window at all.
        expect(parseQueryOptions({ limit: "" }).limit).toBe(DEFAULT_LIST_LIMIT);
    });

    it("respects caller-supplied default and max bounds", () => {
        expect(parseQueryOptions({}, { defaultLimit: 25 }).limit).toBe(25);
        expect(parseQueryOptions({ limit: "200" }, { maxLimit: 200 }).limit).toBe(200);
        expect(() => parseQueryOptions({ limit: "9999" }, { maxLimit: 200 })).toThrow(/maximum of 200/);
    });

    it("refuses the limit before it can be used as a page stride", () => {
        // `?page=` resolves the limit early, to stride by it. That resolution
        // has to refuse too, or a rejected read still computes an offset.
        expectBadRequest({ page: "3", limit: "100000000" }, "INVALID_LIMIT");
    });

    it("defaults a vector search to the vector page size, not the list default", () => {
        // A vector search must resolve to its own smaller default (10), never
        // the plain-read default (50).
        const result = parseQueryOptions({
            vector_search: "embedding",
            vector: "[0.1,0.2,0.3]"
        });
        expect(result.limit).toBe(DEFAULT_VECTOR_LIST_LIMIT);
        expect(result.limit).not.toBe(DEFAULT_LIST_LIMIT);
        expect(result.vectorSearch).toBeDefined();
    });

    it("still refuses an explicit over-large limit on a vector search", () => {
        expectBadRequest({
            vector_search: "embedding",
            vector: "[0.1,0.2,0.3]",
            limit: "100000000"
        }, "INVALID_LIMIT");
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — PostgREST Filters
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — PostgREST filters", () => {
    it("parses equality filter (implicit eq)", () => {
        const result = parseQueryOptions({ status: "published" });
        expect(result.where?.status).toEqual(["==", "published"]);
    });

    it("parses eq operator explicitly", () => {
        const result = parseQueryOptions({ status: "eq.published" });
        expect(result.where?.status).toEqual(["==", "published"]);
    });

    // NOTE: wire values are preserved as strings. Type coercion is delegated
    // to the schema-aware driver / PostgreSQL parameter binding, which casts
    // by column type. This is the canonical filter-dialect contract, shared
    // byte-for-byte with the SDK/admin path — and it fixes bugs where JS-side
    // coercion corrupted values (e.g. a "07306" zip code becoming 7306).
    it("preserves gt value as a string (driver coerces)", () => {
        const result = parseQueryOptions({ age: "gt.18" });
        expect(result.where?.age).toEqual([">", "18"]);
    });

    it("parses gte operator", () => {
        const result = parseQueryOptions({ price: "gte.9.99" });
        expect(result.where?.price).toEqual([">=", "9.99"]);
    });

    it("parses lt operator", () => {
        const result = parseQueryOptions({ count: "lt.100" });
        expect(result.where?.count).toEqual(["<", "100"]);
    });

    it("parses lte operator", () => {
        const result = parseQueryOptions({ rating: "lte.5" });
        expect(result.where?.rating).toEqual(["<=", "5"]);
    });

    it("parses neq operator", () => {
        const result = parseQueryOptions({ status: "neq.draft" });
        expect(result.where?.status).toEqual(["!=", "draft"]);
    });

    it("preserves boolean literal as a string (driver coerces)", () => {
        const result = parseQueryOptions({ active: "true" });
        expect(result.where?.active).toEqual(["==", "true"]);
    });

    it("preserves numeric-looking string without coercion", () => {
        const result = parseQueryOptions({ zip: "07306" });
        expect(result.where?.zip).toEqual(["==", "07306"]);
    });

    it("expresses IS NULL via the explicit is-null operator", () => {
        const result = parseQueryOptions({ deleted_at: "isnull.null" });
        expect(result.where?.deleted_at).toEqual(["is-null", null]);
    });

    it("treats a literal `null` value as the string 'null' (use isnull for SQL NULL)", () => {
        const result = parseQueryOptions({ deleted_at: "null" });
        expect(result.where?.deleted_at).toEqual(["==", "null"]);
    });

    it("parses numeric strings as strings", () => {
        const result = parseQueryOptions({ quantity: "42" });
        expect(result.where?.quantity).toEqual(["==", "42"]);
    });

    it("parses in operator with array", () => {
        const result = parseQueryOptions({ role: "in.(admin,editor,viewer)" });
        expect(result.where?.role).toEqual(["in", ["admin", "editor", "viewer"]]);
    });

    it("parses in operator with numeric array (values stay strings)", () => {
        const result = parseQueryOptions({ priority: "in.(1,2,3)" });
        expect(result.where?.priority).toEqual(["in", ["1", "2", "3"]]);
    });

    it("produces identical output to the SDK/admin deserializeFilter path", () => {
        // Same wire input, both code paths — this is the whole point of the
        // convergence: the REST parser must not diverge from the shared dialect.
        const wire = { status: "eq.active", age: "gte.18", zip: "07306" };
        const viaParser = parseQueryOptions(wire).where;
        const viaDialect = deserializeFilter(wire);
        expect(viaParser).toEqual(viaDialect);
    });

    it("parses array-contains operator", () => {
        const result = parseQueryOptions({ tags: "cs.javascript" });
        expect(result.where?.tags).toEqual(["array-contains", "javascript"]);
    });

    it("skips reserved query keys", () => {
        const result = parseQueryOptions({
            limit: "10",
            offset: "0",
            orderBy: "name:asc",
            status: "eq.active"
        });
        // Only status should be in where
        expect(result.where?.status).toEqual(["==", "active"]);
        expect(result.where?.limit).toBeUndefined();
        expect(result.where?.offset).toBeUndefined();
        expect(result.where?.orderBy).toBeUndefined();
    });

    it("handles string values with dots that are not operators (fallback to eq)", () => {
        // The value has to survive intact. `toBeDefined()` was satisfied by any
        // truthy result, including the one this test exists to rule out — a
        // parser that read "user@example" as an operator prefix and filtered on
        // the leftover "com", quietly matching the wrong rows.
        expect(parseQueryOptions({ email: "user@example.com" }).where?.email)
            .toEqual(["==", "user@example.com"]);

        // Several dots, none of them an operator, and none of them consumed.
        expect(parseQueryOptions({ name: "a.b.c" }).where?.name)
            .toEqual(["==", "a.b.c"]);

        // And a real prefix is still stripped, so the fallback above is not
        // simply "never parse operators".
        expect(parseQueryOptions({ email: "eq.user@example.com" }).where?.email)
            .toEqual(["==", "user@example.com"]);
        expect(parseQueryOptions({ age: "gte.18" }).where?.age)
            .toEqual([">=", "18"]);
    });

    it("removes empty where object", () => {
        const result = parseQueryOptions({ limit: "10" });
        expect(result.where).toBeUndefined();
    });
});


// ─────────────────────────────────────────────────────────────
// parseQueryOptions — the `?where=` JSON dialect
//
// The OpenAPI document publishes `where` on every GET /api/data/{slug}, and
// the relations docs use it for subcollection lists. The parser never read it:
// `where` was missing from `reservedQueryKeys`, so `?where={...}` compiled as
// a filter on a column literally named "where" — first silently dropped (the
// read then returned the whole table), later a 400 UNKNOWN_FILTER_FIELD.
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — where JSON filter", () => {
    it("parses the documented canonical-tuple form", () => {
        const result = parseQueryOptions({ where: JSON.stringify({ status: ["==", "active"] }) });
        expect(result.where).toEqual({ status: ["==", "active"] });
    });

    it("never leaks `where` itself into the filter", () => {
        const result = parseQueryOptions({ where: JSON.stringify({ status: ["==", "active"] }) });
        // The bug: `where` was treated as a filter field, which no table has.
        expect(result.where?.where).toBeUndefined();
    });

    it("accepts multiple fields and non-string values", () => {
        const result = parseQueryOptions({
            where: JSON.stringify({ status: ["==", "active"],
age: [">=", 18],
role: ["in", ["admin", "editor"]] })
        });
        expect(result.where).toEqual({
            status: ["==", "active"],
            age: [">=", 18],
            role: ["in", ["admin", "editor"]]
        });
    });

    it("normalizes PostgREST dot-strings and bare scalars inside the JSON", () => {
        const result = parseQueryOptions({ where: JSON.stringify({ status: "eq.active",
tier: "gold" }) });
        expect(result.where).toEqual({ status: ["==", "active"],
tier: ["==", "gold"] });
    });

    it("merges with the ?field=op.value dialect", () => {
        const result = parseQueryOptions({
            where: JSON.stringify({ status: ["==", "active"] }),
            age: "gte.18"
        });
        expect(result.where).toEqual({ status: ["==", "active"],
age: [">=", "18"] });
    });

    it("lets an explicit ?field=op.value override the same field in where", () => {
        const result = parseQueryOptions({
            where: JSON.stringify({ status: ["==", "active"] }),
            status: "eq.draft"
        });
        expect(result.where?.status).toEqual(["==", "draft"]);
    });

    it("leaves the other options untouched", () => {
        const result = parseQueryOptions({
            where: JSON.stringify({ status: ["==", "active"] }),
            limit: "5",
            orderBy: "created_at:desc"
        });
        expect(result.limit).toBe(5);
        expect(result.orderBy).toEqual([{ field: "created_at",
direction: "desc" }]);
    });

    it("ignores an empty where", () => {
        expect(parseQueryOptions({ where: "" }).where).toBeUndefined();
        expect(parseQueryOptions({ where: "{}" }).where).toBeUndefined();
    });

    it("rejects malformed JSON with a 400 rather than dropping the filter", () => {
        // Dropping it would widen the read to every row RLS allows.
        expect(() => parseQueryOptions({ where: "{status:" })).toThrow(/Invalid `where` parameter/);
        expectBadRequest({ where: "{status:" }, "INVALID_WHERE");
    });

    it("rejects JSON that is not an object", () => {
        expect(() => parseQueryOptions({ where: "[\"status\",\"active\"]" })).toThrow(/Invalid `where` parameter/);
        expect(() => parseQueryOptions({ where: "\"active\"" })).toThrow(/Invalid `where` parameter/);
        expect(() => parseQueryOptions({ where: "null" })).toThrow(/Invalid `where` parameter/);
    });

    it("takes the last value when the param repeats", () => {
        const result = parseQueryOptions({
            where: [JSON.stringify({ status: ["==", "draft"] }), JSON.stringify({ status: ["==", "active"] })]
        });
        expect(result.where).toEqual({ status: ["==", "active"] });
    });
});


// ─────────────────────────────────────────────────────────────
// parseQueryOptions — unknown filter operators
//
// The shared codec accepted a `[op, value]` tuple only when the operator was
// spelled canonically; everything else fell through to `["in", raw]`, so the
// *operator string became a value in a membership test*. Against a live server
// holding one row `{id:1, title:"Hello"}`:
//
//   where={"title":["~~","Nope"]}       → 200, 0 rows
//   where={"title":["!!","Hello"]}      → 200, 1 row — a FALSE POSITIVE
//   where={"title":["contains","Hell"]} → 200, 0 rows
//   where={"id":[">>",0]}               → 500, `invalid input syntax for integer`
//
// Three failure modes from one root cause: a wrong-but-plausible answer, a row
// the caller's filter was written to exclude, and a raw Postgres error where a
// 400 belongs. An unknown filter *field* has answered 400 UNKNOWN_FILTER_FIELD
// with the valid set enumerated for a while; operators were left behind.
//
// The rejection is raised in `@rebasepro/common` — which cannot throw an
// ApiError, since the browser SDK decodes through the same function — and
// converted here. These assertions are on the conversion: status, code and the
// `details` a client reads, not merely that something threw.
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — unknown filter operators", () => {
    const probes: [string, Record<string, unknown>][] = [
        ["a symbolic operator", { title: ["~~", "Nope"] }],
        ["the one that returned a false positive", { title: ["!!", "Hello"] }],
        ["the name a developer guesses first", { title: ["contains", "Hell"] }],
        ["the one that reached Postgres and 500'd", { id: [">>", 0] }]
    ];

    it.each(probes)("rejects %s in the where JSON dialect", (_label, filter) => {
        expectBadRequest({ where: JSON.stringify(filter) }, "UNKNOWN_FILTER_OPERATOR");
    });

    it("names the operator, the field, and the supported set", () => {
        let caught: unknown;
        try {
            parseQueryOptions({ where: JSON.stringify({ title: ["contains", "Hell"] }) });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Error);
        const error = caught as { message: string; details?: Record<string, unknown> };
        expect(error.message).toContain("'contains'");
        expect(error.message).toContain("'title'");
        expect(error.message).toContain("array-contains");
        expect(error.details).toEqual({
            field: "title",
            operator: "contains",
            validOperators: ALL_WHERE_FILTER_OPS
        });
    });

    it("rejects one inside a list of conditions on the same field", () => {
        expectBadRequest(
            { where: JSON.stringify({ age: [[">=", 18], ["~~", 65]] }) },
            "UNKNOWN_FILTER_OPERATOR"
        );
    });

    it("leaves every legitimate filter shape working", () => {
        // A genuine two-item value list — the shape the rejection must not eat.
        expect(parseQueryOptions({ where: JSON.stringify({ tags: ["a", "b"] }) }).where)
            .toEqual({ tags: ["in", ["a", "b"]] });
        // Repeated `?tags=a&tags=b` arrives at the codec identically.
        expect(parseQueryOptions({ tags: ["a", "b"] }).where)
            .toEqual({ tags: ["in", ["a", "b"]] });
        // The PostgREST dot-string dialect.
        expect(parseQueryOptions({ status: "eq.active" }).where)
            .toEqual({ status: ["==", "active"] });
        expect(parseQueryOptions({ age: ["gte.18", "lt.65"] }).where)
            .toEqual({ age: [[">=", "18"], ["<", "65"]] });
        // Every canonical operator.
        for (const op of ALL_WHERE_FILTER_OPS) {
            const value = NULL_OPS.has(op) ? null : "x";
            expect(parseQueryOptions({ where: JSON.stringify({ field: [op, value] }) }).where)
                .toEqual({ field: [op, value] });
        }
    });

    it("rejects on the querystring dialect too, not just the JSON one", () => {
        // `?title=~~&title=Nope` is the same two-element array one layer up.
        expectBadRequest({ title: ["~~", "Nope"] }, "UNKNOWN_FILTER_OPERATOR");
    });
});


// ─────────────────────────────────────────────────────────────
// parseQueryOptions — vector search validation
//
// These rejections used to be bare `Error`s. The API error handler reads
// `statusCode`/`code` off the error; a bare Error has neither, so a malformed
// client request became a 500 — logged as an incident with a full stack, and
// answered with "An unexpected error occurred" (the handler only forwards the
// real message below 500), telling the caller nothing about what was wrong.
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — vector search validation", () => {
    it("accepts a well-formed vector search", () => {
        const result = parseQueryOptions({
            vector_search: "embedding",
            vector: "[0.1,0.2,0.3]",
            vector_distance: "l2",
            vector_threshold: "0.8"
        });
        expect(result.vectorSearch).toEqual({
            property: "embedding",
            vector: [0.1, 0.2, 0.3],
            distance: "l2",
            threshold: 0.8
        });
    });

    it("rejects a vector that is not valid JSON", () => {
        expectBadRequest({ vector_search: "embedding",
vector: "[0.1,0.2" }, "INVALID_VECTOR");
    });

    it("rejects a vector that is not an array", () => {
        expectBadRequest({ vector_search: "embedding",
vector: "0.5" }, "INVALID_VECTOR");
    });

    it("rejects a vector holding non-numbers", () => {
        expectBadRequest({ vector_search: "embedding",
vector: "[0.1,\"two\",0.3]" }, "INVALID_VECTOR");
        expectBadRequest({ vector_search: "embedding",
vector: "[0.1,null]" }, "INVALID_VECTOR");
    });

    it("rejects an unknown vector_distance", () => {
        expectBadRequest({
            vector_search: "embedding",
            vector: "[0.1,0.2]",
            vector_distance: "manhattan"
        }, "INVALID_VECTOR_DISTANCE");
    });

    it("rejects a non-numeric vector_threshold", () => {
        expectBadRequest({
            vector_search: "embedding",
            vector: "[0.1,0.2]",
            vector_threshold: "high"
        }, "INVALID_VECTOR_THRESHOLD");
    });

    it("names the offending parameter in the message", () => {
        expect(() => parseQueryOptions({ vector_search: "embedding",
vector: "nope" })).toThrow(/`vector` format/);
        expect(() => parseQueryOptions({
            vector_search: "embedding",
            vector: "[0.1]",
            vector_distance: "manhattan"
        })).toThrow(/`vector_distance`: manhattan/);
    });

    it("ignores vector params unless both vector_search and vector are present", () => {
        // Half a vector search is not a vector search — and not an error either.
        expect(parseQueryOptions({ vector: "garbage" }).vectorSearch).toBeUndefined();
        expect(parseQueryOptions({ vector_search: "embedding" }).vectorSearch).toBeUndefined();
    });
});


// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Sorting
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — sorting", () => {
    it("parses JSON orderBy", () => {
        const orderBy = JSON.stringify([{ field: "name",
direction: "asc" }]);
        const result = parseQueryOptions({ orderBy });
        expect(result.orderBy).toEqual([{ field: "name",
direction: "asc" }]);
    });

    it("parses simple field:direction format", () => {
        const result = parseQueryOptions({ orderBy: "created_at:desc" });
        expect(result.orderBy).toEqual([{ field: "created_at",
direction: "desc" }]);
    });

    it("defaults direction to asc", () => {
        const result = parseQueryOptions({ orderBy: "name" });
        expect(result.orderBy).toEqual([{ field: "name",
direction: "asc" }]);
    });

    it("handles no orderBy", () => {
        const result = parseQueryOptions({});
        expect(result.orderBy).toBeUndefined();
    });

    it("accepts a JSON string and a JSON array of field names", () => {
        expect(parseQueryOptions({ orderBy: "\"created_at:desc\"" }).orderBy)
            .toEqual([{ field: "created_at", direction: "desc" }]);
        expect(parseQueryOptions({ orderBy: "[\"name\"]" }).orderBy)
            .toEqual([{ field: "name", direction: "asc" }]);
    });

    it("reads a direction in any case", () => {
        expect(parseQueryOptions({ orderBy: JSON.stringify([{ field: "name", direction: "DESC" }]) }).orderBy)
            .toEqual([{ field: "name", direction: "desc" }]);
    });

    /**
     * The shorthand is the spelling the SDK emits and the one the OpenAPI
     * document advertises, and it was the one path that never reached
     * `toDirection`: it went through `deserializeOrderBy` first, which is the
     * client end of the codec and collapses anything that is not literally
     * "desc" to "asc". So `?orderBy=created_at:DESC` answered 200 with the rows
     * in ascending order — a "newest first" list showing the oldest rows —
     * and `:sideways` did the same.
     */
    it("reads the shorthand direction in any case", () => {
        expect(parseQueryOptions({ orderBy: "created_at:DESC" }).orderBy)
            .toEqual([{ field: "created_at", direction: "desc" }]);
        expect(parseQueryOptions({ orderBy: "created_at:Desc" }).orderBy)
            .toEqual([{ field: "created_at", direction: "desc" }]);
        expect(parseQueryOptions({ orderBy: "\"created_at:DESC\"" }).orderBy)
            .toEqual([{ field: "created_at", direction: "desc" }]);
        expect(parseQueryOptions({ orderBy: "[\"created_at:DESC\"]" }).orderBy)
            .toEqual([{ field: "created_at", direction: "desc" }]);
    });

    it("refuses a shorthand direction that names no order", () => {
        expectBadRequest({ orderBy: "created_at:sideways" }, "INVALID_ORDER_BY");
        expectBadRequest({ orderBy: "created_at:descending" }, "INVALID_ORDER_BY");
        expectBadRequest({ orderBy: "created_at:" }, "INVALID_ORDER_BY");
    });

    it("treats an empty list as no sort at all", () => {
        expect(parseQueryOptions({ orderBy: "[]" }).orderBy).toBeUndefined();
    });

    // The sort *field* has been schema-checked for a while, on the grounds that
    // answering 200 with unsorted rows leaves the caller believing in an order
    // that is not there. The parameter's *shape* was not, and it failed the
    // same silent way one layer earlier: anything `JSON.parse` returned was
    // assigned to an option the REST layer reads as `orderBy[0].field`, so each
    // of these dropped the ORDER BY and answered 200.
    describe("a shape that cannot carry a sort is refused, not ignored", () => {
        it("refuses a single object where an array belongs", () => {
            // The most natural wrong guess, and the one that used to be silent.
            expectBadRequest({ orderBy: "{\"field\":\"name\",\"direction\":\"asc\"}" }, "INVALID_ORDER_BY");
        });

        it("refuses scalars that are not field names", () => {
            expectBadRequest({ orderBy: "5" }, "INVALID_ORDER_BY");
            expectBadRequest({ orderBy: "true" }, "INVALID_ORDER_BY");
            expectBadRequest({ orderBy: "null" }, "INVALID_ORDER_BY");
        });

        it("refuses a list entry with no field", () => {
            expectBadRequest({ orderBy: "[{\"direction\":\"asc\"}]" }, "INVALID_ORDER_BY");
            expectBadRequest({ orderBy: "[{\"field\":42}]" }, "INVALID_ORDER_BY");
            expectBadRequest({ orderBy: "[{\"field\":\"  \"}]" }, "INVALID_ORDER_BY");
            expectBadRequest({ orderBy: "[[\"name\"]]" }, "INVALID_ORDER_BY");
        });

        it("refuses a direction that names no order", () => {
            // Silently coercing this to `asc` returns rows in an order the
            // caller did not ask for and has no way to notice.
            expectBadRequest({ orderBy: JSON.stringify([{ field: "name", direction: "sideways" }]) }, "INVALID_ORDER_BY");
            expectBadRequest({ orderBy: JSON.stringify([{ field: "name", direction: 1 }]) }, "INVALID_ORDER_BY");
        });
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Relation includes
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — includes", () => {
    it("parses wildcard include", () => {
        const result = parseQueryOptions({ include: "*" });
        expect(result.include).toEqual(["*"]);
    });

    it("parses comma-separated includes", () => {
        const result = parseQueryOptions({ include: "author,tags,category" });
        expect(result.include).toEqual(["author", "tags", "category"]);
    });

    it("trims whitespace in includes", () => {
        const result = parseQueryOptions({ include: " author , tags " });
        expect(result.include).toEqual(["author", "tags"]);
    });

    it("handles no include", () => {
        const result = parseQueryOptions({});
        expect(result.include).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// parseQueryOptions — Field selection
// ─────────────────────────────────────────────────────────────
describe("parseQueryOptions — fields", () => {
    it("parses comma-separated fields", () => {
        const result = parseQueryOptions({ fields: "id,name,email" });
        expect(result.fields).toEqual(["id", "name", "email"]);
    });

    it("trims whitespace", () => {
        const result = parseQueryOptions({ fields: " id , name " });
        expect(result.fields).toEqual(["id", "name"]);
    });

    it("handles no fields", () => {
        const result = parseQueryOptions({});
        expect(result.fields).toBeUndefined();
    });
});
