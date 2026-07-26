import { CollectionConfig, ResolvedRelation } from "@rebasepro/types";
import { findRelation, resolveCollectionRelations } from "@rebasepro/common";
import { ApiError } from "@rebasepro/server";

import { getCollectionByPath } from "./collection-helpers";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";

/**
 * The last hop of a nested collection path, e.g. `authors/1/posts`.
 *
 * The walk that produces this was written out four separate times — in
 * `FetchService.fetchCollectionFromPath`, `FetchService.countEntitiesFromPath`,
 * `PersistService.save` and `CollectionRegistry.getCollectionByPath` — and had
 * drifted, so the read path and the write path did not agree on which relation
 * a path named. It lives here once now.
 */
export interface NestedPathHop {
    /** The collection the final relation is declared on (e.g. `authors`). */
    parentCollection: CollectionConfig;
    /** The parent's id as it appeared in the path, unparsed. */
    parentId: string;
    /** The path segment that named the relation (e.g. `posts`). */
    relationKey: string;
    relation: ResolvedRelation;
    /** `relation.target()`, resolved once. */
    targetCollection: CollectionConfig;
}

/**
 * True when `path` addresses rows through a relation rather than a root
 * collection.
 *
 * Any separator at all counts — a root collection slug never contains one — so
 * a malformed path like `collection/id` is a *broken* nested path and gets
 * reported as one by {@link resolveNestedPath}, rather than being looked up as
 * a root collection whose slug happens to contain a slash.
 */
export function isNestedPath(path: string): boolean {
    return path.includes("/");
}

export function splitPathSegments(path: string): string[] {
    return path.split("/").filter(s => s && s !== "undefined");
}

/**
 * Walk a nested collection path down to the relation it ends in.
 *
 * Returns `undefined` for a plain root-collection path so callers can keep the
 * root case on its existing code path. Throws when the path is malformed, or
 * when a segment names a relation that does not exist — the same errors the
 * individual walks used to raise, with the available names attached.
 */
export function resolveNestedPath(
    path: string,
    registry: PostgresCollectionRegistry
): NestedPathHop | undefined {
    if (!isNestedPath(path)) return undefined;

    const segments = splitPathSegments(path);
    if (segments.length < 3 || segments.length % 2 === 0) {
        throw new Error(`Invalid relation path: ${path}. Expected format: collection/id/relation`);
    }

    let parentCollection = getCollectionByPath(segments[0], registry);
    let parentId = segments[1];

    for (let i = 2; i < segments.length; i += 2) {
        const relationKey = segments[i];
        const resolvedRelations = resolveCollectionRelations(parentCollection);
        const relation = findRelation(resolvedRelations, relationKey);

        if (!relation) {
            const available = Object.keys(resolvedRelations).join(", ") || "(none)";
            throw new Error(
                `Relation '${relationKey}' not found in collection '${parentCollection.slug}'. Available relations: [${available}]`
            );
        }

        const targetCollection = relation.target();

        if (i === segments.length - 1) {
            return {
                parentCollection,
                parentId,
                relationKey,
                relation,
                targetCollection
            };
        }

        parentCollection = targetCollection;
        parentId = segments[i + 1];
    }

    // Unreachable: the loop returns on the final segment, and the odd-length
    // check above guarantees there is one.
    throw new Error(`Unable to resolve path: ${path}`);
}

/**
 * A relation reached through a junction table — many-to-many, or a multi-hop
 * `joinPath`. The target row is shared with other parents, so writing "through"
 * such a path addresses the *link*, not the row.
 */
export function isJunctionBackedRelation(relation: ResolvedRelation): boolean {
    return relation.shared;
}

/**
 * Reject a nested write whose final segment is a to-one relation.
 *
 * There is no column on the target row that records a to-one parent — the
 * foreign key lives on the *parent* table. The write path used to fall through
 * to `relation.localKey` here and stamp the parent's own FK column onto the
 * target row, which either raised an opaque "column does not exist" or, when a
 * column of that name happened to exist on the target, silently wrote the wrong
 * one.
 */
export function assertWritableThrough(hop: NestedPathHop, path: string): void {
    if (hop.relation.cardinality !== "many") {
        throw ApiError.badRequest(
            `"${path}" ends in the to-one relation '${hop.relationKey}', which cannot be written through: ` +
            `the foreign key for a to-one relation lives on '${hop.parentCollection.slug}', not on ` +
            `'${hop.targetCollection.slug}'. Write the target row at "${hop.targetCollection.slug}" and set ` +
            `'${hop.relationKey}' on the parent instead.`,
            "RELATION_NOT_WRITABLE"
        );
    }
}
