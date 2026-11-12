import type { CollectionConfig, RelationDescriptor, ResolvedRelation, TableDescriptor } from "@rebasepro/types";
import { fieldKeyForColumn, getTableName, keyForColumn } from "@rebasepro/common";
import { toSnakeCase, toWireKey } from "@rebasepro/utils";

/**
 * The key a SQL column is served under on a table: its column's key, or — for
 * a column the table does not describe — the camelCase of its name, which is
 * the key a foreign key derived from it would get.
 */
export const servedKeyOf = (descriptor: TableDescriptor, sqlColumn: string): string =>
    keyForColumn(descriptor, sqlColumn) ?? toWireKey(sqlColumn);

/**
 * {@link sharedRelationName}, read from descriptors: the `relationName` both
 * sides of a link agree on, named after the table that carries the foreign key
 * and the key that column is served under.
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

/**
 * The `relationName` both sides of a link must agree on.
 *
 * Drizzle pairs an owning `one()` with its inverse `many()` by this string and
 * by nothing else, and the two sides are computed by different callers holding
 * different collections — so the rule has to be derivable from either end. It
 * is: name the link after the table that carries the foreign key and the field
 * key that column is served under.
 *
 *   owning  (belongsTo)      → `{thisTable}_{fieldKey(localKey)}`
 *   inverse (hasMany/hasOne) → `{targetTable}_{fieldKey(foreignKeyOnTarget)}`
 *
 * Both spellings of `jobs.company` produce `jobs_companyId`. A many-to-many is
 * named through its junction wiring and a `via` chain is not a Drizzle relation
 * at all, so both keep the local name.
 *
 * The field key rather than the column: the Drizzle object is keyed by the wire
 * name (`fieldKeyForColumn` is the one definition of it), and a name built from
 * the column would differ between a collection that declares `columnName` and
 * one that does not, for the same link.
 *
 * TRANSITIONAL: the collection twin of {@link tableRelationName}, kept for
 * `config-relations.ts` until it reads descriptors (next slice).
 *
 * **This is the one definition.** `generate-drizzle-schema-logic.ts` holds a
 * private copy (`computeSharedRelationName`) that this was lifted from verbatim;
 * the generator should import this instead, so the file it writes and the
 * relations the runtime builds from the live catalogue cannot drift apart.
 */
export function sharedRelationName(
    relation: ResolvedRelation,
    sourceCollection: CollectionConfig
): string {
    const fallback = (): string => {
        if (relation.relationName) return relation.relationName;
        try {
            return toSnakeCase(relation.target().slug);
        } catch {
            return relation.relationName;
        }
    };

    if (relation.kind === "belongsTo") {
        return `${getTableName(sourceCollection)}_${fieldKeyForColumn(sourceCollection, relation.localKey)}`;
    }

    if (relation.kind === "hasMany" || relation.kind === "hasOne") {
        try {
            const target = relation.target();
            return `${getTableName(target)}_${fieldKeyForColumn(target, relation.foreignKeyOnTarget)}`;
        } catch {
            return fallback();
        }
    }

    return fallback();
}
