import React, { createContext, useContext } from "react";

import { CollectionComponentOverrideProvider } from "./ComponentOverrideContext";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Carries the collection a UI subtree is currently bound to.
 *
 * Mounted by every collection binding (main collection views, entity
 * edit/detail views, side panels, reference-selection dialogs, import
 * previews) via {@link CollectionScopeProvider}. Leaf components read it with
 * {@link useCollectionScope} to derive collection-dependent behavior — e.g.
 * filter fields resolve the engine's supported operators from
 * `collection.engine` — without every intermediate component threading
 * collection props.
 *
 * @internal
 */
export const CollectionScopeContext = createContext<AdminCollection | undefined>(undefined);

/**
 * Read the collection the current subtree is bound to, or `undefined` when
 * rendered outside any collection scope (e.g. a fully standalone table).
 *
 * @group Hooks
 */
export function useCollectionScope(): AdminCollection | undefined {
    return useContext(CollectionScopeContext);
}

/**
 * Scopes a UI subtree to a collection.
 *
 * Provides two things at once:
 * 1. The collection itself — readable via {@link useCollectionScope} —
 *    so leaf components (filter fields, previews, …) can derive
 *    collection-dependent behavior such as engine capabilities.
 * 2. The collection's component overrides (`collection.components`),
 *    by mounting {@link CollectionComponentOverrideProvider}.
 *
 * Mount this wherever a subtree is bound to a specific collection. If you
 * build a custom view around `SelectableTable` / `CollectionTableBinding`,
 * wrap it in this provider to get engine-aware filters and collection-scoped
 * component overrides for free:
 *
 * ```tsx
 * <CollectionScopeProvider collection={myCollection}>
 *     <CollectionTableBinding ... />
 * </CollectionScopeProvider>
 * ```
 *
 * @group Components
 */
export function CollectionScopeProvider({
    collection,
    children
}: {
    collection: AdminCollection<any> | undefined;
    children: React.ReactNode;
}) {
    return (
        <CollectionScopeContext.Provider value={collection as AdminCollection | undefined}>
            <CollectionComponentOverrideProvider overrides={collection?.components}>
                {children}
            </CollectionComponentOverrideProvider>
        </CollectionScopeContext.Provider>
    );
}
