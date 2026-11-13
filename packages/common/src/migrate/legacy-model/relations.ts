/**
 * The pre-0.31 relation model, frozen at 0.30 — part of the migration's input
 * format (see `./index.ts`). Nothing at runtime may import it.
 */
import type { LegacyWithAdminCollectionConfig } from "./admin";
import type { LegacyAnyCollectionConfig } from "./collections";
import type { LegacyProperties } from "./properties";

/**
 * A foreign key's `ON DELETE` / `ON UPDATE` action.
 *
 * @group Migration
 */
export type LegacyOnAction = "cascade" | "restrict" | "no action" | "set null" | "set default";

/**
 * The kind of a legacy relation.
 *
 * @group Migration
 */
export type LegacyRelationKind = "belongsTo" | "hasOne" | "hasMany" | "manyToMany" | "via";

/**
 * The fields every legacy relation has.
 *
 * @group Migration
 */
export interface LegacyRelationBase {
    /** The include key; defaults to the declaring property's key, then the target's slug. */
    relationName?: string;
    target: () => LegacyAnyCollectionConfig;
    onUpdate?: LegacyOnAction;
    onDelete?: LegacyOnAction;
    /** How the panel presents the relation's tab: collection fields, `admin` included. */
    overrides?: Partial<LegacyWithAdminCollectionConfig>;
}

/**
 * This collection holds the foreign key.
 *
 * @group Migration
 */
export interface LegacyBelongsToRelation extends LegacyRelationBase {
    kind: "belongsTo";
    localKey?: string;
    index?: boolean;
}

/**
 * The target holds a foreign key to this collection; one row.
 *
 * @group Migration
 */
export interface LegacyHasOneRelation extends LegacyRelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;
    sourceKey?: string;
}

/**
 * The target holds a foreign key to this collection; many rows.
 *
 * @group Migration
 */
export interface LegacyHasManyRelation extends LegacyRelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;
    sourceKey?: string;
}

/**
 * A junction table links the two collections.
 *
 * @group Migration
 */
export interface LegacyManyToManyRelation extends LegacyRelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;
        targetColumn?: string;
        /** The junction's payload columns. */
        properties?: LegacyProperties;
    };
}

/**
 * A chain of joins.
 *
 * @group Migration
 */
export interface LegacyViaRelation extends LegacyRelationBase {
    kind: "via";
    cardinality: "one" | "many";
    joinPath: LegacyJoinStep[];
}

/**
 * A legacy relation, as declared.
 *
 * @group Migration
 */
export type LegacyRelation =
    | LegacyBelongsToRelation
    | LegacyHasOneRelation
    | LegacyHasManyRelation
    | LegacyManyToManyRelation
    | LegacyViaRelation;

/**
 * One join of a `via` chain.
 *
 * @group Migration
 */
export interface LegacyJoinStep {
    table: string;
    on: LegacyJoinCondition | LegacyJoinCondition[];
}

/**
 * The columns one join matches.
 *
 * @group Migration
 */
export interface LegacyJoinCondition {
    from: string | string[];
    to: string | string[];
}

/**
 * The fields every resolved relation has: the declaration with its defaults filled in.
 *
 * @group Migration
 */
export interface LegacyResolvedRelationBase {
    relationName: string;
    target: () => LegacyAnyCollectionConfig;
    targetSlug: string;
    onUpdate?: LegacyOnAction;
    onDelete?: LegacyOnAction;
    overrides?: Partial<LegacyWithAdminCollectionConfig>;
    cardinality: "one" | "many";
    writable: boolean;
    shared: boolean;
}

/**
 * A resolved `belongsTo`.
 *
 * @group Migration
 */
export interface LegacyResolvedBelongsTo extends LegacyResolvedRelationBase {
    kind: "belongsTo";
    cardinality: "one";
    writable: true;
    shared: false;
    localKey: string;
    index: boolean;
}

/**
 * A resolved `hasOne`.
 *
 * @group Migration
 */
export interface LegacyResolvedHasOne extends LegacyResolvedRelationBase {
    kind: "hasOne";
    cardinality: "one";
    writable: true;
    shared: false;
    foreignKeyOnTarget: string;
    sourceKey?: string;
}

/**
 * A resolved `hasMany`.
 *
 * @group Migration
 */
export interface LegacyResolvedHasMany extends LegacyResolvedRelationBase {
    kind: "hasMany";
    cardinality: "many";
    writable: true;
    shared: false;
    foreignKeyOnTarget: string;
    sourceKey?: string;
}

/**
 * A resolved `manyToMany`.
 *
 * @group Migration
 */
export interface LegacyResolvedManyToMany extends LegacyResolvedRelationBase {
    kind: "manyToMany";
    cardinality: "many";
    writable: true;
    shared: true;
    through: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
        properties: LegacyProperties;
    };
}

/**
 * A resolved `via`.
 *
 * @group Migration
 */
export interface LegacyResolvedVia extends LegacyResolvedRelationBase {
    kind: "via";
    writable: boolean;
    joinPath: LegacyJoinStep[];
}

/**
 * A legacy relation with its defaults filled in.
 *
 * @group Migration
 */
export type LegacyResolvedRelation =
    | LegacyResolvedBelongsTo
    | LegacyResolvedHasOne
    | LegacyResolvedHasMany
    | LegacyResolvedManyToMany
    | LegacyResolvedVia;
