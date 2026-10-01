import type { CollectionConfig, Property, RelationProperty, ResolvedRelation } from "@rebasepro/types";
import { resolveCollectionRelations } from "./relations";
import { resolveRelationProperty } from "./resolutions";

/**
 * Whether a duplicate of a record may carry this relation's value.
 *
 * A duplicate is saved as a create, and a create writes every relation it
 * carries. That is right where the link is the copy's own: a `belongsTo` key on
 * the copy's row, or `manyToMany` links, which are new junction rows beside the
 * original's — the targets are shared by design. It is wrong wherever the key
 * lives on the other row. Writing a `hasMany` or a `hasOne` points the
 * children's foreign key at the copy, which takes them away from the record
 * that was copied: duplicating an author moved every one of their posts to the
 * duplicate and left the original with none. A `via` is declared read-only,
 * and its one-to-one writer re-points the target's key the same way.
 *
 * Exhaustive over the kinds, so a new one is a compile error here rather than
 * a copy that quietly carries it.
 */
export function copyCarriesRelation(relation: ResolvedRelation): boolean {
    switch (relation.kind) {
        case "belongsTo":
        case "manyToMany":
            return true;
        case "hasOne":
        case "hasMany":
        case "via":
            return false;
        default: {
            const exhaustive: never = relation;
            throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/**
 * The values a duplicate of a record is created with: the original's, less
 * its key and less every relation the copy cannot take without changing
 * another row (see {@link copyCarriesRelation}).
 *
 * The key goes so the database, or the user, gives the copy its own. The
 * relations go because the copy is written as a create, and a create writes
 * them — for a child-held key that is a re-parent of rows the user never
 * touched, with nothing on screen to say so.
 *
 * A relation property that does not resolve is left out as well: what writing
 * it would do cannot be known here, and leaving a value out of a new record
 * changes nothing that exists.
 */
export function getCopyValues<M extends Record<string, unknown>>(
    collection: CollectionConfig,
    values: Partial<M>
): Partial<M> {
    const result: Record<string, unknown> = { ...values };

    for (const [key, raw] of Object.entries(collection.properties ?? {})) {
        const property = raw as Property | undefined;
        if (!property) continue;
        if ("isId" in property && property.isId) {
            delete result[key];
            continue;
        }
        if (property.type !== "relation") continue;
        let relation: ResolvedRelation | undefined;
        try {
            relation = resolveRelationProperty(property as RelationProperty, collection, key);
        } catch {
            relation = undefined;
        }
        if (!relation || !copyCarriesRelation(relation)) delete result[key];
    }

    // A relation declared in `relations`, with no property, can still come back
    // on the row under its name. One whose target does not resolve cannot be
    // written by the server either, so the copy's save reports it; failing
    // here would only stop the form from opening.
    let declared: Record<string, ResolvedRelation> = {};
    try {
        declared = resolveCollectionRelations(collection);
    } catch {
        declared = {};
    }
    for (const [name, relation] of Object.entries(declared)) {
        if (!copyCarriesRelation(relation)) delete result[name];
    }

    return result as Partial<M>;
}
