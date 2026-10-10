import React from "react";
import type { StorageSource, StorageSourceDefinition, StorageSourceRegistry } from "@rebasepro/types";

/**
 * The storage-source configuration provided to `<Rebase>`: the declared
 * definitions and the built {@link StorageSource} instances, wrapped in a
 * {@link StorageSourceRegistry} for fast key-based lookup.
 *
 * Mirrors the {@link DataSourcesContext} pattern used for databases.
 *
 * @internal
 */
export interface StorageSourcesContextValue {
    /** All declared storage sources, keyed by storage-source key. */
    registry: Record<string, StorageSourceDefinition>;
    /** Built {@link StorageSource} for direct sources, keyed by key. */
    sources: Record<string, StorageSource>;
    /**
     * A server-routed source for a key not (yet) in `sources` — requests carry
     * `?storageId=<key>`, so the server serves it or refuses naming it, rather
     * than the panel guessing the default. Absent without a client.
     */
    createSource?: (key: string) => StorageSource;
}

const EMPTY: StorageSourcesContextValue = { registry: {}, sources: {} };

/** @internal */
export const StorageSourcesContext = React.createContext<StorageSourcesContextValue>(EMPTY);

/**
 * Access the storage-source configuration provided to `<Rebase>` via the
 * `storageSources` prop.
 * @internal
 */
export const useStorageSources = (): StorageSourcesContextValue => React.useContext(StorageSourcesContext);
