import type { FilterValues, LogicalCondition, VectorSearchParams } from "@rebasepro/types";
import { toCanonicalOp, resolveClientListLimit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";
import { deserializeOrderBy, deserializeFilter, deserializeLogicalCondition } from "@rebasepro/common";
import { QueryOptions } from "../types";
import { ApiError } from "../errors";

export const mapOperator = (op: string) => toCanonicalOp(op) ?? null;

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
        throw ApiError.badRequest(
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
        throw ApiError.badRequest(
            "Invalid `where` parameter: expected a JSON object, e.g. {\"status\":[\"==\",\"active\"]}",
            "INVALID_WHERE"
        );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw ApiError.badRequest(
            "Invalid `where` parameter: expected a JSON object mapping fields to conditions, "
            + "e.g. {\"status\":[\"==\",\"active\"]}",
            "INVALID_WHERE"
        );
    }

    const filter = deserializeFilter(parsed as Record<string, unknown>);
    return Object.keys(filter).length > 0 ? filter : undefined;
}

// Re-exported for callers/tests that reference the REST list bounds. The
// numbers and clamp live in `@rebasepro/types` so the REST parser and the
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
    /** Upper bound clamped onto any client-supplied `?limit`. */
    maxLimit?: number;
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
    if (offsetVal) options.offset = parseInt(String(offsetVal));

    const pageVal = getLastValue(query.page);
    if (pageVal) {
        const page = parseInt(String(pageVal));
        // Page stride uses the same bounded page size the read will use, so
        // pages neither overlap nor gap. (Vector search never paginates by
        // page, so the plain/text default is correct here.)
        const limit = resolveClientListLimit(rawLimit, {
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
    const reservedQueryKeys = ["limit", "offset", "page", "orderBy", "include", "fields", "searchString", "vector_search", "vector", "vector_distance", "vector_threshold", "or", "and", "where"];
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
        ...deserializeFilter(filterDict)
    };
    if (Object.keys(where).length > 0) {
        options.where = where;
    }

    // Sorting
    const orderByVal = getLastValue(query.orderBy);
    if (orderByVal) {
        try {
            options.orderBy = typeof orderByVal === "string"
                ? JSON.parse(orderByVal)
                : orderByVal;
        } catch {
            // Try simple format: "field:direction"
            if (typeof orderByVal === "string") {
                const parsed = deserializeOrderBy(orderByVal);
                if (parsed) {
                    options.orderBy = [
                        {
                            field: parsed[0],
                            direction: parsed[1]
                        }
                    ];
                }
            }
        }
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
            throw ApiError.badRequest(
                "Invalid `vector` format. Expected a JSON array of numbers, e.g. [0.1,0.2,0.3]",
                "INVALID_VECTOR"
            );
        }
        const queryVector = decoded as number[];

        const distanceParamVal = getLastValue(query.vector_distance);
        const distanceParam = distanceParamVal ? String(distanceParamVal) : "cosine";
        if (distanceParam !== "cosine" && distanceParam !== "l2" && distanceParam !== "inner_product") {
            throw ApiError.badRequest(
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
                throw ApiError.badRequest(
                    "Invalid `vector_threshold`. Expected a number.",
                    "INVALID_VECTOR_THRESHOLD"
                );
            }
            vectorSearch.threshold = threshold;
        }

        options.vectorSearch = vectorSearch;
    }

    // Resolve the limit LAST — once we know whether this is a vector search —
    // so a client-supplied limit is clamped to the hard max and an absent one
    // falls back to the correct mode default (plain/text = defaultLimit, vector
    // = 10). Without this a bare `GET /<collection>` would return the whole
    // table. Shared with the WebSocket ingress via `resolveClientListLimit`.
    options.limit = resolveClientListLimit(rawLimit, {
        vectorSearch: !!options.vectorSearch,
        defaultLimit: limits.defaultLimit,
        maxLimit: limits.maxLimit
    });

    return options;
}
