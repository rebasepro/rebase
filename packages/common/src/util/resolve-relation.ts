import {
    CollectionConfig,
    Relation,
    ResolvedRelation
} from "@rebasepro/types";
import { generateForeignKeyName, toSnakeCase } from "@rebasepro/utils";

import { getTableName } from "./relations";

/**
 * Fill in a relation's defaults.
 *
 * This replaces `sanitizeRelation`, which had to work out *which kind of link
 * you meant* from whichever optional fields happened to be set — 194 lines of
 * it, including a pass that inspected the target collection's own relations to
 * decide whether a `many`/`inverse` pair was a one-to-many or the far side of a
 * many-to-many, wrapped in a `try/catch` that fell through to the wrong answer
 * when it could not tell. Two consumers running that logic at different moments
 * could reach different conclusions about the same relation.
 *
 * With the kind declared there is nothing to work out. What remains is
 * defaulting — a table name, a column name — which is deterministic, depends
 * only on the relation and its two endpoints, and cannot fail. That is why this
 * function returns rather than throws, and why it needs no cache to be
 * consistent.
 */
export function resolveRelation(
    relation: Relation,
    sourceCollection: CollectionConfig,
    propertyKey?: string
): ResolvedRelation {
    const target = relation.target;
    if (typeof target !== "function") {
        throw new Error(
            `Relation${relation.relationName ? ` '${relation.relationName}'` : ""} on ` +
            `'${sourceCollection.slug}' has no \`target\`. Give it a thunk: \`target: () => otherCollection\`.`
        );
    }

    const targetCollection = target();
    if (!targetCollection?.slug) {
        throw new Error(
            `Relation${relation.relationName ? ` '${relation.relationName}'` : ""} on ` +
            `'${sourceCollection.slug}' has a \`target\` that did not resolve to a collection.`
        );
    }

    // The name is the address: the `include` key, the admin tab, and the
    // segment of a nested path. Declared name wins, then the declaring
    // property's key, then the target's slug.
    const relationName = relation.relationName ?? propertyKey ?? toSnakeCase(targetCollection.slug);

    const shared: Pick<ResolvedRelation, "relationName" | "target" | "targetSlug" | "onUpdate" | "onDelete" | "overrides" | "validation"> = {
        relationName,
        target,
        targetSlug: targetCollection.slug,
        onUpdate: relation.onUpdate,
        onDelete: relation.onDelete,
        overrides: relation.overrides,
        validation: relation.validation
    };

    const sourceName = toSnakeCase(sourceCollection.slug ?? sourceCollection.name);

    switch (relation.kind) {
        case "belongsTo":
            return {
                ...shared,
                kind: "belongsTo",
                cardinality: "one",
                writable: true,
                shared: false,
                localKey: relation.localKey ?? generateForeignKeyName(relationName)
            };

        case "hasOne":
            return {
                ...shared,
                kind: "hasOne",
                cardinality: "one",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName)
            };

        case "hasMany":
            return {
                ...shared,
                kind: "hasMany",
                cardinality: "many",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName)
            };

        case "manyToMany": {
            const sourceTable = getTableName(sourceCollection);
            const targetTable = getTableName(targetCollection);
            return {
                ...shared,
                kind: "manyToMany",
                cardinality: "many",
                writable: true,
                shared: true,
                through: {
                    // Sorted so both sides of the same link derive the same
                    // table without having to agree in advance.
                    table: relation.through?.table ?? [sourceTable, targetTable].sort().join("_"),
                    sourceColumn: relation.through?.sourceColumn ?? generateForeignKeyName(sourceName),
                    targetColumn: relation.through?.targetColumn ?? generateForeignKeyName(relationName)
                }
            };
        }

        case "via":
            return {
                ...shared,
                kind: "via",
                cardinality: relation.cardinality,
                writable: false,
                // A join chain reaches rows that other parents reach too, and
                // Rebase does not know which hop, if any, is a link it owns.
                shared: true,
                joinPath: relation.joinPath
            };

        default: {
            // Exhaustive: a new kind is a compile error here, not a silent
            // fall-through to whatever shape happened to match first.
            const exhaustive: never = relation;
            throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
        }
    }
}
