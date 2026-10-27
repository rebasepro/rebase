import { createContext } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Whether a collections scope — the registry, URL controller, navigation state
 * and record panels — is mounted above: `<RebaseNavigation>` (the full CMS) or
 * a `<CollectionsProvider>`. The components that can stand on their own
 * (`CollectionPanel`, `EntityFormPanel`) read it to decide whether to bring
 * their own.
 *
 * @internal
 */
export const CollectionsScopeContext = createContext<boolean>(false);

/**
 * Whether a scope's top-level collections hold the one at `path` — asked
 * quietly, unlike a registry lookup, which warns about a path it cannot place.
 *
 * A subcollection's path (`posts/p1/comments`) is held by the scope that holds
 * its root, so the path's leading segments are matched, longest run first,
 * since a slug may itself contain slashes (`content/de-DE/podcasts`).
 *
 * @internal
 */
export function isRegistered(collections: AdminCollection[] | undefined, path: string): boolean {
    if (!collections?.length) return false;
    const slugs = new Set(collections.map(collection => collection.slug));
    const segments = path.split("/").filter(Boolean);
    for (let length = segments.length; length > 0; length--) {
        if (slugs.has(segments.slice(0, length).join("/"))) return true;
    }
    return false;
}
