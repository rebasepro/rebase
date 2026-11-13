/**
 * The read a `beforeQuery` hook narrows: what is being read, and the narrowing
 * it may answer with. Shared by table hooks (`TableHooks.beforeQuery`) and the
 * panel's collection callbacks.
 *
 * @module
 */
import type { FilterValues, OrderByTuple } from "./filter-operators";
import type { LogicalCondition } from "../controllers/data";

/**
 * Which read a {@link CollectionCallbacks.beforeQuery} hook is narrowing.
 *
 * Named rather than inferred because the four are not interchangeable to a
 * hook that logs, measures or short-circuits: `"count"` and `"aggregate"` serve
 * a total rather than rows, and `"relation"` is the target collection's own
 * hook firing over rows reached from a parent.
 *
 * @group Models
 */
export type ReadOperation = "list" | "get" | "count" | "aggregate" | "relation";

/**
 * The parsed read, as a {@link CollectionCallbacks.beforeQuery} hook sees it.
 *
 * Read-only throughout, and that is the point rather than a courtesy: a hook
 * that could edit this object would be able to *widen* the read, which is the
 * one thing this hook is built not to permit. Mutating it is a compile error;
 * narrowing is what the return value is for.
 *
 * Fields are present exactly when the caller sent them. An absent `filter` is
 * a query with no filter, not an empty one.
 *
 * @group Models
 */
export interface ReadQuery<M extends Record<string, unknown> = Record<string, unknown>> {

    /** The caller's own field filter. */
    readonly filter?: Readonly<FilterValues<Extract<keyof M, string>>>;

    /** The caller's `or(...)` / `and(...)` group, if any. */
    readonly logical?: Readonly<LogicalCondition>;

    /** The text typed into a search box, if this is a search. */
    readonly searchString?: string;

    /** Page size, when the caller asked for one. */
    readonly limit?: number;

    /** Offset pagination, when the caller asked for one. */
    readonly offset?: number;

    /**
     * Sort keys, normalized to tuples — one entry per key, in order of
     * significance, whichever of the several authoring forms the caller used.
     */
    readonly orderBy?: readonly Readonly<OrderByTuple>[];

    /** Column projection, when the caller narrowed it with `fields`. */
    readonly fields?: readonly string[];

    /**
     * The parent this read hangs off, for `operation: "relation"` and for a
     * nested path like `authors/1/posts`.
     *
     * A hook that scopes by tenant usually ignores it. A hook that needs to
     * know it is looking at *someone's* rows rather than all of them does not.
     */
    readonly relatedTo?: {
        readonly parentSlug: string;
        readonly parentId?: string | number;
        readonly relationName: string;
    };
}

/**
 * What a {@link CollectionCallbacks.beforeQuery} hook returns: conditions to
 * AND into the read.
 *
 * Returning nothing (`undefined`, or no `return` at all) adds nothing and
 * leaves the compiled SQL byte-identical to what it would have been.
 *
 * Both fields are the same declarative language a caller's own query uses, so
 * a relation path (`author.tenant_id`), a JSON path (`meta->>tier`) and every
 * `WhereFilterOp` works here too. There is no raw-SQL member, and that is
 * deliberate: raw SQL could be `OR`-ed against the caller's conditions and so
 * could widen the read.
 *
 * @group Models
 */
export interface QueryNarrowing<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * A field filter to AND in.
     *
     * Compiled with unknown fields fatal, always: a scope condition that names
     * a column the table does not have refuses the request rather than running
     * without it.
     */
    filter?: FilterValues<Extract<keyof M, string>>;

    /**
     * An `or(...)` / `and(...)` group to AND in, for a scope that is a
     * disjunction — "mine, or shared with me", say.
     *
     * Still additive: the group is AND-ed into the query as a whole, so an
     * `or` inside it can only ever choose between rows the rest of the query
     * already admits.
     */
    logical?: LogicalCondition;
}

