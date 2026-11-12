import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";

/**
 * Relation lookup over a {@link TableDescriptor}. A relation names its target
 * by slug; resolve the target through the table registry, never through a
 * thunk.
 *
 * @module
 */

/**
 * A relation of one kind.
 *
 * @group Table
 */
export type RelationOfKind<K extends RelationDescriptor["kind"]> = Extract<RelationDescriptor, { kind: K }>;

/**
 * The relation with this name, or `undefined`.
 *
 * Exact: a relation's name is what `include` and a nested path say, and the
 * compiler already refused two relations (or a relation and a column) sharing
 * one. Replaces `findRelation(resolveCollectionRelations(collection), name)`,
 * whose slug/snake_case retries guessed at a name the caller misspelled.
 *
 * @group Table
 */
export function relationOf(table: TableDescriptor, name: string): RelationDescriptor | undefined {
    return table.relations.find(relation => relation.name === name);
}

/**
 * The `belongsTo` relation whose foreign key is this column, given by key or
 * by SQL name, or `undefined`.
 *
 * Replaces scanning `resolveCollectionRelations(collection)` for a
 * `belongsTo` whose `localKey` matches, then `fieldKeyForColumn` on it.
 *
 * @group Table
 */
export function belongsToForColumn(table: TableDescriptor, keyOrSqlName: string): RelationOfKind<"belongsTo"> | undefined {
    for (const relation of table.relations) {
        if (relation.kind !== "belongsTo") continue;
        if (relation.localField === keyOrSqlName || relation.localKey === keyOrSqlName) return relation;
    }
    return undefined;
}

/**
 * The relations of one kind, in declaration order.
 *
 * @group Table
 */
export function relationsOfKind<K extends RelationDescriptor["kind"]>(table: TableDescriptor, kind: K): RelationOfKind<K>[] {
    return table.relations.filter((relation): relation is RelationOfKind<K> => relation.kind === kind);
}
