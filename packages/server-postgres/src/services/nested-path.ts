import { CollectionConfig, Property, ResolvedRelation } from "@rebasepro/types";
import { apiHiddenFieldNames, findRelation, resolveCollectionRelations } from "@rebasepro/common";
import { namesHiddenFromCaller } from "./field-viewer";
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
        // A relation the API does not have is a segment that names nothing,
        // for this caller — and is never offered among the ones there are.
        const relation = namesHiddenFromCaller(parentCollection).has(relationKey)
            ? undefined
            : findRelation(resolvedRelations, relationKey);

        if (!relation) {
            const apiHidden = apiHiddenFieldNames(parentCollection);
            const available = Object.keys(resolvedRelations).filter(key => !apiHidden.has(key)).join(", ") || "(none)";
            // A path segment naming a relation the collection does not declare
            // is a bad URL, not a server fault. It answered 500 INTERNAL_ERROR,
            // which tells the caller to retry or report an outage over a
            // request that will never succeed — and buries a message that
            // already says exactly what is wrong.
            //
            // 404, like an unknown collection: the URL names nothing. The
            // available relations stay in the message because reaching this
            // point means the caller could already read the parent collection,
            // and `?include=` would list the same names.
            throw ApiError.notFound(
                `Relation '${relationKey}' not found in collection '${parentCollection.slug}'. Available relations: [${available}]`,
                "UNKNOWN_RELATION"
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
 * Reject a create or update whose body names a relation Rebase does not write
 * — a multi-hop `via` (`writable: false`) — before anything is read or written.
 *
 * A single-hop `via` is written through this door as it shipped (to-one: the
 * target's key; to-many: one junction's rows). A longer chain used to get as
 * far as the writer: a to-many one failed inside the transaction as a 500
 * RELATION_MISCONFIGURED telling the caller to regenerate a schema that was
 * fine, and a to-one one re-pointed the target at the first step's column.
 *
 * Matched the way the write path matches: a key that is a relation's own name
 * (the to-many split), or a `relation` property that resolves to one (the
 * to-one transformer). An `undefined` value is no value — the transformer skips
 * it — so it is not a write; `null` is, since it would unlink.
 */
export function assertNoReadOnlyRelationValues(values: Record<string, unknown>, collection: CollectionConfig): void {
    const properties: Record<string, Property | undefined> = collection.properties ?? {};
    let relations: Record<string, ResolvedRelation> | undefined;
    const named: string[] = [];
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        relations ??= resolveCollectionRelations(collection);
        const relation = relations[key] ?? (properties[key]?.type === "relation" ? findRelation(relations, key) : undefined);
        if (relation && !relation.writable) named.push(key);
    }
    if (named.length === 0) return;
    const list = named.map(key => `'${key}'`).join(", ");
    throw ApiError.badRequest(
        `${list} on '${collection.slug}' ${named.length > 1 ? "are multi-hop `via` relations" : "is a multi-hop `via` relation"}, ` +
        "which is read-only: only single-hop via relations are writable — a to-one chain of one step, or a to-many " +
        "chain through one junction table. Write the rows the chain joins directly.",
        "RELATION_NOT_WRITABLE",
        { collection: collection.slug, fields: named }
    );
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
    const { relation } = hop;

    // A `via` first, by kind: a single-hop one is `writable` through a create
    // or update of the parent, but this door creates or updates the *child*
    // under the parent's path and links it — and there is no link-stamping for
    // a join chain here, so a create would land unlinked. The nested door has
    // always refused every `via`; it still does.
    //
    // Otherwise read the flag rather than re-deriving the rule. This guard
    // used to test `cardinality !== "many"` — a second expression of one rule,
    // free to disagree with the first, which is the shape of defect the
    // resolved union exists to remove.
    if (relation.kind !== "via" && relation.writable && relation.cardinality === "many") return;

    if (relation.kind === "via") {
        throw ApiError.badRequest(
            `"${path}" ends in '${hop.relationKey}', a \`via\` relation, which a nested path does not write ` +
            `through — write the row at "${hop.targetCollection.slug}" directly` +
            (relation.writable
                ? `, and link it by setting '${hop.relationKey}' in an update of the '${hop.parentCollection.slug}' row.`
                : "."),
            "RELATION_NOT_WRITABLE"
        );
    }

    throw ApiError.badRequest(
        `"${path}" ends in the to-one relation '${hop.relationKey}', which cannot be written through: ` +
        `the foreign key for a to-one relation lives on '${hop.parentCollection.slug}', not on ` +
        `'${hop.targetCollection.slug}'. Write the target row at "${hop.targetCollection.slug}" and set ` +
        `'${hop.relationKey}' on the parent instead.`,
        "RELATION_NOT_WRITABLE"
    );
}
