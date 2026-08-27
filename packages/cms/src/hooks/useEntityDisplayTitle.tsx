import type { AdminCollection } from "@rebasepro/cms-types";
import type { Entity, EntityStatus } from "@rebasepro/types";
import { useEntityTitle } from "./useEntityDisplay";

export interface UseEntityDisplayTitleParams<M extends Record<string, unknown>> {
    collection: AdminCollection<M>;
    /** The record. Needed for a computed title; see {@link useEntityTitle}. */
    entity?: Entity<M>;
    /** Live form values, when they are ahead of the entity. */
    values?: Record<string, unknown>;
    status: EntityStatus;
}

/**
 * The heading for a record: the identity bar and the breadcrumb.
 *
 * Everything about *what a record is called* lives in {@link useEntityTitle}.
 * What is left here is the heading's own two rules, which are presentation, not
 * identity:
 *
 * The guard on `status` is the first. The title resolver returns the first
 * candidate carrying a value, and on a brand new entity the only values are the
 * property defaults — so creating a blog post opened a page headed **draft**,
 * the default of its `status` enum. A record that does not exist yet has no
 * name; it has an intent.
 *
 * The fallback is the second. A page needs a heading even when the record has
 * nothing readable in it, and the honest one is what kind of thing it is.
 */
export function useEntityDisplayTitle<M extends Record<string, unknown>>({
    collection,
    entity,
    values,
    status
}: UseEntityDisplayTitleParams<M>): string {

    const isNew = status === "new";
    const singular = collection.singularName ?? collection.name;

    const { value: title } = useEntityTitle<M>({
        collection,
        entity,
        values,
        enabled: !isNew
    });

    if (isNew) return `New ${singular.toLowerCase()}`;
    return title ?? singular;
}
