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
export type OrderBySpec<Key extends string = string> =
    | OrderBySortTuple<Key>
    | OrderBySortTuple<Key>[];

/**
 * A sort key: a field name, or an aggregate over a to-many relation.
 *
 * @group Models
 */
export type SortKey<Key extends string = string> = Key | RelationAggregateSort;

/**
 * `[sortKey, direction]` — the authoring form of {@link OrderByTuple}, which
 * additionally accepts a {@link RelationAggregateSort} object.
 *
 * The object never reaches a driver: `normalizeOrderBy` in `@rebasepro/common`
 * encodes it to its string spelling on the way down, and everything below that
 * point speaks plain `OrderByTuple`. See {@link RelationAggregateSort} for why
 * the wire form is a string.
 *
 * @group Models
 */
export type OrderBySortTuple<Key extends string = string> = [SortKey<Key>, "asc" | "desc"];

/**
 * The aggregate functions a relation sort can apply.
 *
 * Five, and no `array_agg`/`string_agg`: an aggregate used as a sort key has to
 * produce something with an order, and these are the ones that do.
 *
 * @group Models
 */
export type RelationAggregateFn = "min" | "max" | "count" | "sum" | "avg";

/**
 * Order rows by an aggregate over the rows a to-many relation reaches —
 * "candidates, oldest waiting first", "clients, busiest first".
 *
 * ```ts
 * // The date of each candidate's earliest open application.
 * orderBy: [[{ relation: "applications", field: "created_at", agg: "min" }, "asc"]]
 *
 * // How many applications each candidate has.
 * orderBy: [[{ relation: "applications", agg: "count" }, "desc"]]
 * ```
 *
 * This is the half of a queue that cannot be worked around client-side. A
 * *filter* over a relation can be approximated by denormalising a flag onto the
 * row; an *ordering* cannot be approximated at all once the result set is
 * paged, because the client only ever holds one page and the page was chosen by
 * the wrong order.
 *
 * Rows the relation reaches nothing from sort last ascending and first
 * descending — the placement Postgres gives a `NULL`, stated rather than
 * inherited, because the keyset comparison behind cursor paging has to agree
 * with it exactly. Ties are broken by the row id, so the order is total and
 * paging over it neither repeats nor skips.
 *
 * Compiled by the driver into a correlated subquery, so it is subject to the
 * reader's own row-level security on the target table: a related row the reader
 * cannot see does not contribute to the aggregate. Offered only where
 * {@link DataSourceCapabilities.relationAggregateSorts} says the driver can
 * compile it.
 *
 * @group Models
 */
export interface RelationAggregateSort {
    /** The to-many relation to aggregate over, by its name on this collection. */
    relation: string;

    /** The aggregate to apply. */
    agg: RelationAggregateFn;

    /**
     * The column of the *target* to aggregate. Required by every function
     * except `count`, which counts the related rows themselves when it is
     * omitted — and counts the rows whose column is non-null when it is not.
     */
    field?: string;
}

/** The wire spelling of a {@link RelationAggregateSort}: `min(applications.created_at)`. */
const RELATION_AGGREGATE_SORT_PATTERN = /^(min|max|count|sum|avg)\(([^().]+)(?:\.([^()]+))?\)$/;

/**
 * A {@link RelationAggregateSort} as a single string — `min(applications.created_at)`,
 * `count(applications)`.
 *
 * The wire form is a string because every layer below the call site already is
 * one: `OrderByTuple` is `[string, direction]`, the REST parameter is
 * `?orderBy=key:direction`, the driver contract takes `orderBy?: string |
 * OrderByTuple[]`, and a cursor names its keys by string. `_score` established
 * the same pattern — a sort key that is not a column, spelled as one — and this
 * reuses it rather than widening five signatures to carry an object that would
 * be flattened at the end anyway.
 *
 * SQL's own spelling, so the key reads as what it compiles to. Neither `:` nor
 * `,` appears in it, which is what keeps it safe in the colon-delimited wire
 * shorthand.
 *
 * @group Models
 */
export function encodeRelationAggregateSort(sort: RelationAggregateSort): string {
    return `${sort.agg}(${sort.relation}${sort.field ? `.${sort.field}` : ""})`;
}

/**
 * Read the string spelling back, or `undefined` if it is not one.
 *
 * `undefined` rather than a throw: this is asked of *every* sort key to find
 * out which kind it is, and an ordinary column name is not an error.
 *
 * @group Models
 */
export function parseRelationAggregateSort(key: string): RelationAggregateSort | undefined {
    const match = RELATION_AGGREGATE_SORT_PATTERN.exec(key);
    if (!match) return undefined;
    const [, agg, relation, field] = match;
    // `min()` and friends have nothing to aggregate without a column, and a
    // key that parses to a half-built sort would resolve to no expression and
    // be dropped — leaving the rows unsorted while the caller believes
    // otherwise. `count` is the one function that means something on its own.
    if (!field && agg !== "count") return undefined;
    return { agg: agg as RelationAggregateFn, relation, ...(field && { field }) };
}

/** Is this sort key the object form rather than a field name? */
export function isRelationAggregateSort(key: unknown): key is RelationAggregateSort {
    return typeof key === "object" && key !== null &&
        typeof (key as RelationAggregateSort).relation === "string" &&
        typeof (key as RelationAggregateSort).agg === "string";
}

/** A sort key in the single-string form every layer below the call site speaks. */
export function sortKeyToString(key: SortKey): string {
    return isRelationAggregateSort(key) ? encodeRelationAggregateSort(key) : key;
}

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
 * dotted path reaching inside one — or *through a relation* to a column of the
 * related row.
 *
 * A dotted path is not checked at all, in either direction. That is a
 * deliberate loosening, and it is worth being exact about what it costs. The
 * root used to be checked: `"meta.tag"` required a `meta` column. It cannot
 * stay checked, because the other thing a dotted path now means is
 * `"applications.status"` — and `applications` is a *relation*, which comes
 * from the collection's `relations` and is not a column of `M` at all. There is
 * nothing in a generated row type that could validate one. `FindParams.include`
 * is `string[]` for exactly this reason and says so.
 *
 * So the guarantee moves rather than disappears: an unresolvable path is a 400
 * from the driver, not a silently dropped condition. See
 * `UnknownFilterFieldsMode` in `@rebasepro/server-postgres` — dropping a filter
 * key *widens* the read to every row, which is why that resolution fails
 * closed. A typo'd relation path is refused at runtime with the target
 * collection's real column list in the message.
 *
 * Undotted keys are unaffected and still checked against `keyof M`.
 *
 * When `M` is left at its default `Record<string, unknown>`, `keyof M` is
 * `string` and this collapses to `string`, so every query stays permissive.
 * That is what keeps an untyped `createRebaseClient()` behaving exactly as it
 * did before the row type was threaded through.
 *
 * @group Models
 */
export type FieldPath<M extends Record<string, unknown> = Record<string, unknown>> =
    | Extract<keyof M, string>
    | `${string}.${string}`;

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
