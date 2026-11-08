import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A panel's `collection` and `path`, as the panel works with them: the
 * collection as a value, or none where it is named, and where it lives.
 *
 * `collection="orders"` names a registered collection, as `path="orders"`
 * does; `path` wins where both are given, so a subcollection's record can be
 * named by its collection and addressed by its full path.
 */
export function collectionPropOf<C extends AdminCollection<any>>(
    collection: C | string | undefined,
    path: string | undefined
): { collection: C | undefined; path: string } {
    if (typeof collection === "string") return { collection: undefined, path: path ?? collection };
    return { collection, path: path ?? collection?.slug ?? "" };
}

/** A record panel's props once its `collection` is a value or absent, and its `path` known. */
export type ScopedRecordPanelProps<O, M extends Record<string, unknown>> = O & { collection?: AdminCollection<M>; path: string };
