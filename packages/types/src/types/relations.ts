import type { AnyCollectionConfig } from "./collections";

/**
 * @group Models
 */
export type OnAction = "cascade" | "restrict" | "no action" | "set null" | "set default";

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

/** Fields every relation carries, whatever its kind. @group Models */
export interface RelationBase {
    /**
     * The name this link is addressed by: the key in `include`, the tab in the
     * admin panel, and the path segment of a nested URL.
     *
     * Defaults to the declaring property's key, or to the target's slug for an
     * entry in `relations`.
     */
    relationName?: string;

    /** The collection on the other end. */
    target: () => AnyCollectionConfig;

    /**
     * What the database does to this side's foreign key when the target row's
     * key changes. Emitted as the constraint's `ON UPDATE`.
     *
     * Unset means no clause, which Postgres reads as `NO ACTION`. Set
     * `"cascade"` when the target's key is a natural key that can be edited —
     * a slug, a SKU — so the pointers follow it.
     *
     * Only a `belongsTo` puts the key on this table, so this is the only kind
     * where the clause is written here; on the other kinds it describes the
     * constraint the target's own column carries.
     */
    onUpdate?: OnAction;
    /**
     * What the database does to this side's rows when the target row is
     * deleted. Emitted as the constraint's `ON DELETE`.
     *
     * Defaults, when unset, to `"set null"` for an optional relation and
     * **`"restrict"`** for a required one. `NOT NULL` says a child cannot exist
     * without a parent; it does not say deleting the parent should delete the
     * child. Ask for `"cascade"` when that is what you mean — it is the one
     * value that destroys rows you did not name.
     *
     * A `manyToMany` is the exception: its junction rows default to
     * `"cascade"`, because the row deleted there is the link and not the target.
     */
    onDelete?: OnAction;

    /** Presentation overrides applied when this relation is rendered as a tab. */
    overrides?: Partial<AnyCollectionConfig>;

    validation?: {
        required?: boolean;
    };
}

/**
 * This collection holds the foreign key. One target row per source row.
 *
 * ```ts
 * author: { kind: "belongsTo", target: () => authors, localKey: "author_id" }
 * ```
 * @group Models
 */
export interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    /**
     * Column on **this** collection's table holding the target's key.
     * Defaults to `<relationName>_id`.
     */
    localKey?: string;
}

/**
 * The target holds the foreign key, and at most one target row points back.
 *
 * ```ts
 * profile: { kind: "hasOne", target: () => profiles, foreignKeyOnTarget: "user_id" }
 * ```
 * @group Models
 */
export interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    /**
     * Column on the **target's** table holding this collection's key.
     * Defaults to `<thisCollection>_id`.
     */
    foreignKeyOnTarget?: string;
    /**
     * Column on **this** collection's table whose value `foreignKeyOnTarget`
     * holds. Defaults to this collection's primary key.
     *
     * Set it when the two sides are joined on a natural key rather than on the
     * row id — an external identity id, a SKU, a tenant slug. See
     * {@link HasManyRelation.sourceKey}, which this mirrors.
     */
    sourceKey?: string;
}

/**
 * The target holds the foreign key, and many target rows point back. The
 * children belong to this parent alone — deleting one deletes a row.
 *
 * ```ts
 * posts: { kind: "hasMany", target: () => posts, foreignKeyOnTarget: "author_id" }
 * ```
 * @group Models
 */
export interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    /**
     * Column on the **target's** table holding this collection's key.
     * Defaults to `<thisCollection>_id`.
     */
    foreignKeyOnTarget?: string;
    /**
     * Column on **this** collection's table whose value `foreignKeyOnTarget`
     * holds. Defaults to this collection's primary key.
     *
     * The mirror of `localKey` on {@link BelongsToRelation}: that one names the
     * column this side reads from, this one names the column the other side
     * points at. Without it the pair can only be joined on the row id, which
     * makes a natural-key link — `auth_user_id ↔ auth_user_id`, a SKU, a tenant
     * slug — inexpressible as `hasMany`, and it has to drop to the read-only
     * `via`.
     *
     * The column must be unique: the link addresses one source row per value,
     * and Postgres will not accept a foreign key against a non-unique column.
     *
     * ```ts
     * applications: {
     *     kind: "hasMany",
     *     target: () => talentApplications,
     *     sourceKey: "auth_user_id",
     *     foreignKeyOnTarget: "auth_user_id"
     * }
     * ```
     */
    sourceKey?: string;
}

/**
 * Both sides hold many, through a junction table. The target rows are shared,
 * so this collection owns the *link* and not the row: removing one removes a
 * junction row and leaves the target alone.
 *
 * Declared the same way from either side — there is no owning and inverse
 * version. Swap `sourceColumn` and `targetColumn` to describe the other
 * direction.
 *
 * ```ts
 * tags: { kind: "manyToMany", target: () => tags }
 * ```
 * @group Models
 */
export interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    /**
     * The junction table and its two key columns. Every part defaults: the
     * table to both table names sorted and joined, the columns to
     * `<collection>_id` and `<relationName>_id`.
     */
    through?: {
        table?: string;
        /** Junction column holding **this** collection's key. */
        sourceColumn?: string;
        /** Junction column holding the **target's** key. */
        targetColumn?: string;
    };
}

/**
 * An explicit chain of joins, for links the four shapes above cannot express:
 * multi-hop paths, composite keys, or a join whose condition is not a plain
 * foreign key.
 *
 * Read-only. Rebase will not infer how to write through an arbitrary join
 * chain, and guessing is what this type exists to stop.
 *
 * ```ts
 * permissions: {
 *     kind: "via",
 *     target: () => permissions,
 *     cardinality: "many",
 *     joinPath: [
 *         { table: "user_roles",       on: { from: "id",            to: "user_id" } },
 *         { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
 *         { table: "permissions",      on: { from: "permission_id", to: "id" } }
 *     ]
 * }
 * ```
 * @group Models
 */
export interface ViaRelation extends RelationBase {
    kind: "via";
    /** Whether the chain yields one row or many. Cannot be derived from a join chain. */
    cardinality: "one" | "many";
    joinPath: JoinStep[];
}

/**
 * A link from one collection to another, as authored.
 *
 * A closed union: pick the kind that describes the link and the type offers
 * exactly the fields that kind needs. See {@link ResolvedRelation} for the form
 * the runtime works with, which has every default filled in.
 *
 * @group Models
 */
export type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

/**
 * A relation with every default filled in — the form the runtime works with.
 *
 * The authored {@link Relation} and this are deliberately different types.
 * They used to be one, which meant no reader could tell which fields had been
 * supplied and which had been guessed, and so every consumer re-derived what it
 * needed with its own chain of `if (through) … else if (localKey) …` fallbacks.
 * Those chains disagreed with each other; that disagreement is what produced
 * silently wrong reads and corrupt writes.
 *
 * Here each variant carries exactly its own fields, all required. A consumer
 * switches on `kind` and gets what it needs without a fallback, and the cases
 * it forgot are a compile error rather than a wrong answer at runtime.
 *
 * @group Models
 */
export type ResolvedRelation =
    | ResolvedBelongsTo
    | ResolvedHasOne
    | ResolvedHasMany
    | ResolvedManyToMany
    | ResolvedVia;

/** Fields present on every resolved relation. @group Models */
export interface ResolvedRelationBase {
    /** Always set: defaulted during resolution if the author omitted it. */
    relationName: string;
    target: () => AnyCollectionConfig;
    /** The target's slug, resolved once so consumers need not call `target()`. */
    targetSlug: string;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<AnyCollectionConfig>;
    validation?: { required?: boolean };
    /**
     * Whether one row or many come back. Derived from `kind` — kept because it
     * is what most consumers actually branch on, and because `via` is the one
     * kind where it is authored rather than implied.
     */
    cardinality: "one" | "many";
    /**
     * Whether Rebase knows how to write through this link. False only for
     * {@link ResolvedVia}, whose join chain it will not invent a write for.
     */
    writable: boolean;
    /**
     * Whether the target rows are shared with other parents. True for
     * many-to-many and for multi-hop `via`: what the parent owns is the link,
     * so removing one must not delete the row.
     */
    shared: boolean;
}

/** @group Models */
export interface ResolvedBelongsTo extends ResolvedRelationBase {
    kind: "belongsTo";
    cardinality: "one";
    writable: true;
    shared: false;
    /** Column on this collection's table. */
    localKey: string;
}

/** @group Models */
export interface ResolvedHasOne extends ResolvedRelationBase {
    kind: "hasOne";
    cardinality: "one";
    writable: true;
    shared: false;
    /** Column on the target's table. */
    foreignKeyOnTarget: string;
    /** @see ResolvedHasMany.sourceKey */
    sourceKey?: string;
}

/** @group Models */
export interface ResolvedHasMany extends ResolvedRelationBase {
    kind: "hasMany";
    cardinality: "many";
    writable: true;
    shared: false;
    /** Column on the target's table. */
    foreignKeyOnTarget: string;
    /**
     * Column on the source's table that `foreignKeyOnTarget` points at, or
     * `undefined` for the source's primary key.
     *
     * The one optional field on a resolved relation, and deliberately so. Every
     * other default is filled in here because it can be: a table name and a
     * column name are derivable from the relation and its two endpoints alone.
     * The primary key is not — this driver resolves it from `isId`, then the
     * Drizzle schema, then a column named `id`, and the middle tier does not
     * exist at resolution time.
     *
     * So `undefined` is a sentinel with exactly one meaning, not a field a
     * consumer is invited to guess at. Read it through `sourceKeyField()`,
     * which is the only place that turns it into a column name.
     */
    sourceKey?: string;
}

/** @group Models */
export interface ResolvedManyToMany extends ResolvedRelationBase {
    kind: "manyToMany";
    cardinality: "many";
    writable: true;
    shared: true;
    through: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
    };
}

/** @group Models */
export interface ResolvedVia extends ResolvedRelationBase {
    kind: "via";
    writable: false;
    joinPath: JoinStep[];
}

// ── Narrowing helpers ────────────────────────────────────────────────
//
// Consumers that only care about one axis — "does this list many rows",
// "is there a column on the target" — should ask that question rather
// than enumerate kinds, so adding a kind later does not silently skip them.

/** Relations whose target row carries this collection's key. @group Models */
export type ResolvedForeignKeyOnTarget = ResolvedHasOne | ResolvedHasMany;

/** @group Models */
export function hasForeignKeyOnTarget(relation: ResolvedRelation): relation is ResolvedForeignKeyOnTarget {
    return relation.kind === "hasOne" || relation.kind === "hasMany";
}

/** @group Models */
export function isManyToMany(relation: ResolvedRelation): relation is ResolvedManyToMany {
    return relation.kind === "manyToMany";
}

/** @group Models */
export function isToMany(relation: ResolvedRelation): boolean {
    return relation.cardinality === "many";
}

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
     */
    on: {
        from: string | string[];
        to: string | string[];
    };
}
