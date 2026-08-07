import {
    EntityRelation,
    FilterValues,
    FindResult,
    LogicalCondition,
    FilterCondition,
    OrderByTuple,
    WhereFilterOp,
    toCanonicalOp
} from "@rebasepro/types";
import { FindParams } from "./transport";
import { resolveFindWindow } from "@rebasepro/common";

/**
 * A local evaluator for `FindParams`, so cached rows can answer a query the
 * client has never sent to the server — and so a row written offline shows up
 * in every filtered list it belongs to, not just in unfiltered ones.
 *
 * This mirrors the Postgres driver's semantics rather than JavaScript's:
 *
 * - Comparing against NULL is *unknown*, not false-or-true. `status != "done"`
 *   excludes rows where `status` is null, exactly as SQL does — a JS `!==`
 *   would have included them.
 * - `ORDER BY` puts nulls last ascending and first descending, which is the
 *   Postgres default.
 * - The wire format carries no types, so values arriving as strings are
 *   compared numerically against numeric columns and as instants against
 *   date columns. `["==", "3"]` matches the number `3`, as it does server-side.
 *
 * Two things it deliberately approximates, both flagged by
 * {@link isExactlyEvaluable}: `searchString` becomes a case-insensitive
 * substring scan over the row's string fields (the server runs real full-text
 * search over the collection's configured columns), and `include` cannot be
 * evaluated at all, because the related rows live in collections this query
 * knows nothing about.
 */

const collator = typeof Intl !== "undefined" && typeof Intl.Collator === "function"
    ? new Intl.Collator(undefined, { numeric: false, sensitivity: "variant" })
    : undefined;

/**
 * The server's page size when the caller does not ask for one.
 *
 * Re-exported rather than redeclared. This was its own `= 20` — a third
 * constant of this name in the workspace, next to `@rebasepro/common`'s 200 and
 * the 50 the REST layer actually applies — and a local copy of a number that
 * belongs to another process is a number that goes stale silently.
 */
export { DEFAULT_LIST_LIMIT as DEFAULT_PAGE_SIZE } from "@rebasepro/types";

function isNullish(value: unknown): boolean {
    return value === null || value === undefined;
}

/**
 * Reduce a value to something comparable. Relations compare by the id they
 * point at — the column holds a foreign key, so that is what the server
 * compares too.
 */
function toComparable(value: unknown): unknown {
    if (value instanceof Date) return value.getTime();
    if (value instanceof EntityRelation) return value.id;
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        // A reference/relation that lost its prototype somewhere still
        // compares by id.
        if (typeof record.__type === "string" && "id" in record) return record.id;
    }
    return value;
}

/**
 * Three-way compare with SQL's type coercion but not its collation. Returns
 * `undefined` when the two values are not ordered relative to each other,
 * which is how NULL propagates through a comparison.
 */
export function compareValues(a: unknown, b: unknown): number | undefined {
    const left = toComparable(a);
    const right = toComparable(b);
    if (isNullish(left) || isNullish(right)) return undefined;

    if (typeof left === "boolean" || typeof right === "boolean") {
        const l = left === true || left === "true" || left === 1 ? 1 : 0;
        const r = right === true || right === "true" || right === 1 ? 1 : 0;
        return l - r;
    }

    // A numeric string on either side means the wire dropped the type; compare
    // as numbers so `["<", "10"]` does not order "10" before "9" as text.
    const leftNum = typeof left === "number" ? left : numericOrNaN(left);
    const rightNum = typeof right === "number" ? right : numericOrNaN(right);
    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum)) {
        return leftNum < rightNum ? -1 : leftNum > rightNum ? 1 : 0;
    }

    // One side is a date-shaped string and the other an instant.
    if (typeof left === "number" || typeof right === "number") {
        const leftTime = toTime(left);
        const rightTime = toTime(right);
        if (leftTime !== undefined && rightTime !== undefined) {
            return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
        }
    }

    const leftStr = String(left);
    const rightStr = String(right);
    if (collator) return collator.compare(leftStr, rightStr);
    return leftStr < rightStr ? -1 : leftStr > rightStr ? 1 : 0;
}

function numericOrNaN(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isNaN(n) ? NaN : n;
    }
    if (typeof value === "bigint") return Number(value);
    return NaN;
}

function toTime(value: unknown): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const t = Date.parse(value);
        return Number.isNaN(t) ? undefined : t;
    }
    return undefined;
}

/** Equality with the wire's type erasure allowed for, but never across NULL. */
export function looseEquals(a: unknown, b: unknown): boolean {
    const left = toComparable(a);
    const right = toComparable(b);
    if (isNullish(left) || isNullish(right)) return isNullish(left) && isNullish(right);
    if (left === right) return true;
    const cmp = compareValues(left, right);
    return cmp === 0;
}

/**
 * Translate a SQL `LIKE` pattern to an anchored regular expression.
 * `%` matches any run of characters, `_` exactly one, and a backslash escapes
 * either of them.
 */
function likeToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
    let source = "^";
    // Runs of `%` collapse to one. `%%%%X` means exactly what `%X` means, but
    // as a regular expression it is four adjacent unbounded quantifiers, and on
    // a subject that does not match the engine tries every way of splitting the
    // subject between them. Fourteen of them against a forty-eight character
    // value took eighty-seven seconds to answer `false`.
    //
    // The pattern is user input — `?title=like.%25%25%25…` over HTTP — so that
    // is a request that pins a CPU. Collapsing is semantics-preserving and
    // removes the ambiguity the backtracking feeds on.
    let lastWasWildcard = false;
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === "\\" && i + 1 < pattern.length) {
            source += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            i++;
            lastWasWildcard = false;
        } else if (char === "%") {
            if (!lastWasWildcard) source += "[\\s\\S]*";
            lastWasWildcard = true;
        } else if (char === "_") {
            source += "[\\s\\S]";
            lastWasWildcard = false;
        } else {
            source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            lastWasWildcard = false;
        }
    }
    return new RegExp(source + "$", caseInsensitive ? "i" : "");
}

function asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === undefined) return [];
    return [value];
}

/** Evaluate one canonical operator against one row value. */
export function matchesOperator(rowValue: unknown, op: WhereFilterOp, filterValue: unknown): boolean {
    switch (op) {
        case "is-null":
            return isNullish(rowValue);
        case "is-not-null":
            return !isNullish(rowValue);
        case "==":
            return looseEquals(rowValue, filterValue);
        case "!=":
            // SQL: `x != v` is unknown when x is NULL, so the row drops out.
            if (isNullish(rowValue)) return false;
            return !looseEquals(rowValue, filterValue);
        case "<":
        case "<=":
        case ">":
        case ">=": {
            const cmp = compareValues(rowValue, filterValue);
            if (cmp === undefined) return false;
            if (op === "<") return cmp < 0;
            if (op === "<=") return cmp <= 0;
            if (op === ">") return cmp > 0;
            return cmp >= 0;
        }
        case "in":
            if (isNullish(rowValue)) return false;
            return asArray(filterValue).some((v) => looseEquals(rowValue, v));
        case "not-in":
            if (isNullish(rowValue)) return false;
            return !asArray(filterValue).some((v) => looseEquals(rowValue, v));
        case "array-contains": {
            if (!Array.isArray(rowValue)) return false;
            return rowValue.some((v) => looseEquals(v, filterValue));
        }
        case "array-contains-any": {
            if (!Array.isArray(rowValue)) return false;
            const wanted = asArray(filterValue);
            return rowValue.some((v) => wanted.some((w) => looseEquals(v, w)));
        }
        case "like":
        case "not-like":
        case "ilike":
        case "not-ilike": {
            if (isNullish(rowValue)) return false;
            const insensitive = op === "ilike" || op === "not-ilike";
            const negated = op === "not-like" || op === "not-ilike";
            const matched = likeToRegExp(String(filterValue), insensitive).test(String(rowValue));
            return negated ? !matched : matched;
        }
        default:
            // An operator this build does not know must not silently drop rows.
            return true;
    }
}

function isTuple(value: unknown): value is [WhereFilterOp, unknown] {
    return Array.isArray(value) && value.length === 2 && typeof value[0] === "string"
        && toCanonicalOp(value[0]) !== undefined;
}

/** Evaluate a `where` clause: every field, and every tuple on a field, AND-ed. */
export function matchesWhere(row: Record<string, unknown>, where: FilterValues<string> | undefined): boolean {
    if (!where) return true;
    for (const [field, condition] of Object.entries(where)) {
        if (condition === undefined) continue;
        const tuples: [WhereFilterOp, unknown][] = isTuple(condition)
            ? [condition]
            : Array.isArray(condition)
                ? (condition as unknown[]).filter(isTuple) as [WhereFilterOp, unknown][]
                : [];
        for (const [rawOp, value] of tuples) {
            const op = toCanonicalOp(rawOp) ?? rawOp;
            if (!matchesOperator(row[field], op, value)) return false;
        }
    }
    return true;
}

/** Evaluate a nested and/or tree. */
export function matchesLogical(
    row: Record<string, unknown>,
    condition: LogicalCondition | FilterCondition | undefined
): boolean {
    if (!condition) return true;
    if ("type" in condition) {
        const children = condition.conditions ?? [];
        if (children.length === 0) return true;
        return condition.type === "or"
            ? children.some((c) => matchesLogical(row, c))
            : children.every((c) => matchesLogical(row, c));
    }
    const op = toCanonicalOp(condition.operator) ?? condition.operator;
    return matchesOperator(row[condition.column], op as WhereFilterOp, condition.value);
}

/**
 * Approximate the server's full-text search with a case-insensitive substring
 * scan over the row's own string fields. Narrower than the real thing (no
 * stemming, no configured search columns), and it never matches a field the
 * cached row does not carry — a local list may therefore be missing rows the
 * server would have returned, which is why {@link isExactlyEvaluable} refuses
 * to call a search query exact.
 */
export function matchesSearch(row: Record<string, unknown>, searchString: string | undefined): boolean {
    if (!searchString) return true;
    const needle = searchString.trim().toLowerCase();
    if (!needle) return true;
    for (const value of Object.values(row)) {
        if (typeof value === "string" && value.toLowerCase().includes(needle)) return true;
        if (typeof value === "number" && String(value).includes(needle)) return true;
    }
    return false;
}

/** Does this row belong in the result set for `params`, ignoring pagination? */
export function matchesParams(row: Record<string, unknown>, params?: FindParams): boolean {
    if (!params) return true;
    return matchesWhere(row, params.where)
        && matchesLogical(row, params.logical)
        && matchesSearch(row, params.searchString);
}

/**
 * Sort in place, Postgres-style: nulls last ascending, first descending, with
 * the row id as a tiebreak so paging through an unsorted-but-equal run does
 * not shuffle rows between pages.
 */
export function sortRows<M extends Record<string, unknown>>(rows: M[], orderBy?: OrderByTuple): M[] {
    if (!orderBy) return rows;
    const [field, direction = "asc"] = orderBy;
    const sign = direction === "desc" ? -1 : 1;
    return rows.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        const aNull = isNullish(toComparable(av));
        const bNull = isNullish(toComparable(bv));
        if (aNull || bNull) {
            if (aNull && bNull) return tiebreak(a, b);
            // NULLS LAST ascending, NULLS FIRST descending.
            return (aNull ? 1 : -1) * (direction === "desc" ? -1 : 1);
        }
        const cmp = compareValues(av, bv);
        if (cmp === undefined || cmp === 0) return tiebreak(a, b);
        return cmp * sign;
    });
}

function tiebreak(a: Record<string, unknown>, b: Record<string, unknown>): number {
    const cmp = compareValues(a.id, b.id);
    return cmp ?? 0;
}

/**
 * Resolve `page`/`offset`/`limit` the way the server does.
 *
 * It did not: this defaulted an absent limit to 20 while `/api/data` pages by
 * 50, so the same `observe()` answered with 20 rows from the local database and
 * 50 from the network — a list that changed length depending on which side
 * answered, with `page` striding differently on each. Delegated now, so the
 * sentence above is true by construction rather than by agreement.
 */
export function resolvePagination(params?: FindParams): { limit: number; offset: number } {
    const { limit, offset } = resolveFindWindow(params);
    return { limit, offset };
}

/**
 * Can a locally evaluated answer to `params` be trusted to match the server's,
 * assuming the cache holds every row of the collection?
 *
 * `include` pulls in rows from other collections that this evaluator never
 * sees, and `searchString` is only approximated — both make the local answer a
 * best effort rather than an equivalent one.
 */
export function isExactlyEvaluable(params?: FindParams): boolean {
    if (!params) return true;
    if (params.include && params.include.length > 0) return false;
    if (params.searchString) return false;
    // Nearest-neighbour ordering is the server's to compute: the cache holds no
    // vectors, and even with them, answering from a subset would return the
    // nearest of what happens to be cached while looking like the nearest there
    // are — a wrong answer that is indistinguishable from a right one.
    if (params.vectorSearch) return false;
    return true;
}

/** Run a full query — filter, sort, paginate — over a set of rows. */
export function runLocalQuery<M extends Record<string, unknown>>(
    rows: M[],
    params?: FindParams
): FindResult<M> {
    const matched = rows.filter((row) => matchesParams(row, params));
    sortRows(matched, params?.orderBy);
    const { limit, offset } = resolvePagination(params);
    const page = matched.slice(offset, offset + limit);
    return {
        data: page,
        meta: {
            total: matched.length,
            limit,
            offset,
            hasMore: offset + page.length < matched.length
        }
    };
}
