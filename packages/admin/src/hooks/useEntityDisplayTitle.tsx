import type { AdminCollection } from "@rebasepro/admin-types";
import type { EntityStatus } from "@rebasepro/types";
import { getValueInPath } from "@rebasepro/utils";
import { getEntityTitlePropertyKeyForEntity, isUserSelectProperty, resolveTitleToString } from "../util/previews";
import { getUserLabel, useResolvedUser } from "./useResolvedUsers";

export interface UseEntityDisplayTitleParams<M extends Record<string, unknown>> {
    collection: AdminCollection<M>;
    values?: Record<string, unknown>;
    entityId?: string | number;
    status: EntityStatus;
}

/**
 * The human name for a record, for the identity bar and the breadcrumb.
 *
 * The guard on `status` is the point. The title resolver walks candidate
 * properties and returns the first non-empty one, and on a brand new entity the
 * only populated values are the property defaults — so creating a blog post
 * opened a page headed **draft**, the default of its `status` enum. A record
 * that does not exist yet has no name; it has an intent.
 */
export function useEntityDisplayTitle<M extends Record<string, unknown>>({
    collection,
    values,
    entityId,
    status
}: UseEntityDisplayTitleParams<M>): string {

    const isNew = status === "new";

    const titlePropertyKey = getEntityTitlePropertyKeyForEntity(collection, values, entityId);
    const rawTitle = !isNew && values && titlePropertyKey
        ? getValueInPath(values, titlePropertyKey)
        : undefined;

    // A user picker stores an id: resolve it to the person, like a relation.
    const titleUser = useResolvedUser(
        isUserSelectProperty(collection, titlePropertyKey) && typeof rawTitle === "string"
            ? rawTitle
            : undefined
    );

    const singular = collection.singularName ?? collection.name;

    if (isNew) {
        return `New ${singular.toLowerCase()}`;
    }

    if (titleUser) {
        return getUserLabel(titleUser);
    }

    if (rawTitle !== undefined && rawTitle !== null) {
        const resolved = resolveTitleToString(rawTitle);
        if (resolved) return resolved;
    }

    return singular;
}
