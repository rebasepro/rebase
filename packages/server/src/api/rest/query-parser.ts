import type { LogicalCondition, VectorSearchParams } from "@rebasepro/types";
import { toCanonicalOp, resolveClientListLimit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@rebasepro/types";
import { deserializeOrderBy, deserializeFilter, deserializeLogicalCondition } from "@rebasepro/common";
import { QueryOptions } from "../types";

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
    const parsed = deserializeLogicalCondition(`${type}(${inner})`);
    return "type" in parsed ? parsed : undefined;
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
    const reservedQueryKeys = ["limit", "offset", "page", "orderBy", "include", "fields", "searchString", "vector_search", "vector", "vector_distance", "vector_threshold", "or", "and"];
    const filterDict: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(query)) {
        if (reservedQueryKeys.includes(key)) continue;
        filterDict[key] = rawValue;
    }
    const where = deserializeFilter(filterDict);
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

    // Vector similarity search
    const vectorSearchVal = getLastValue(query.vector_search);
    const vectorVal = getLastValue(query.vector);
    if (vectorSearchVal && vectorVal) {
        const vectorStr = String(vectorVal);
        let queryVector: number[];
        try {
            queryVector = JSON.parse(vectorStr) as number[];
            if (!Array.isArray(queryVector) || !queryVector.every(v => typeof v === "number")) {
                throw new Error("Expected array of numbers");
            }
        } catch {
            throw new Error("Invalid vector format. Expected JSON array of numbers, e.g. [0.1,0.2,0.3]");
        }

        const distanceParamVal = getLastValue(query.vector_distance);
        const distanceParam = distanceParamVal ? String(distanceParamVal) : "cosine";
        if (distanceParam !== "cosine" && distanceParam !== "l2" && distanceParam !== "inner_product") {
            throw new Error(`Invalid vector_distance: ${distanceParam}. Expected: cosine, l2, or inner_product`);
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
                throw new Error("Invalid vector_threshold. Expected a number.");
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
