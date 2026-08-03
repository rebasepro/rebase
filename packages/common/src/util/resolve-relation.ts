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

    const targetCollection = callTarget(relation, sourceCollection, propertyKey, target);

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
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName),
                sourceKey: relation.sourceKey
            };

        case "hasMany":
            return {
                ...shared,
                kind: "hasMany",
                cardinality: "many",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName),
                // Not defaulted: the source's primary key needs the driver's
                // schema to resolve, which resolution does not have. `undefined`
                // means "the primary key" — see `ResolvedHasMany.sourceKey`.
                sourceKey: relation.sourceKey
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

/** How this relation is addressed in an error message, before it has a resolved name. */
function describe(relation: Relation, sourceCollection: CollectionConfig, propertyKey?: string): string {
    const name = relation.relationName ?? propertyKey;
    return `Relation${name ? ` '${name}'` : ""} on '${sourceCollection.slug}'`;
}

/**
 * Call the `target` thunk, and translate the two ways an import cycle breaks it
 * into an error that names the cause.
 *
 * The thunk exists to defer the reference until every module has finished
 * evaluating, and for a cycle that closes at import time it does. What it cannot
 * defer is a cycle that leaves the binding permanently unusable, and there are
 * two shapes of that:
 *
 *  - **ESM/TDZ.** `const` and `class` bindings in a not-yet-evaluated module are
 *    in the temporal dead zone, so reading one throws `ReferenceError: x is not
 *    defined`. The stack points at the thunk — a one-line arrow function that is
 *    obviously fine — and says nothing about the cycle that made it throw.
 *  - **CJS interop.** The half-initialised module object has no `default` yet,
 *    the import resolves to `undefined`, and the thunk returns it without
 *    complaint. That one used to surface here as "did not resolve to a
 *    collection", which is true and unhelpful.
 *
 * Both mean the same thing, and the fix for both is the same: break the cycle,
 * or move the relation into the collection that does not close it.
 */
function callTarget(
    relation: Relation,
    sourceCollection: CollectionConfig,
    propertyKey: string | undefined,
    target: Relation["target"]
): ReturnType<Relation["target"]> {
    let targetCollection: ReturnType<Relation["target"]> | undefined;
    try {
        targetCollection = target();
    } catch (error) {
        // A ReferenceError from inside the thunk is a binding that was never
        // initialised — nothing else in a one-expression arrow can raise one.
        if (error instanceof ReferenceError) {
            throw new Error(
                `${describe(relation, sourceCollection, propertyKey)} targets a collection that is not ` +
                `initialized yet — almost always an import cycle between the two collection files. ` +
                `Break the cycle (move the shared piece into a third module, or import the target ` +
                `lazily) so the target's module finishes evaluating before the registry is built.`,
                { cause: error }
            );
        }
        throw error;
    }

    if (!targetCollection?.slug) {
        throw new Error(
            `${describe(relation, sourceCollection, propertyKey)} has a \`target\` that resolved to ` +
            `${targetCollection === undefined ? "`undefined`" : "something that is not a collection"}. ` +
            (targetCollection === undefined
                ? "Under CommonJS interop an import cycle resolves the default import to `undefined`, " +
                  "so check whether this collection and its target import each other. Otherwise the thunk " +
                  "is returning the wrong value — it must return the collection itself, not a promise or a module."
                : "The thunk must return a collection config with a `slug`.")
        );
    }

    return targetCollection;
}
