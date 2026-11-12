import type { JoinStep, OnAction } from "../types/relations";
import type { OrderByTuple } from "../types/filter-operators";
import type { ColumnsShape } from "./columns";

/**
 * What a relation may point at: a table or a view. Declared structurally so a
 * relation file does not have to import the table module it points back to.
 */
export interface RelationTarget {
    readonly brand: "rebase.table" | "rebase.view";
    readonly name: string;
}

/** The brand every relation builder result carries. */
export const RELATION_BRAND = "rebase.relation";

interface RelationDefBase<T extends RelationTarget> {
    readonly brand: typeof RELATION_BRAND;
    /** The table it points at, behind a thunk so two tables can point at each other. */
    readonly target: () => T;
}

/**
 * Options of `rel.belongsTo`.
 *
 * @group Schema
 */
export interface BelongsToOptions {
    /**
     * The SQL column on this table holding the foreign key. `<relation>_id`
     * when omitted. A column in `columns` with this SQL name is bound to;
     * otherwise the column is derived from the target's key.
     */
    localKey?: string;
    /** The derived column is `NOT NULL`. A bound column says so itself. */
    notNull?: boolean;
    /** The derived column is `UNIQUE`, making this side one-to-one. */
    unique?: boolean;
    /** `RESTRICT` when the column is `NOT NULL`, `SET NULL` otherwise. */
    onDelete?: OnAction;
    onUpdate?: OnAction;
    /** `false` skips the index on the foreign key that is otherwise created. */
    index?: boolean;
    /** `false` stores the key without a `FOREIGN KEY` constraint. */
    constraint?: boolean;
}

/**
 * Options of `rel.hasOne` and `rel.hasMany`.
 *
 * @group Schema
 */
export interface HasOptions {
    /** The SQL column on the target that points back here. Derived from this table's slug when omitted. */
    foreignKey?: string;
    /** The SQL column on this table it points at, when that is not the primary key. */
    sourceKey?: string;
}

/**
 * Options of `rel.hasMany`.
 *
 * @group Schema
 */
export interface HasManyOptions extends HasOptions {
    /** The order related rows come back in when the caller names none. */
    orderBy?: OrderByTuple | readonly OrderByTuple[];
}

/**
 * Options of `rel.manyToMany`.
 *
 * @group Schema
 */
export interface ManyToManyOptions<P extends ColumnsShape = ColumnsShape> {
    /** The junction table. The two table names, sorted and joined by `_`, when omitted. */
    through?: string;
    /** The junction column pointing at this table. */
    sourceKey?: string;
    /** The junction column pointing at the target. */
    targetKey?: string;
    /** Extra columns on the junction, read and written as `_pivot`. */
    pivot?: P;
    /** What happens to a link when either row is deleted. `CASCADE` when omitted. */
    onDelete?: OnAction;
}

/**
 * Options of `rel.via`.
 *
 * @group Schema
 */
export interface ViaOptions {
    /** The joins from this table to the target, in order. */
    steps: readonly JoinStep[];
    /** `many` when omitted. */
    cardinality?: "one" | "many";
}

/** `rel.belongsTo(...)`. */
export interface BelongsToDef<T extends RelationTarget = RelationTarget> extends RelationDefBase<T>, BelongsToOptions {
    readonly kind: "belongsTo";
}

/** `rel.hasOne(...)`. */
export interface HasOneDef<T extends RelationTarget = RelationTarget> extends RelationDefBase<T>, HasOptions {
    readonly kind: "hasOne";
}

/** `rel.hasMany(...)`. */
export interface HasManyDef<T extends RelationTarget = RelationTarget> extends RelationDefBase<T>, HasManyOptions {
    readonly kind: "hasMany";
}

/** `rel.manyToMany(...)`. */
export interface ManyToManyDef<T extends RelationTarget = RelationTarget, P extends ColumnsShape = ColumnsShape>
    extends RelationDefBase<T>, ManyToManyOptions<P> {
    readonly kind: "manyToMany";
}

/** `rel.via(...)`. */
export interface ViaDef<T extends RelationTarget = RelationTarget> extends RelationDefBase<T>, ViaOptions {
    readonly kind: "via";
}

/**
 * A relation as authored: the result of one `rel.*` call.
 *
 * @group Schema
 */
export type RelationDef<T extends RelationTarget = RelationTarget> =
    | BelongsToDef<T>
    | HasOneDef<T>
    | HasManyDef<T>
    | ManyToManyDef<T>
    | ViaDef<T>;

/**
 * The `relations` of a table: `rel.*` results by relation name.
 *
 * @group Schema
 */
export type RelationsShape = Record<string, RelationDef>;

function belongsTo<T extends RelationTarget>(target: () => T): BelongsToDef<T>;
function belongsTo<T extends RelationTarget, const O extends BelongsToOptions>(target: () => T, options: O): BelongsToDef<T> & O;
function belongsTo(target: () => RelationTarget, options: BelongsToOptions = {}): BelongsToDef {
    return { ...options, brand: RELATION_BRAND, kind: "belongsTo", target };
}

/**
 * The relation builders. All five kinds; the target is a thunk, so two tables
 * can point at each other whatever order their modules load in.
 *
 * ```ts
 * relations: {
 *     author: rel.belongsTo(() => users, { localKey: "author_id", notNull: true, onDelete: "restrict" }),
 *     tags:   rel.manyToMany(() => tags, { through: "posts_tags", pivot: { sortOrder: col.integer().default(0) } }),
 * }
 * ```
 *
 * @group Schema
 */
export const rel = {
    /**
     * This table holds the foreign key. Binds to the column in `columns` whose
     * SQL name is `localKey`, or derives that column and indexes it.
     */
    belongsTo,
    /** The target holds a unique foreign key pointing here. */
    hasOne<T extends RelationTarget>(target: () => T, options: HasOptions = {}): HasOneDef<T> {
        return { ...options, brand: RELATION_BRAND, kind: "hasOne", target };
    },
    /** The target holds a foreign key pointing here. */
    hasMany<T extends RelationTarget>(target: () => T, options: HasManyOptions = {}): HasManyDef<T> {
        return { ...options, brand: RELATION_BRAND, kind: "hasMany", target };
    },
    /**
     * Linked through a junction table, which is created with its own row-level
     * security. `pivot` columns are read and written as `_pivot`.
     */
    manyToMany<T extends RelationTarget, P extends ColumnsShape = Record<never, never>>(
        target: () => T,
        options: ManyToManyOptions<P> = {}
    ): ManyToManyDef<T, P> {
        return { ...options, brand: RELATION_BRAND, kind: "manyToMany", target };
    },
    /** A read-only traversal across several joins. */
    via<T extends RelationTarget>(target: () => T, options: ViaOptions): ViaDef<T> {
        if (!options.steps || options.steps.length === 0) {
            throw new Error("`rel.via(target, { steps })` needs at least one join step.");
        }
        return { ...options, brand: RELATION_BRAND, kind: "via", target };
    }
};

/**
 * Whether a value is the result of a `rel.*` call.
 *
 * @group Schema
 */
export function isRelationDef(value: unknown): value is RelationDef {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === RELATION_BRAND;
}
