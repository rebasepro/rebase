import {
    getDataSourceCapabilities
} from "@rebasepro/types";
import {
    CollectionConfig,
    getDeclaredSubcollections,
    type EntityChildView
} from "../types/collections";
import {
    Property,
    RelationProperty
} from "../types/properties";
import {
    ResolvedRelation
} from "../types/relation_kinds";
import { mergeDeep } from "@rebasepro/utils";
import { isJunctionBackedRelation, resolveCollectionRelations } from "./collection_relations";
import { resolveRelation } from "./resolve_relation";

/**
 * The resolved relation a relation property refers to.
 *
 * Normalization stamps `resolvedRelation` onto the property, so this is usually
 * a field read. It falls back to resolving from the collection for properties
 * that never went through the registry — a preview, or a form rendered straight
 * from an authored config.
 */
export function resolveRelationProperty(
    property: RelationProperty,
    collection: CollectionConfig,
    propertyKey?: string
): ResolvedRelation {
    if (property.resolvedRelation) return property.resolvedRelation;

    if (property.relation) {
        return resolveRelation(property.relation, collection, propertyKey);
    }

    const name = propertyKey ?? "";
    const declared = resolveCollectionRelations(collection)[name];
    if (!declared) {
        throw Error(
            `Relation property '${name || "(unnamed)"}' on '${collection.slug}' declares no \`relation\`, ` +
            "and the collection has no relation of that name."
        );
    }
    return declared;
}


/**
 * The lists rendered inside an entity view of `collection` — its tabs.
 *
 * The single derivation. There used to be two that disagreed: this one, and a
 * copy in `CollectionRegistry.normalizeCollection` that stamped each child with
 * the *target collection's* slug instead of the relation key. Since the
 * registry ran first and cached its answer onto `childCollections`, its version
 * was the one that won, and the frontend addressed child listings by a segment
 * the backend could not resolve.
 *
 * Order of precedence:
 *   1. `childCollections` — the explicit escape hatch for custom drivers.
 *   2. `subcollections` on an engine that has real containment (Firestore).
 *   3. many-relations on an engine that has relations (SQL).
 */
export function getEntityChildViews<M extends Record<string, unknown> = Record<string, unknown>>(
    collection: CollectionConfig<M>
): EntityChildView[] {
    const asSubcollections = (collections: CollectionConfig<Record<string, unknown>>[]): EntityChildView[] =>
        collections.filter(Boolean).map(child => ({
            key: child.slug,
            collection: child,
            source: { kind: "subcollection" as const }
        }));

    if (collection.childCollections) {
        return asSubcollections(collection.childCollections() ?? []);
    }

    const capabilities = getDataSourceCapabilities(collection.engine);

    const declaredSubcollections = getDeclaredSubcollections(collection);
    if (capabilities.supportsSubcollections && declaredSubcollections) {
        return asSubcollections(declaredSubcollections() ?? []);
    }

    if (!capabilities.supportsRelations) return [];

    const resolvedRelations = resolveCollectionRelations(collection);
    const views: EntityChildView[] = [];
    const seen = new Set<string>();

    // Keyed by the map key, not by `relationName`: the map key is what
    // `findRelation` matches a path segment against, so it is the only one that
    // addresses the same relation on both sides of the wire. The map registers
    // some relations twice — once canonically, once under the declaring
    // property key — so dedupe on the underlying relation.
    for (const [relationKey, relation] of Object.entries(resolvedRelations)) {
        if (relation.cardinality !== "many") continue;

        const identity = relation.relationName ?? relationKey;
        if (seen.has(identity)) continue;

        let target: CollectionConfig | undefined;
        try {
            target = relation.target();
        } catch {
            continue;
        }
        if (!target) continue;
        seen.add(identity);

        // A name given to the declaring property is the author naming the tab.
        // Only the tab: it is a plural ("Tags"), and one row of it is still
        // what the target calls one ("Tag").
        const declaringProperty = Object.entries((collection.properties ?? {}) as Record<string, Property>)
            .find(([propKey, p]) => p.type === "relation" && ((p as RelationProperty).relation?.relationName ?? propKey) === identity);
        const customName = declaringProperty?.[1]?.name;

        const base: CollectionConfig<Record<string, unknown>> = {
            ...target,
            slug: relationKey,
            ...(customName ? { name: customName } : {})
        } as CollectionConfig<Record<string, unknown>>;

        views.push({
            key: relationKey,
            collection: (relation.overrides ? mergeDeep(base, relation.overrides) : base) as CollectionConfig<Record<string, unknown>>,
            source: {
                kind: "relation",
                relationKey,
                mode: isJunctionBackedRelation(relation) ? "linked" : "owned",
                targetSlug: target.slug
            }
        });
    }

    return views;
}

/**
 * The child views of `collection` as bare collections.
 *
 * The flattened view of {@link getEntityChildViews}, for navigation code that
 * only needs to match a path segment against a slug. Anything that cares *what
 * kind* of list it is showing — chiefly the admin, which must not offer a
 * global delete on a shared row — should read the views instead.
 */
export function getSubcollections<M extends Record<string, unknown> = Record<string, unknown>>(collection: CollectionConfig<M>): CollectionConfig<Record<string, unknown>>[] {
    return getEntityChildViews(collection).map(view => view.collection);
}
