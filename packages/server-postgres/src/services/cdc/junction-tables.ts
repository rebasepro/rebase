import { CollectionConfig, ResolvedRelation, isManyToMany } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";

import { PostgresCollectionRegistry } from "../../collections/PostgresCollectionRegistry";

/**
 * One end of a many-to-many, as seen from the junction table.
 *
 * A junction table is not a collection, so nothing in the registry maps it to
 * one — which is why a change to it was invisible to change capture. But its
 * rows are exactly the contents of a parent's child list, so a write to it is a
 * change to `<parentSlug>/<sourceId>/<relationKey>` and to nothing else.
 */
export interface JunctionLink {
    schema: string;
    /** The junction table itself, e.g. `posts_tags`. */
    table: string;
    /** The collection whose relation this is, e.g. `posts`. */
    parentCollection: CollectionConfig;
    /** The relation's key — the path segment a child list is addressed by. */
    relationKey: string;
    /** Junction column holding the parent's id. */
    sourceColumn: string;
    /** Junction column holding the target's id. */
    targetColumn: string;
}

/**
 * Every junction table reachable from a registered collection, once per
 * relation that uses it.
 *
 * A junction is listed once per *direction* when both sides declare it, because
 * each direction addresses a different child list: `posts/1/tags` and
 * `tags/t/posts` both change when one link is written.
 */
export function collectJunctionLinks(registry: PostgresCollectionRegistry): JunctionLink[] {
    const links: JunctionLink[] = [];
    const seen = new Set<string>();

    for (const collection of registry.getCollections()) {
        let relations: Record<string, ResolvedRelation>;
        try {
            relations = resolveCollectionRelations(collection);
        } catch {
            // A collection whose relations cannot be resolved (an unresolvable
            // target, typically mid-migration) simply contributes none.
            continue;
        }

        for (const [relationKey, relation] of Object.entries(relations)) {
            if (!isManyToMany(relation)) continue;
            const through = relation.through;

            // Same relation registered under both its canonical name and the
            // declaring property key would otherwise notify the same path twice.
            const key = `${collection.slug}::${relationKey}::${through.table}`;
            if (seen.has(key)) continue;
            seen.add(key);

            links.push({
                schema: (collection as { schema?: string }).schema ?? "public",
                table: through.table,
                parentCollection: collection,
                relationKey,
                sourceColumn: through.sourceColumn,
                targetColumn: through.targetColumn
            });
        }
    }

    return links;
}

/**
 * Index {@link collectJunctionLinks} by table, under both the qualified and the
 * bare name — a change event carries whatever the trigger reports, and a
 * collection need not declare a schema.
 */
export function buildJunctionLinkMap(registry: PostgresCollectionRegistry): Map<string, JunctionLink[]> {
    const map = new Map<string, JunctionLink[]>();

    for (const link of collectJunctionLinks(registry)) {
        for (const key of [`${link.schema}.${link.table}`, link.table]) {
            const existing = map.get(key);
            if (existing) existing.push(link);
            else map.set(key, [link]);
        }
    }

    return map;
}
