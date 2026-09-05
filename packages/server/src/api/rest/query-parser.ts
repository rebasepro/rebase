import type { FilterValues, ListLimitBounds, LogicalCondition, OrderByTuple, VectorSearchParams } from "@rebasepro/types";
import { toCanonicalOp, resolveClientListLimit, ListLimitError, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";
import { deserializeFilter, deserializeLogicalCondition, UnknownFilterOperatorError } from "@rebasepro/common";
import { QueryOptions } from "../types";
import { ApiError } from "../errors";

export const mapOperator = (op: string) => toCanonicalOp(op) ?? null;

/**
 * A malformed query parameter, refused with a 400.
 *
 * Every rejection in this file is one of these, and every one of them is
 * `expected` — the flag `errorHandler` reads to log a routine outcome at debug
 * instead of warn. A client that mistypes an operator, a sort direction or a
 * limit is not an incident: nothing on the server is wrong, the request never
 * reached the database, and the caller has already been told what to fix in the
 * response body. Left at warn, a single frontend holding a stale field name
 * writes a `⚠️` line per request forever, and the warn level stops meaning
 * anything — which is why "routine 4xx logs at WARN" is a standing finding
 * against this API.
 *
 * Not a factory on `ApiError`: the class's members are part of the tracked
 * runtime surface (`api-surface/server.api.txt`), and this needs no addition to
 * it. `ApiError.unauthenticated` is the same idea one status code up.
 */
function invalidParam(message: string, code: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details, true);
}

/**
 * Decode a filter, turning the shared codec's operator rejection into a 400.
 *
 * `deserializeFilter` lives in `@rebasepro/common`, which cannot throw an
 * `ApiError` — it does not depend on this package, and the browser SDK decodes
 * through the same function and has nothing to render one with. So it throws
 * `UnknownFilterOperatorError`, and the HTTP boundary is where that becomes a
 * status code. Same seam `parseLogicalGroup` uses for the nesting bound.
 *
 * Without this the operator string became a *value*: `?where={"title":
 * ["!!","Hello"]}` compiled to `title IN ('!!','Hello')` and answered 200 with
 * the row the caller was filtering out, and `{"id":[">>",0]}` reached Postgres
 * and came back a 500 quoting `invalid input syntax for type integer`. Both are
 * malformed requests and now say so.
 */
function decodeFilter(query: Record<string, unknown>): FilterValues<string> {
    try {
        return deserializeFilter(query);
    } catch (e) {
        if (e instanceof UnknownFilterOperatorError) {
            throw invalidParam(e.message, e.code, e.details);
        }
        throw e;
    }
}

function getLastValue(val: unknown): unknown {
    if (Array.isArray(val)) {
        return val[val.length - 1];
    }
    return val;
}

/**
 * Parse an `or(...)` / `and(...)` logical group from its wire form.
 *
 * The wire carries the inner conditions wrapped in parens (e.g.
 * `(status.eq.active,age.gte.18)`); we re-attach the `or`/`and` prefix and
 * delegate to the canonical filter dialect (`@rebasepro/common`). Values are
 * preserved as strings — type coercion is the schema-aware driver's job, so
 * this path stays byte-for-byte consistent with the SDK/admin path (which
 * also parses via the shared dialect).
 */
function parseLogicalGroup(type: "or" | "and", raw: unknown): LogicalCondition | undefined {
    let inner = String(raw).trim();
    if (inner.startsWith("(") && inner.endsWith(")")) {
        inner = inner.slice(1, -1);
    }
    inner = inner.trim();
    if (!inner) return undefined;
    let parsed;
    try {
        parsed = deserializeLogicalCondition(`${type}(${inner})`);
    } catch (e) {
        // The parser refuses a nesting depth no real filter reaches. That is a
        // request problem, and without this it surfaced as a 500 — the
        // unbounded version reached `RangeError: Maximum call stack size
        // exceeded`, which tells the caller nothing about their filter.
        throw invalidParam(
            `Invalid \`${type}\` parameter: ${e instanceof Error ? e.message : String(e)}`,
            "INVALID_LOGICAL_GROUP"
        );
    }
    return "type" in parsed ? parsed : undefined;
}

/**
 * Parse the `?where=` JSON filter object.
 *
 * This is the dialect the OpenAPI document publishes on every
 * `GET /api/data/{slug}` — `{"status":["==","active"]}`: field → canonical
 * `[WhereFilterOp, value]` tuple. It is normalized through the same
 * `deserializeFilter` as the `?field=op.value` params below, so a value that
 * arrives as a PostgREST dot-string (`{"status":"eq.active"}`) or as a bare
 * scalar (`{"status":"active"}`) compiles to the same condition. Unlike the
 * querystring dialect, JSON carries types — a number stays a number.
 *
 * A malformed value is a 400 rather than a silent drop: dropping the filter
 * would run the read unfiltered and return everything RLS happens to allow.
 */
function parseWhereParam(raw: unknown): FilterValues<string> | undefined {
    const str = String(raw).trim();
    if (!str) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(str);
    } catch {
        throw invalidParam(
            "Invalid `where` parameter: expected a JSON object, e.g. {\"status\":[\"==\",\"active\"]}",
            "INVALID_WHERE"
        );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw invalidParam(
            "Invalid `where` parameter: expected a JSON object mapping fields to conditions, "
            + "e.g. {\"status\":[\"==\",\"active\"]}",
            "INVALID_WHERE"
        );
    }

    const filter = decodeFilter(parsed as Record<string, unknown>);
    return Object.keys(filter).length > 0 ? filter : undefined;
}

type OrderByEntry = { field: string; direction: "asc" | "desc" };

/**
 * The parsed entries as the driver contract spells them: `[field, direction]`
 * tuples in order of significance.
 *
 * The REST layer used to hand the driver `orderBy[0].field` and drop the rest,
 * so `?orderBy=[{"field":"roles"},{"field":"created_at","direction":"desc"}]`
 * — a shape this parser has always accepted and validated in full — sorted by
 * `roles` alone and returned the ties in whatever order Postgres pleased.
 */
export function orderByEntriesToTuples(entries?: OrderByEntry[]): OrderByTuple[] | undefined {
    if (!entries || entries.length === 0) return undefined;
    return entries.map(({ field, direction }) => [field, direction] as OrderByTuple);
}

function invalidOrderBy(detail: string): never {
    throw invalidParam(
        `Invalid \`orderBy\` parameter: ${detail}. Expected \`field\`, \`field:desc\`, `
        + "or a JSON array like [{\"field\":\"created_at\",\"direction\":\"desc\"}]",
        "INVALID_ORDER_BY"
    );
}

/** The aggregate functions `?select=` accepts. */
const AGGREGATE_FUNCTIONS = new Set(["count", "sum", "avg", "min", "max"]);

export interface ParsedAggregate {
    fn: "count" | "sum" | "avg" | "min" | "max";
    /** Absent only for `count()`, which counts rows rather than values. */
    field?: string;
    /** The key this appears under in the response. */
    alias: string;
}

/**
 * Parse `?select=count(),sum(total),avg(total)`.
 *
 * The spelling is SQL's, because whoever writes it is thinking in SQL and
 * because any other spelling has to be learned first. `count()` with no field
 * counts rows; every other function names a column.
 *
 * Aliases are derived rather than accepted: `sum(total)` returns as
 * `sum_total`, `count()` as `count`. Letting a caller choose would mean
 * checking their alias is not also a `groupBy` field — a rule nobody would
 * guess, and a silently overwritten value if it went unchecked.
 */
export function parseAggregateSelect(raw: unknown): ParsedAggregate[] | undefined {
    const value = getLastValue(raw);
    if (!value) return undefined;

    const entries = String(value).split(",").map(s => s.trim()).filter(Boolean);
    if (entries.length === 0) return undefined;

    return entries.map((entry) => {
        const match = /^([a-z]+)\(\s*([A-Za-z0-9_]*)\s*\)$/i.exec(entry);
        if (!match) {
            throw invalidParam(
                `Invalid \`select\` entry "${entry}". Expected \`fn(field)\`, e.g. \`sum(total)\` or \`count()\`.`,
                "INVALID_AGGREGATE_SELECT"
            );
        }

        const fn = match[1].toLowerCase();
        const field = match[2] || undefined;

        if (!AGGREGATE_FUNCTIONS.has(fn)) {
            throw invalidParam(
                `Unknown aggregate function "${fn}". Expected: ${[...AGGREGATE_FUNCTIONS].join(", ")}.`,
                "INVALID_AGGREGATE_FUNCTION"
            );
        }
        if (fn !== "count" && !field) {
            // `sum()` has no sensible reading, and guessing one would be
            // inventing a column on the caller's behalf.
            throw invalidParam(
                `\`${fn}()\` needs a field, e.g. \`${fn}(total)\`. Only \`count()\` may be empty.`,
                "INVALID_AGGREGATE_SELECT"
            );
        }

        return {
            fn: fn as ParsedAggregate["fn"],
            field,
            alias: field ? `${fn}_${field}` : fn
        };
    });
}

/** Parse `?groupBy=status,country`. */
export function parseGroupBy(raw: unknown): string[] | undefined {
    const value = getLastValue(raw);
    if (!value) return undefined;
    const fields = String(value).split(",").map(s => s.trim()).filter(Boolean);
    return fields.length > 0 ? fields : undefined;
}

/** `asc`/`desc`, in any case. Anything else is a request to sort in a way that does not exist. */
function toDirection(raw: unknown, context: string): "asc" | "desc" {
    if (raw === undefined || raw === null) return "asc";
    if (typeof raw !== "string") invalidOrderBy(`${context} has a non-string \`direction\``);
    const lowered = raw.toLowerCase();
    if (lowered !== "asc" && lowered !== "desc") {
        invalidOrderBy(`${context} has direction '${raw}'`);
    }
    return lowered;
}

/** One entry: the canonical `{field, direction}`, or the `field:direction` shorthand as a string. */
function toOrderByEntry(raw: unknown, index: number): OrderByEntry {
    const context = `entry ${index}`;
    if (typeof raw === "string") {
        // Split here rather than through `deserializeOrderBy`, which is the
        // *client* end of the codec and normalises anything that is not
        // literally "desc" to "asc". Routed through it, `?orderBy=x:DESC`
        // reached `toDirection` already collapsed to "asc" and answered 200
        // with the rows in the opposite order — a newest-first list showing
        // the oldest rows — and `x:sideways` did the same. The direction token
        // has to arrive here raw for `toDirection` to have anything to refuse.
        const idx = raw.indexOf(":");
        const field = (idx === -1 ? raw : raw.slice(0, idx)).trim();
        if (!field) invalidOrderBy(`${context} is an empty field name`);
        return { field, direction: idx === -1 ? "asc" : toDirection(raw.slice(idx + 1), context) };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        invalidOrderBy(`${context} is not a field name or a {field, direction} object`);
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.field !== "string" || entry.field.trim() === "") {
        invalidOrderBy(`${context} has no \`field\``);
    }
    return { field: entry.field, direction: toDirection(entry.direction, context) };
}

/**
 * Parse the `orderBy` query parameter.
 *
 * The field *name* has been validated against the schema for a while — an
 * `?orderBy=titel` is a 400 rather than 200 with unsorted rows, on the grounds
 * that silently dropping the sort leaves the caller believing in an order that
 * is not there. The parameter's *shape* was never checked the same way, and it
 * failed in exactly the same silent manner one layer earlier: whatever
 * `JSON.parse` returned was assigned to an option declared as an array of
 * `{field, direction}`, and the REST layer reads only `orderBy[0].field`. So
 * `?orderBy={"field":"name"}` — an object rather than an array, and the most
 * natural thing for a client to try — read `undefined`, dropped the ORDER BY,
 * and answered 200. So did a number, a boolean, `null`, and `["name"]`.
 *
 * This refuses those, the way `parseWhereParam` above already refuses a
 * malformed filter and for the same reason. What it keeps working is every
 * shape that worked before: the `field` and `field:desc` shorthands, and the
 * canonical JSON array.
 */
function parseOrderByParam(raw: unknown): OrderByEntry[] | undefined {
    if (Array.isArray(raw)) {
        // A repeated query parameter arrives pre-split; treat it as the list.
        return raw.length === 0 ? undefined : raw.map(toOrderByEntry);
    }

    const str = String(raw).trim();
    if (!str) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(str);
    } catch {
        // Not JSON at all, so it is the `field:direction` shorthand.
        return [toOrderByEntry(str, 0)];
    }

    // `JSON.parse` succeeding says nothing about the shape being usable.
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) return undefined;
        return parsed.map(toOrderByEntry);
    }
    if (typeof parsed === "string") return [toOrderByEntry(parsed, 0)];
    if (typeof parsed === "object" && parsed !== null) {
        // A bare `{field, direction}` is a near miss rather than nonsense, but
        // accepting it would leave two spellings of one parameter. Name it.
        invalidOrderBy("a single object was given where a JSON array was expected");
    }
    invalidOrderBy(`${typeof parsed} is not a field name or a list of them`);
}

// Re-exported for callers/tests that reference the REST list bounds. The
// numbers and the rule live in `@rebasepro/types` so the REST parser and the
// WebSocket ingress enforce ONE shared guarantee. See `resolveClientListLimit`.
export { DEFAULT_LIST_LIMIT, DEFAULT_VECTOR_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";

/**
 * Overridable list-pagination bounds for {@link parseQueryOptions}. Without
 * these, `GET /<collection>` with no `?limit` would buffer the ENTIRE table
 * into a JS array + JSON response (a trivial OOM/DoS), and `?limit=100000000`
 * would be honoured verbatim.
 */
export interface ListLimitOptions {
    /**
     * Page size used when the client sends no `?limit`. Applied to plain and
     * text-search reads — a vector search falls back to its own default (10).
     */
    defaultLimit?: number;
    /** Largest `?limit` a client may ask for. A larger one is a 400, not a clamp. */
    maxLimit?: number;
}

/**
 * {@link resolveClientListLimit} for an HTTP route: the same bounds, answered
 * with a 400 rather than a 500.
 *
 * The shared resolver throws a `ListLimitError`, which carries `status` — but
 * the Hono error handler discriminates on `statusCode`, so an unconverted one
 * reaches the client as `INTERNAL_ERROR` with its message stripped, telling the
 * caller nothing about the parameter it got wrong. Every REST list ingress
 * routes its `limit` through here so all of them name the ceiling the same way.
 */
export function resolveListLimitParam(
    rawLimit: number | string | null | undefined,
    opts: ListLimitBounds & { vectorSearch?: boolean } = {}
): number {
    try {
        return resolveClientListLimit(rawLimit, opts);
    } catch (e) {
        if (e instanceof ListLimitError) {
            throw invalidParam(e.message, "INVALID_LIMIT");
        }
        throw e;
    }
}

/**
 * A whole number at or above `minimum`, or a 400 naming the parameter.
 *
 * `parseInt` was the whole of the validation, and it answers `NaN` for
 * `?offset=abc` and a negative for `?offset=-5`. Neither was checked:
 *
 * - `NaN` reached the driver, where `OFFSET NaN` is a 500 about a syntax error
 *   in a query the caller never wrote;
 * - `?page=0` computed `offset = -limit`, a negative offset, which Postgres
 *   also refuses — and `?page=-3` refused deeper;
 * - `?offset=1.5` truncated silently to `1`, so the caller paged a window they
 *   had not asked for.
 *
 * Every one of those is the caller's parameter, so every one is a 400 named
 * after the parameter — the shape `INVALID_LIMIT` already had, and the reason a
 * limit is *rejected* rather than clamped: a window quietly different from the
 * one asked for cannot be told apart from having reached the end.
 *
 * `expected: true` on the error (via {@link invalidParam}): a mistyped query
 * parameter never reached the database and the response body already says what
 * to fix, so it logs at debug rather than putting a warning in production logs
 * on every request from a client holding a stale link.
 */
function parseWindowParam(raw: unknown, name: string, minimum: number, code: string): number {
    const text = String(raw).trim();
    const value = Number(text);
    if (text === "" || !Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
        throw invalidParam(
            `Invalid \`${name}\` parameter: expected a whole number ${minimum === 0 ? "of 0 or more" : `of ${minimum} or more`}, got ${JSON.stringify(text)}.`,
            code
        );
    }
    return value;
}

/**
 * Parse query parameters into QueryOptions
 */
export function parseQueryOptions(
    query: Record<string, unknown>,
    limits: ListLimitOptions = {}
): QueryOptions {
    const options: QueryOptions = {};
    const rawLimit = getLastValue(query.limit) as number | string | null | undefined;

    const offsetVal = getLastValue(query.offset);
    if (offsetVal) options.offset = parseWindowParam(offsetVal, "offset", 0, "INVALID_OFFSET");

    const pageVal = getLastValue(query.page);
    if (pageVal) {
        const page = parseWindowParam(pageVal, "page", 1, "INVALID_PAGE");
        // Page stride uses the same bounded page size the read will use, so
        // pages neither overlap nor gap. (Vector search never paginates by
        // page, so the plain/text default is correct here.)
        const limit = resolveListLimitParam(rawLimit, {
            defaultLimit: limits.defaultLimit,
            maxLimit: limits.maxLimit
        });
        options.offset = (page - 1) * limit;
    }

    // ── Logical conditions (or / and) ──────────────────────────────────
    const orVal = getLastValue(query.or);
    const andVal = getLastValue(query.and);
    if (orVal) {
        const logical = parseLogicalGroup("or", orVal);
        if (logical) options.logical = logical;
    } else if (andVal) {
        const logical = parseLogicalGroup("and", andVal);
        if (logical) options.logical = logical;
    }

    // ── PostgREST-style field filters: ?field=op.value ─────────────────
    // Delegate to the canonical filter dialect (the single source of truth
    // for the wire grammar: operator codes, list/escape handling, implicit
    // eq). Values stay strings; the schema-aware driver coerces them to
    // column types. This keeps the REST path byte-for-byte consistent with
    // the SDK/admin path, which parses through the same `deserializeFilter`.
    //
    // `where` is reserved: it is the JSON filter dialect (see
    // `parseWhereParam`), not a column named "where". Leaving it out of this
    // list made the documented `?where={...}` compile as a filter on a
    // nonexistent field — which used to be dropped, widening the read to the
    // whole table, and is now a 400 `UNKNOWN_FILTER_FIELD`.
    //
    // `select` and `groupBy` are reserved for the same reason: on
    // `/aggregate` they are the request, and left out of this list
    // `?select=sum(total)` compiles into the filter as a comparison on a
    // column named "select" — a 400 on the one endpoint that requires it.
    const reservedQueryKeys = ["limit", "offset", "page", "orderBy", "include", "fields", "searchString", "searchExplain", "vector_search", "vector", "vector_distance", "vector_threshold", "or", "and", "where", "select", "groupBy"];
    const filterDict: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(query)) {
        if (reservedQueryKeys.includes(key)) continue;
        filterDict[key] = rawValue;
    }
    // Both dialects may be sent together; an explicit `?field=op.value` wins
    // over the same field inside `where`, being the more specific request.
    const whereVal = getLastValue(query.where);
    const where = {
        ...(whereVal !== undefined && whereVal !== null ? parseWhereParam(whereVal) : undefined),
        ...decodeFilter(filterDict)
    };
    if (Object.keys(where).length > 0) {
        options.where = where;
    }

    // Sorting
    const orderByVal = getLastValue(query.orderBy);
    if (orderByVal) {
        options.orderBy = parseOrderByParam(orderByVal);
    }

    // Relation includes
    const includeVal = getLastValue(query.include);
    if (includeVal) {
        const includeStr = String(includeVal).trim();
        if (includeStr === "*") {
            options.include = ["*"];
        } else {
            options.include = includeStr.split(",").map(s => s.trim()).filter(Boolean);
        }
    }

    // Field selection
    const fieldsVal = getLastValue(query.fields);
    if (fieldsVal) {
        const fieldsStr = String(fieldsVal).trim();
        options.fields = fieldsStr.split(",").map(s => s.trim()).filter(Boolean);
    }

    // ── Vector similarity search ───────────────────────────────────────
    // Every rejection here is a malformed *request*, so it must carry a 400.
    // A bare `Error` reaches the handler with no `statusCode` and no known
    // `code`, which makes it a 500 — logged with a full stack as an incident,
    // and answered with "An unexpected error occurred", because the handler
    // only forwards a message to the client below 500. The caller was told
    // nothing about what it got wrong.
    const vectorSearchVal = getLastValue(query.vector_search);
    const vectorVal = getLastValue(query.vector);
    if (vectorSearchVal && vectorVal) {
        const vectorStr = String(vectorVal);
        let decoded: unknown;
        try {
            decoded = JSON.parse(vectorStr);
        } catch {
            decoded = undefined;
        }
        // Validated outside the `try` on purpose: inside it, the thrown
        // ApiError would be caught by its own `catch` and re-thrown as
        // something else.
        if (!Array.isArray(decoded) || !decoded.every(v => typeof v === "number")) {
            throw invalidParam(
                "Invalid `vector` format. Expected a JSON array of numbers, e.g. [0.1,0.2,0.3]",
                "INVALID_VECTOR"
            );
        }
        const queryVector = decoded as number[];

        const distanceParamVal = getLastValue(query.vector_distance);
        const distanceParam = distanceParamVal ? String(distanceParamVal) : "cosine";
        if (distanceParam !== "cosine" && distanceParam !== "l2" && distanceParam !== "inner_product") {
            throw invalidParam(
                `Invalid \`vector_distance\`: ${distanceParam}. Expected: cosine, l2, or inner_product`,
                "INVALID_VECTOR_DISTANCE"
            );
        }

        const vectorSearch: VectorSearchParams = {
            property: String(vectorSearchVal),
            vector: queryVector,
            distance: distanceParam
        };

        const thresholdVal = getLastValue(query.vector_threshold);
        if (thresholdVal) {
            const threshold = parseFloat(String(thresholdVal));
            if (isNaN(threshold)) {
                throw invalidParam(
                    "Invalid `vector_threshold`. Expected a number.",
                    "INVALID_VECTOR_THRESHOLD"
                );
            }
            vectorSearch.threshold = threshold;
        }

        options.vectorSearch = vectorSearch;
    }

    // Resolve the limit LAST — once we know whether this is a vector search —
    // so a client-supplied limit above the ceiling is refused with a 400 and an
    // absent one falls back to the correct mode default (plain/text =
    // defaultLimit, vector = 10). Without this a bare `GET /<collection>` would
    // return the whole table. Shared with the WebSocket ingress via
    // `resolveClientListLimit`.
    options.limit = resolveListLimitParam(rawLimit, {
        vectorSearch: !!options.vectorSearch,
        defaultLimit: limits.defaultLimit,
        maxLimit: limits.maxLimit
    });

    return options;
}
