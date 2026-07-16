import { CollectionConfig, Relation } from "@rebasepro/types";
import { resolveCollectionRelations, findRelation, createRelationRefWithData } from "@rebasepro/common";
import { normalizeDbValues } from "../data-transformer";
import { deriveRowAddress } from "./collection-helpers";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";

/**
 * Turning a drizzle result into a row we serve.
 *
 * There are two shapes, and they are the same walk. Both take a row whose
 * relation fields hold nested objects, both unwrap junction rows to reach the
 * target behind them, and both leave every other column alone. They differ only
 * in what they put where the relation was:
 *
 * - `"ref"` — a `{ id, path, __type: "relation" }` reference carrying the
 *   target's values. This is what the admin renders.
 * - `"inline"` — the target's own columns, flat. This is what REST serves.
 *
 * They used to be two functions that happened to agree, and the agreement was
 * not enforced by anything: the row-identity bug had to be fixed five times
 * across differently-shaped copies of this walk, and one of the copies was
 * dead code nobody had noticed. Whatever the next cross-cutting change is, it
 * is one edit here.
 */
export type RelationStyle = "ref" | "inline";

/**
 * Whether a many-relation reaches its target through a junction table.
 *
 * Also used to build the drizzle `with` config, which is why it is exported:
 * the query has to nest one level deeper for a junction, and the row walk has
 * to unwrap that same level back out.
 */
export function isJunctionRelation(relation: Relation): boolean {
    // An explicit `through` says so outright.
    if (relation.through) return true;
    // A joinPath with an intermediate table is the same thing, spelled longhand.
    if (relation.joinPath && relation.joinPath.length > 1) return true;
    return false;
}

/**
 * Reach the target row inside a junction row.
 *
 * A junction row looks like `{ post_id: 1, tag_id: { id: 5, name: "ts" } }` —
 * the foreign keys, and the target nested under one of them. The target is the
 * only object among them, so that is how it is found. A junction row that has
 * not been nested (no `with` on the join) has no object and is returned as-is.
 */
function unwrapJunctionRow(item: Record<string, unknown>): Record<string, unknown> {
    const nestedKey = Object.keys(item).find(
        key => typeof item[key] === "object" && item[key] !== null && !Array.isArray(item[key])
    );
    return nestedKey ? item[nestedKey] as Record<string, unknown> : item;
}

/** Render one target row in the requested style. */
function renderTarget(
    targetRow: Record<string, unknown>,
    targetCollection: CollectionConfig,
    style: RelationStyle,
    registry: PostgresCollectionRegistry
): unknown {
    if (style === "inline") {
        // The target's columns, and only those: its address is the consumer's
        // to derive, and merging one in overwrites a real `id` column.
        return { ...targetRow };
    }

    const address = relationTargetAddress(targetRow, targetCollection, registry);
    const path = targetCollection.slug;
    return createRelationRefWithData(address, path, {
        id: address,
        path,
        values: normalizeDbValues(targetRow, targetCollection)
    });
}

/**
 * The address a relation ref points at.
 *
 * The whole key, not its first column: a composite-keyed target addressed by
 * `tenant_id` alone points at every row that shares it. A target whose key
 * cannot be resolved at all used to throw here — reading `[0]` of an empty
 * array — taking down the parent's fetch over a relation it may not even have
 * asked for. The first column is a guess, but a ref that resolves to nothing
 * beats no rows at all.
 */
export function relationTargetAddress(
    targetRow: Record<string, unknown>,
    targetCollection: CollectionConfig,
    registry: PostgresCollectionRegistry
): string {
    const address = deriveRowAddress(targetRow, targetCollection, registry);
    if (address) return address;
    return String(targetRow[Object.keys(targetRow)[0]] ?? "");
}

/**
 * The row the admin renders: every column, with relations as references.
 *
 * Values are normalized (dates, numbers, NaN) because the admin's view-model
 * expects real types. The row's own address is *not* among the columns — it is
 * derived by the consumer from the collection's primary keys.
 */
export function toCmsRow(
    row: Record<string, unknown>,
    collection: CollectionConfig,
    registry: PostgresCollectionRegistry
): Record<string, unknown> {
    const resolvedRelations = resolveCollectionRelations(collection);
    const normalized = normalizeDbValues(row, collection) as Record<string, unknown>;

    // Keyed by relation, reading the drizzle relation name off the raw row: the
    // relation's property key and the name drizzle nested it under are not
    // always the same, and the value is written back under the property key.
    for (const [key, relation] of Object.entries(resolvedRelations)) {
        const relData = row[relation.relationName || key];
        if (relData === undefined || relData === null) continue;

        if (relation.cardinality === "many" && Array.isArray(relData)) {
            const targetCollection = relation.target();
            normalized[key] = relData.map((item: Record<string, unknown>) =>
                renderTarget(
                    isJunctionRelation(relation) ? unwrapJunctionRow(item) : item,
                    targetCollection,
                    "ref",
                    registry
                ));
        } else if (relation.cardinality === "one" && typeof relData === "object" && !Array.isArray(relData)) {
            normalized[key] = renderTarget(relData as Record<string, unknown>, relation.target(), "ref", registry);
        }
    }

    return normalized;
}

/**
 * The row REST serves: every column under its own name, with the value Postgres
 * returned, and relations inlined as the target's columns.
 *
 * Deliberately not normalized: REST serves what the database holds, and JSON
 * has its own opinions about dates that the admin's view-model does not share.
 *
 * Keyed by the row rather than by the relation list — a REST fetch only loads
 * the relations `include` asked for, so the row is the authority on which are
 * actually there.
 */
export function toRestRow(
    row: Record<string, unknown>,
    collection: CollectionConfig,
    registry: PostgresCollectionRegistry
): Record<string, unknown> {
    const resolvedRelations = resolveCollectionRelations(collection);
    const flat: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
        const relation = findRelation(resolvedRelations, key);

        if (relation && Array.isArray(value)) {
            flat[key] = value.map((item: Record<string, unknown>) =>
                renderTarget(
                    isJunctionRelation(relation) ? unwrapJunctionRow(item) : item,
                    relation.target(),
                    "inline",
                    registry
                ));
        } else if (relation && typeof value === "object" && value !== null) {
            flat[key] = renderTarget(value as Record<string, unknown>, relation.target(), "inline", registry);
        } else {
            flat[key] = value;
        }
    }

    return flat;
}
