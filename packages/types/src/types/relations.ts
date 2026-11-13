
/**
 * @group Models
 */
export type OnAction = "cascade" | "restrict" | "no action" | "set null" | "set default";

/**
 * The key a junction row's own columns are carried under, in both directions.
 *
 * A read that includes a `manyToMany` relation serves each related row with its
 * link's columns nested here — `{ id: 5, name: "ts", _pivot: { role: "owner" } }`
 * — and a membership write may name the same key on an element to state what
 * the link should hold. One constant because the two have to be the same word:
 * a wire name that differs between the read and the write it round-trips
 * through is a shape no client can echo back.
 *
 * Leading underscore, like `_matches`: it reads as metadata about the row
 * rather than as one of its columns. A payload property may not be named
 * `_pivot` either — `checkJunctionPayload` refuses it — so the key means one
 * thing wherever it appears.
 *
 * @group Models
 */
export const JUNCTION_PIVOT_KEY = "_pivot";

/**
 * The key a row carries the totals of its counted relations under.
 *
 * An include that asks for a count — `include: { tags: { limit: 4, count: true } }`
 * — serves, beside the (capped) `tags`, how many related rows there are in all:
 * `{ id: 1, tags: [ …4 rows ], _count: { tags: 37 } }`. One object per row,
 * keyed by relation name, so counting a second relation adds a key rather than
 * a second top-level name.
 *
 * Leading underscore, like {@link JUNCTION_PIVOT_KEY} and `_matches`: it
 * describes the read, not the record, and no column or form writes it. A
 * collection with a property of this name cannot ask for a count — the read
 * answers 400 rather than writing over the column.
 *
 * @group Models
 */
export const INCLUDE_COUNT_KEY = "_count";

/**
 * What kind of link a relation is.
 *
 * The discriminant. Every other field a relation carries belongs to exactly one
 * of these, which is the point: a relation used to be a single open interface
 * where `cardinality`, `direction`, `localKey`, `foreignKeyOnTarget`, `through`
 * and `joinPath` were all optional and any combination typechecked. Which link
 * you meant then had to be *inferred* from which fields you happened to set,
 * and the inference was ~200 lines that guessed, fell back on naming
 * conventions, and swallowed its own failures.
 *
 * Most of that guessing produced bugs rather than convenience. A `many`
 * relation carrying a `localKey` — a combination the old type permitted — made
 * the write path stamp the parent's own foreign key onto the child row. Under
 * these kinds that state cannot be written down.
 *
 * @group Models
 */
export type RelationKind = "belongsTo" | "hasOne" | "hasMany" | "manyToMany" | "via";

/**
 * Defines a single, explicit step in a multi-join path.
 *
 * Each step represents one JOIN operation in the sequence. The `from` columns
 * refer to the previous table in the chain (or the source table for the first step),
 * and the `to` columns refer to the current table being joined.
 *
 * @example Single column join:
 * ```typescript
 * {
 *   table: "authors",
 *   on: {
 *     from: "author_id",  // Column from previous table (e.g., posts.author_id)
 *     to: "id"           // Column from current table (authors.id)
 *   }
 * }
 * ```
 *
 * @example Multi-column composite key join:
 * ```typescript
 * {
 *   table: "order_items",
 *   on: {
 *     from: ["order_id", "store_id"],    // Multiple columns from previous table
 *     to: ["order_id", "store_id"]       // Corresponding columns in current table
 *   }
 * }
 * ```
 */
export interface JoinStep {
    /**
     * The database table name to join TO in this step.
     * This is the table you're joining into, not the table you're joining from.
     *
     * @example "authors", "user_roles", "product_categories"
     */
    table: string;

    /**
     * The join condition for this step. Defines how the previous table
     * connects to the current table.
     *
     * - `from`: Column name(s) on the PREVIOUS table in the join chain
     * - `to`: Column name(s) on the CURRENT table (specified in `table`)
     *
     * For the first step, `from` refers to the source collection's table.
     * For subsequent steps, `from` refers to the table from the previous step.
     *
     * Both `from` and `to` support:
     * - Single column: `"user_id"`
     * - Multiple columns: `["company_id", "region_id"]` for composite keys
     *
     * When using arrays, both `from` and `to` must have the same length,
     * and columns are matched by position (index 0 with index 0, etc.).
     *
     * A list of conditions joins a row that meets **any one** of them. That is
     * how a link stored in either of two columns is read: a friendship kept as
     * one row with the smaller account first holds a person in `a` on some rows
     * and in `b` on others, and both are their friends.
     *
     * ```typescript
     * { table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }
     * ```
     *
     * A step with two or more alternatives is read-only, whatever its
     * position in the chain: a new link could go in either column, and which
     * one is the application's rule, not something to guess. A list of one is
     * the bare condition, and is read and written the same.
     */
    on: JoinCondition | JoinCondition[];
}

/**
 * One way a {@link JoinStep} can match: every `from` column equal to its `to`
 * column.
 * @group Models
 */
export interface JoinCondition {
    from: string | string[];
    to: string | string[];
}

/**
 * The conditions of a join step, as a list: one entry for a plain step, one
 * per alternative for a step that joins on any of several.
 * @group Models
 */
export function joinConditions(step: Pick<JoinStep, "on">): JoinCondition[] {
    return Array.isArray(step.on) ? step.on : [step.on];
}

/**
 * The one condition of a step that has no alternatives — for the write paths,
 * which only run on a writable chain and a chain with alternatives never is.
 * Throws rather than pick one of several: writing a link into the wrong column
 * is the mistake read-only exists to prevent.
 * @group Models
 */
export function soleJoinCondition(step: Pick<JoinStep, "on" | "table">): JoinCondition {
    if (Array.isArray(step.on)) {
        if (step.on.length === 1) return step.on[0];
        if (step.on.length === 0) throw new Error(`The join into '${step.table}' lists no conditions, so it joins nothing.`);
        throw new Error(`The join into '${step.table}' matches any of ${step.on.length} conditions, so it is read-only: there is no one column to write a link into.`);
    }
    return step.on;
}
