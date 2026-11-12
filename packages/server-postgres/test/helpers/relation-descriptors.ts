import type { ColumnDescriptor, JoinStep, OrderByTuple, RelationDescriptor } from "@rebasepro/types";
import type { RelationOfKind } from "@rebasepro/common";

import type { PostgresTableRegistry } from "../../src/model/PostgresTableRegistry";

/**
 * Relation descriptors written out by hand, for the tests that hand one to a
 * builder directly — what a compiled `rel.*` produces, every key spelled out.
 * A test that holds a registry reads the relation off its table instead
 * ({@link relationOfTable}).
 */

/** `rel.manyToMany(target, { through, sourceKey, targetKey, pivot })`, compiled. */
export function manyToMany(
    name: string,
    target: string,
    through: { table: string; sourceKey: string; targetKey: string },
    pivot: ColumnDescriptor[] = []
): RelationOfKind<"manyToMany"> {
    return { kind: "manyToMany", name, target, cardinality: "many", through: { ...through, pivot } };
}

/** `rel.via(target, { steps, cardinality })`, compiled. */
export function via(
    name: string,
    target: string,
    cardinality: "one" | "many",
    steps: JoinStep[],
    writable = false
): RelationOfKind<"via"> {
    return { kind: "via", name, target, cardinality, steps, writable };
}

/** `rel.hasMany` / `rel.hasOne(target, { foreignKey, sourceKey, orderBy })`, compiled. */
export function hasMany(
    name: string,
    target: string,
    foreignKey: string,
    options: { sourceKey?: string; orderBy?: OrderByTuple[]; one?: boolean } = {}
): Extract<RelationDescriptor, { kind: "hasOne" | "hasMany" }> {
    return {
        kind: options.one ? "hasOne" : "hasMany",
        name,
        target,
        cardinality: options.one ? "one" : "many",
        foreignKey,
        ...(options.sourceKey !== undefined ? { sourceKey: options.sourceKey } : {}),
        ...(options.orderBy !== undefined ? { orderBy: options.orderBy } : {})
    };
}

/** `rel.belongsTo(target, { localKey })`, compiled; `localField` is the column's key. */
export function belongsTo(name: string, target: string, localKey: string, localField: string): RelationOfKind<"belongsTo"> {
    return { kind: "belongsTo", name, target, cardinality: "one", localKey, localField, index: true, constraint: true };
}

/** The relation `name` of the table served at `slug`, as the registry compiled it. Throws when there is none. */
export function relationOfTable(registry: PostgresTableRegistry, slug: string, name: string): RelationDescriptor {
    const relation = registry.requireTable(slug).relations.get(name);
    if (!relation) throw new Error(`The test table '${slug}' has no relation '${name}'.`);
    return relation;
}
