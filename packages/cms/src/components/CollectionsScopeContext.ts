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
 * Whether a scope's top-level collections include the one at `path` — asked
 * quietly, unlike a registry lookup, which warns about a path it cannot place.
 *
 * @internal
 */
export function isRegistered(collections: AdminCollection[] | undefined, path: string): boolean {
    return collections?.some(collection => collection.slug === path) ?? false;
}
