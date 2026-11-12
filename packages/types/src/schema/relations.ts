import type { JoinStep, OnAction } from "../types/relations";
import type { OrderByTuple } from "../types/filter-operators";
import type { ColumnAccess } from "./column_options";
import type { ColumnsShape } from "./columns";

/**
 * A relation's target, as written: `() => users`.
 *
 * Typed `() => void` on purpose. A thunk typed by what it returns (generic
 * over the returned table, a structural table type, or `() => unknown`) makes
 * TypeScript resolve the returned table's type while it is still inferring the
 * table being defined, so two tables that point at each other — `posts.author`
 * → `users`, `users.posts` → `posts` — failed with TS7022/TS7024 unless one
 * thunk was annotated. A `void` return is the one form TypeScript never
 * resolves, so mutual and self relations need no annotation, in one file or
 * across files.
 *
 * What the thunk returns is checked when the schema is compiled instead: a
 * thunk that does not return a `defineTable` / `defineView` result is refused
 * by `compileTables`, naming the table and the relation.
 *
 * @group Schema
 */
export type TableThunk = () => void;

/** The brand every relation builder result carries. */
export const RELATION_BRAND = "rebase.relation";

interface RelationDefBase {
    readonly brand: typeof RELATION_BRAND;
    /**
     * The table it points at, behind a thunk so two tables can point at each
     * other. Typed `() => unknown`: read it through `isTableDef` / `isViewDef`.
     */
    readonly target: () => unknown;
}

/**
 * Field-level access on a relation, accepted by every `rel.*`: who may read
 * the relation (`include` it, see its key) and who may write a link through it.
 * The same rules a column states with `.access()` / `.private()`, enforced by
 * the server on every door — an `include` the caller may not read is refused,
 * a nested write the caller may not make is refused.
 *
 * @group Schema
 */
export interface RelationAccessOptions {
    /**
     * Per-role read and write access to the relation. `read` lists the roles
     * that may include it; `write` the roles that may link or unlink through
     * it. Omitted: whoever the table's `rls` lets read or write the row.
     */
    access?: ColumnAccess;
    /**
     * `true` keeps the relation off the wire entirely: not includable, not in
     * the SDK or OpenAPI. Only server code traverses it. Not combined with
     * `access`.
     */
    private?: boolean;
}

/**
 * Options of `rel.belongsTo`.
 *
 * @group Schema
 */
export interface BelongsToOptions extends RelationAccessOptions {
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
export interface HasOptions extends RelationAccessOptions {
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
export interface ManyToManyOptions<P extends ColumnsShape = ColumnsShape> extends RelationAccessOptions {
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
export interface ViaOptions extends RelationAccessOptions {
    /** The joins from this table to the target, in order. */
    steps: readonly JoinStep[];
    /** `many` when omitted. */
    cardinality?: "one" | "many";
}

/** `rel.belongsTo(...)`. */
export interface BelongsToDef extends RelationDefBase, BelongsToOptions {
    readonly kind: "belongsTo";
}

/** `rel.hasOne(...)`. */
export interface HasOneDef extends RelationDefBase, HasOptions {
    readonly kind: "hasOne";
}

/** `rel.hasMany(...)`. */
export interface HasManyDef extends RelationDefBase, HasManyOptions {
    readonly kind: "hasMany";
}

/** `rel.manyToMany(...)`. */
export interface ManyToManyDef<P extends ColumnsShape = ColumnsShape> extends RelationDefBase, ManyToManyOptions<P> {
    readonly kind: "manyToMany";
}

/** `rel.via(...)`. */
export interface ViaDef extends RelationDefBase, ViaOptions {
    readonly kind: "via";
}

/**
 * A relation as authored: the result of one `rel.*` call.
 *
 * @group Schema
 */
export type RelationDef =
    | BelongsToDef
    | HasOneDef
    | HasManyDef
    | ManyToManyDef
    | ViaDef;

/**
 * The `relations` of a table: `rel.*` results by relation name.
 *
 * @group Schema
 */
export type RelationsShape = Record<string, RelationDef>;

function belongsTo(target: TableThunk): BelongsToDef;
function belongsTo<const O extends BelongsToOptions>(target: TableThunk, options: O): BelongsToDef & O;
function belongsTo(target: TableThunk, options: BelongsToOptions = {}): BelongsToDef {
    return { ...options, brand: RELATION_BRAND, kind: "belongsTo", target };
}

/**
 * The relation builders. All five kinds; the target is a thunk, so two tables
 * can point at each other whatever order their modules load in — and, being a
 * {@link TableThunk}, without a type annotation on either side.
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
    hasOne(target: TableThunk, options: HasOptions = {}): HasOneDef {
        return { ...options, brand: RELATION_BRAND, kind: "hasOne", target };
    },
    /** The target holds a foreign key pointing here. */
    hasMany(target: TableThunk, options: HasManyOptions = {}): HasManyDef {
        return { ...options, brand: RELATION_BRAND, kind: "hasMany", target };
    },
    /**
     * Linked through a junction table, which is created with its own row-level
     * security. `pivot` columns are read and written as `_pivot`.
     */
    manyToMany<P extends ColumnsShape = Record<never, never>>(
        target: TableThunk,
        options: ManyToManyOptions<P> = {}
    ): ManyToManyDef<P> {
        return { ...options, brand: RELATION_BRAND, kind: "manyToMany", target };
    },
    /** A read-only traversal across several joins. */
    via(target: TableThunk, options: ViaOptions): ViaDef {
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
