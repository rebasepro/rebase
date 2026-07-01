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
 * ┌──────────────────┬───────────────┬──────────────────────────┐
 * │ Canonical        │ REST short    │ Meaning                  │
 * ├──────────────────┼───────────────┼──────────────────────────┤
 * │ "=="             │ "eq"          │ Equal                    │
 * │ "!="             │ "neq"         │ Not equal                │
 * │ ">"              │ "gt"          │ Greater than             │
 * │ ">="             │ "gte"         │ Greater than or equal    │
 * │ "<"              │ "lt"          │ Less than                │
 * │ "<="             │ "lte"         │ Less than or equal       │
 * │ "in"             │ "in"          │ Value in list            │
 * │ "not-in"         │ "nin"         │ Value not in list        │
 * │ "array-contains" │ "cs"          │ Array contains element   │
 * │ "array-contains-any" │ "csa"     │ Array contains any of    │
 * └──────────────────┴───────────────┴──────────────────────────┘
 *
 * @module
 */

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
    | "array-contains-any";

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
 * @group Models
 */
export type FilterValues<Key extends string> =
    Partial<Record<Key, [WhereFilterOp, unknown] | [WhereFilterOp, unknown][]>>;

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
     */
    sort?: [Key, "asc" | "desc"];
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
    | "cs" | "csa";

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
    "array-contains-any": "csa"
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
    "csa": "array-contains-any"
};

/** All canonical operator strings for runtime validation. */
const CANONICAL_OPS: ReadonlySet<string> = new Set<WhereFilterOp>([
    "<", "<=", "==", "!=", ">=", ">",
    "in", "not-in",
    "array-contains", "array-contains-any"
]);

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
    return (REST_TO_CANONICAL as Record<string, WhereFilterOp | undefined>)[op];
}
