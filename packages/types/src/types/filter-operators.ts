/**
 * Canonical filter operators and REST wire-format mappings.
 *
 * `WhereFilterOp` is THE operator type used at every layer — from React
 * components through the SDK, server, and down to the database driver.
 *
 * PostgREST short-codes (`eq`, `gt`, `cs`, …) exist **only** at the
 * HTTP wire boundary, handled by `serializeFilter` / `deserializeFilter`
 * in `@rebasepro/common`.
 *
 * ┌──────────────────────┬───────────────┬──────────────────────────────┐
 * │ Canonical            │ REST short    │ Meaning                      │
 * ├──────────────────────┼───────────────┼──────────────────────────────┤
 * │ "=="                 │ "eq"          │ Equal                        │
 * │ "!="                 │ "neq"         │ Not equal                    │
 * │ ">"                  │ "gt"          │ Greater than                 │
 * │ ">="                 │ "gte"         │ Greater than or equal        │
 * │ "<"                  │ "lt"          │ Less than                    │
 * │ "<="                 │ "lte"         │ Less than or equal           │
 * │ "in"                 │ "in"          │ Value in list                │
 * │ "not-in"             │ "nin"         │ Value not in list            │
 * │ "array-contains"     │ "cs"          │ Array contains element       │
 * │ "array-contains-any" │ "csa"         │ Array contains any of        │
 * │ "like"               │ "like"        │ SQL LIKE (case-sensitive)    │
 * │ "ilike"              │ "ilike"       │ SQL ILIKE (case-insensitive) │
 * │ "not-like"           │ "nlike"       │ NOT LIKE (case-sensitive)    │
 * │ "not-ilike"          │ "nilike"      │ NOT ILIKE (case-insensitive) │
 * │ "is-null"            │ "isnull"      │ Field IS NULL                │
 * │ "is-not-null"        │ "notnull"     │ Field IS NOT NULL            │
 * └──────────────────────┴───────────────┴──────────────────────────────┘
 *
 * Pattern matching (`like`/`ilike`) uses SQL wildcard syntax: `%` matches any
 * sequence of characters, `_` matches a single character. On MongoDB these are
 * translated to anchored regular expressions; Firestore has no native pattern
 * matching and rejects these operators (use `searchString` instead).
 *
 * @module
 */

/**
 * Canonical sort representation: `[fieldName, direction]`.
 *
 * Used in `FindParams.orderBy`, `collection.sort`, and `FilterPreset.sort`.
 * The colon-string form (`"field:direction"`) exists only at the HTTP wire
 * boundary, handled by `serializeOrderBy` / `deserializeOrderBy` in
 * `@rebasepro/common`.
 *
 * @group Models
 */
export type OrderByTuple<Key extends string = string> = [Key, "asc" | "desc"];

/**
 * One sort key, or several applied in order of significance.
 *
 * ```ts
 * orderBy: ["created_at", "desc"]                      // one key
 * orderBy: [["roles", "asc"], ["created_at", "desc"]]  // roles, then newest first
 * ```
 *
 * The two forms are told apart by whether the first element is itself an
 * array, so a single tuple never needs wrapping and every existing caller
 * keeps working unchanged. `normalizeOrderBy` in `@rebasepro/common` collapses
 * both to the list form, which is what every layer below the call site speaks.
 *
 * Ties on the last key are broken by the row id, so a multi-key sort is a
 * total order and pages over it neither repeat nor skip rows.
 *
 * @group Models
 */
export type OrderBySpec<Key extends string = string> = OrderByTuple<Key> | OrderByTuple<Key>[];

/**
 * Canonical filter operators supported across all database backends.
 * Each DB driver translates these to its native query format.
 *
 * @group Models
 */
export type WhereFilterOp =
    | "<"
    | "<="
    | "=="
    | "!="
    | ">="
    | ">"
    | "array-contains"
    | "in"
    | "not-in"
    | "array-contains-any"
    | "like"
    | "ilike"
    | "not-like"
    | "not-ilike"
    | "is-null"
    | "is-not-null";

/**
 * Used to define filters applied in collections.
 *
 * A single condition is a tuple `[operator, value]`.
 * Multiple conditions on the same field use an array of tuples.
 *
 * @example
 * // Single condition per field
 * { status: ["==", "active"], price: [">=", 9.99] }
 *
 * // Multiple conditions on one field
 * { age: [[">=", 18], ["<", 65]] }
 *
 * // Array operators
 * { role: ["in", ["admin", "editor"]] }
 * { tags: ["array-contains", "featured"] }
 *
 * // Pattern matching (SQL wildcards: % and _)
 * { name: ["ilike", "%john%"] }
 * { slug: ["like", "post-%"] }
 *
 * // Null checks (the value is ignored; `null` is conventional)
 * { deleted_at: ["is-null", null] }
 * { published_at: ["is-not-null", null] }
 *
 * @group Models
 */
export type FilterValues<Key extends string> =
    Partial<Record<Key, [WhereFilterOp, unknown] | [WhereFilterOp, unknown][]>>;

/**
 * The field names a query may address on a row type: every column, plus a
 * dotted path reaching inside one.
 *
 * Only the **root** of a dotted path is checked. `"meta.tag"` requires a `meta`
 * column and says nothing about what is under it, because what is under it is a
 * `map`/jsonb value whose shape the row type does not describe — and rejecting
 * paths we cannot verify would make jsonb columns unqueryable.
 *
 * When `M` is left at its default `Record<string, unknown>`, `keyof M` is
 * `string` and a template literal over `string` is itself assignable to
 * `string`, so this collapses to `string` and every query stays permissive.
 * That is what keeps an untyped `createRebaseClient()` behaving exactly as it
 * did before the row type was threaded through.
 *
 * @group Models
 */
export type FieldPath<M extends Record<string, unknown> = Record<string, unknown>> =
    | Extract<keyof M, string>
    | `${Extract<keyof M, string>}.${string}`;

/**
 * Relaxed filter type that also accepts pre-serialized PostgREST strings.
 * **Internal only** — used at the wire-format boundary
 * (`serializeFilter` / `deserializeFilter` in `@rebasepro/common`).
 *
 * Application code, UI components, and SDK consumers should use
 * {@link FilterValues} instead.
 *
 * @internal
 */
export type WireFilterValues<Key extends string> =
    Partial<Record<Key, [WhereFilterOp, unknown] | [WhereFilterOp, unknown][] | string>>;

/**
 * A pre-defined filter preset for quick access in the collection toolbar.
 * Users can select a preset to instantly apply a set of filters and
 * optionally a sort order.
 *
 * @group Models
 */
export interface FilterPreset<Key extends string = string> {
    /**
     * Display label shown in the preset menu.
     * If omitted, a summary is auto-generated from the filter keys.
     */
    label?: string;

    /**
     * The filter values to apply when this preset is selected.
     */
    filterValues: FilterValues<Key>;

    /**
     * Optional sort override to apply alongside the filter values.
     * One key, or several in order of significance.
     */
    sort?: OrderBySpec<Key>;
}

/**
 * PostgREST short-code operators. Wire format only — these never appear
 * in application code. Used by `serializeFilter`/`deserializeFilter`
 * in `@rebasepro/common`.
 */
export type RestFilterOp =
    | "eq" | "neq"
    | "gt" | "gte"
    | "lt" | "lte"
    | "in" | "nin"
    | "cs" | "csa"
    | "like" | "ilike"
    | "nlike" | "nilike"
    | "isnull" | "notnull";

/** Maps canonical operators to their REST short-code equivalents. */
export const CANONICAL_TO_REST: Readonly<Record<WhereFilterOp, RestFilterOp>> = {
    "==": "eq",
    "!=": "neq",
    ">": "gt",
    ">=": "gte",
    "<": "lt",
    "<=": "lte",
    "in": "in",
    "not-in": "nin",
    "array-contains": "cs",
    "array-contains-any": "csa",
    "like": "like",
    "ilike": "ilike",
    "not-like": "nlike",
    "not-ilike": "nilike",
    "is-null": "isnull",
    "is-not-null": "notnull"
};

/** Maps REST short-code operators to their canonical equivalents. */
export const REST_TO_CANONICAL: Readonly<Record<RestFilterOp, WhereFilterOp>> = {
    "eq": "==",
    "neq": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "in": "in",
    "nin": "not-in",
    "cs": "array-contains",
    "csa": "array-contains-any",
    "like": "like",
    "ilike": "ilike",
    "nlike": "not-like",
    "nilike": "not-ilike",
    "isnull": "is-null",
    "notnull": "is-not-null"
};

/**
 * Operators that test for null/not-null and therefore ignore their value.
 * Codecs normalize the value of these conditions to `null`.
 */
export const NULL_OPS: ReadonlySet<WhereFilterOp> = new Set<WhereFilterOp>([
    "is-null", "is-not-null"
]);

/**
 * Every canonical operator, in a stable order. Useful for engine capability
 * declarations ({@link DataSourceCapabilities.filterOperators}) and for
 * building operator subsets.
 * @group Models
 */
export const ALL_WHERE_FILTER_OPS: readonly WhereFilterOp[] = [
    "<", "<=", "==", "!=", ">=", ">",
    "in", "not-in",
    "array-contains", "array-contains-any",
    "like", "ilike", "not-like", "not-ilike",
    "is-null", "is-not-null"
];

/** All canonical operator strings for runtime validation. */
const CANONICAL_OPS: ReadonlySet<string> = new Set<WhereFilterOp>(ALL_WHERE_FILTER_OPS);

/**
 * The REST table as a `Map`, because the key `toCanonicalOp` is handed comes
 * off the wire.
 *
 * Indexed as a plain object, every `Object.prototype` member answered:
 * `toCanonicalOp("valueOf")` returned the inherited *function* as though it
 * were a `WhereFilterOp`, and every caller here treats a defined result as
 * "known operator". Same defect the REST codec's own lookup tables were
 * converted away from in `filter-dialect.ts`; this is the copy that survived
 * one package over, and it now sits under the operator validation the REST
 * parser does, which would otherwise have admitted `["constructor", x]`.
 */
const REST_OP_LOOKUP: ReadonlyMap<string, WhereFilterOp> = new Map<string, WhereFilterOp>(
    Object.entries(REST_TO_CANONICAL) as [string, WhereFilterOp][]
);

/**
 * Resolve any operator string (canonical or REST short-code) to its
 * canonical `WhereFilterOp` form. Returns `undefined` for unknown operators.
 *
 * @example
 * toCanonicalOp("==")   // "=="
 * toCanonicalOp("eq")   // "=="
 * toCanonicalOp("cs")   // "array-contains"
 * toCanonicalOp("xyz")  // undefined
 */
export function toCanonicalOp(op: string): WhereFilterOp | undefined {
    if (CANONICAL_OPS.has(op)) return op as WhereFilterOp;
    return REST_OP_LOOKUP.get(op);
}
