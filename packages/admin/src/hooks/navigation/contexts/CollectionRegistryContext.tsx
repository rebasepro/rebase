import type { CollectionConfig } from "@rebasepro/types";
import React, { createContext } from "react";
import { CollectionRegistryController } from "@rebasepro/types";

export const CollectionRegistryContext = createContext<CollectionRegistryController>({
    getCollection: () => undefined,
    getRawCollection: () => undefined,
    getParentReferencesFromPath: () => [],
    getParentCollectionSlugs: () => [],
    getParentSnapshotIds: () => [],
    convertIdsToPaths: () => [],
    initialised: false
});

export function useCollectionRegistryController<DB = Record<string, unknown>, EC extends CollectionConfig = CollectionConfig>(): CollectionRegistryController<DB, EC> {
    const context = React.useContext(CollectionRegistryContext);
    if (context === undefined) {
        throw new Error("useCollectionRegistryController must be used within a CollectionRegistryContext.Provider");
    }
    return context as CollectionRegistryController<DB, EC>;
}
