import { relationsOfKind } from "@rebasepro/common";

import { PostgresTableRegistry } from "../../model/PostgresTableRegistry";

/**
 * One end of a many-to-many, as seen from the junction table.
 *
 * A junction table is not a table anybody declared, so nothing in the registry
 * maps it to one — which is why a change to it was invisible to change
 * capture. But its rows are exactly the contents of a parent's child list, so
 * a write to it is a change to `<parentSlug>/<sourceId>/<relationKey>` and to
 * nothing else.
 */
export interface JunctionLink {
    schema: string;
    /** The junction table itself, e.g. `posts_tags`. */
    table: string;
    /** The slug of the table whose relation this is, e.g. `posts`. */
    parentSlug: string;
    /** The relation's name — the path segment a child list is addressed by. */
    relationKey: string;
    /** Junction column holding the parent's id. */
    sourceColumn: string;
    /** Junction column holding the target's id. */
    targetColumn: string;
}

/**
 * Every junction table reachable from a served table, once per `manyToMany`
 * that uses it — read from each table's relation descriptors.
 *
 * A junction is listed once per *direction* when both sides declare it, because
 * each direction addresses a different child list: `posts/1/tags` and
 * `tags/t/posts` both change when one link is written.
 */
export function collectJunctionLinks(registry: PostgresTableRegistry): JunctionLink[] {
    const links: JunctionLink[] = [];

    for (const table of registry.tables()) {
        for (const relation of relationsOfKind(table.descriptor, "manyToMany")) {
            const { through } = relation;
            links.push({
                schema: table.descriptor.schema,
                table: through.table,
                parentSlug: table.slug,
                relationKey: relation.name,
                sourceColumn: through.sourceKey,
                targetColumn: through.targetKey
            });
        }
    }

    return links;
}

/**
 * Index {@link collectJunctionLinks} by table, under both the qualified and the
 * bare name — a change event carries whatever the trigger reports, and a
 * table need not declare a schema.
 */
export function buildJunctionLinkMap(registry: PostgresTableRegistry): Map<string, JunctionLink[]> {
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
