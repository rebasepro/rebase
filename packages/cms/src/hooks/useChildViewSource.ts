import { useMemo } from "react";
import type { ChildViewSource } from "@rebasepro/types";
import { getEntityChildViews } from "@rebasepro/common";

import { useCollectionRegistryController } from "./navigation/contexts/CollectionRegistryContext";

/**
 * What kind of list a path addresses: a root collection, a contained
 * subcollection, or a relation — and if a relation, whether the rows are owned
 * by the parent or shared through a junction.
 *
 * Derived from the path rather than passed down, because the same question is
 * asked from places a prop does not reach: the collection view's row actions,
 * the entity form's own delete button, a deep link straight into a tab. All
 * three have the path; only one of them was ever handed a descriptor.
 *
 * Returns `undefined` for a root collection path, and for any path whose parent
 * or relation cannot be resolved — callers should read that as "an ordinary
 * collection", which is the pre-existing behaviour.
 */
export function useChildViewSource(path: string | undefined): ChildViewSource | undefined {
    const collectionRegistry = useCollectionRegistryController();

    return useMemo(() => {
        if (!path) return undefined;

        const segments = path.split("/").filter(s => s && s !== "undefined");
        // `parent/id/child` is the shortest addressable child list.
        if (segments.length < 3) return undefined;

        const childKey = segments[segments.length - 1];
        // Drop the child segment and the parent's id: what remains addresses the
        // collection the child hangs off, however deeply nested it is.
        const parentPath = segments.slice(0, -2).join("/");

        let parentCollection;
        try {
            parentCollection = collectionRegistry.getCollection(parentPath);
        } catch {
            return undefined;
        }
        if (!parentCollection) return undefined;

        return getEntityChildViews(parentCollection).find(view => view.key === childKey)?.source;
    }, [path, collectionRegistry]);
}
