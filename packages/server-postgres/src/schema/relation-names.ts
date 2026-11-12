import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { keyForColumn } from "@rebasepro/common";
import { toWireKey } from "@rebasepro/utils";

/**
 * The key a SQL column is served under on a table: its column's key, or — for
 * a column the table does not describe — the camelCase of its name, which is
 * the key a foreign key derived from it would get.
 */
export const servedKeyOf = (descriptor: TableDescriptor, sqlColumn: string): string =>
    keyForColumn(descriptor, sqlColumn) ?? toWireKey(sqlColumn);

/**
 * The `relationName` both sides of a link must agree on.
 *
 * Drizzle pairs an owning `one()` with its inverse `many()` by this string and
 * by nothing else, and the two sides are computed by different callers holding
 * different tables — so the rule has to be derivable from either end. It is:
 * name the link after the table that carries the foreign key and the key that
 * column is served under (the key, not the column: the Drizzle object is keyed
 * by the wire name, {@link servedKeyOf}).
 *
 *   owning  (belongsTo)      → `{thisTable}_{key(localKey)}`
 *   inverse (hasMany/hasOne) → `{targetTable}_{key(foreignKey)}`
 *
 * A many-to-many and a `via` chain keep the relation's own name.
 */
export function tableRelationName(
    relation: RelationDescriptor,
    source: TableDescriptor,
    targetOf: (slug: string) => TableDescriptor
): string {
    if (relation.kind === "belongsTo") return `${source.table}_${servedKeyOf(source, relation.localKey)}`;
    if (relation.kind === "hasMany" || relation.kind === "hasOne") {
        const target = targetOf(relation.target);
        return `${target.table}_${servedKeyOf(target, relation.foreignKey)}`;
    }
    return relation.name;
}
