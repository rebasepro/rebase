import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntityCollection, NavigationGroupMapping, Property } from "@rebasepro/types";
import type {
    CollectionsConfigController,
    SaveCollectionParams,
    UpdateCollectionParams,
    DeleteCollectionParams,
    SavePropertyParams,
    DeletePropertyParams,
    UpdatePropertiesOrderParams,
    UpdateKanbanColumnsOrderParams,
} from "./types/config_controller";
import type { JsonCollectionStore, SerializableCollection } from "./serializable_types";
import { toSerializableCollection, toSerializableProperty, fromSerializableCollection } from "./serializable_utils";

export interface UseJsonCollectionsConfigControllerOptions {
    /**
     * The store adapter for persisting/loading collections.
     */
    store: JsonCollectionStore;

    /**
     * If true, the configuration cannot be modified.
     */
    readOnly?: boolean;

    /**
     * If true, collections will be loaded from the store on mount.
     * Defaults to true.
     */
    autoLoad?: boolean;
}

/**
 * A `CollectionsConfigController` implementation that persists collection
 * configurations as JSON via a pluggable `JsonCollectionStore` adapter.
 *
 * Use this when you want to store collection schemas in a database, API,
 * localStorage, or any other JSON-compatible backend — as opposed to the
 * default code-based persistence.
 *
 * @example
 * ```tsx
 * const store: JsonCollectionStore = {
 *     load: async () => { const res = await fetch('/api/schemas'); return res.json(); },
 *     save: async (slug, data) => { await fetch(`/api/schemas/${slug}`, { method: 'PUT', body: JSON.stringify(data) }); },
 *     delete: async (slug) => { await fetch(`/api/schemas/${slug}`, { method: 'DELETE' }); },
 * };
 *
 * const configController = useJsonCollectionsConfigController({ store });
 * ```
 */
export function useJsonCollectionsConfigController({
    store,
    readOnly = false,
    autoLoad = true,
}: UseJsonCollectionsConfigControllerOptions): CollectionsConfigController {
    const [collections, setCollections] = useState<EntityCollection[]>([]);
    const [loading, setLoading] = useState(autoLoad);
    const [navigationEntries, setNavigationEntries] = useState<NavigationGroupMapping[]>([]);

    // Keep store ref stable to avoid stale closures in callbacks
    const storeRef = useRef(store);
    storeRef.current = store;

    // ── Load on mount ─────────────────────────────────────────────────
    useEffect(() => {
        if (!autoLoad) return;
        let cancelled = false;

        (async () => {
            try {
                const [serialized, navEntries] = await Promise.all([
                    storeRef.current.load(),
                    storeRef.current.loadNavigationEntries?.() ?? Promise.resolve([]),
                ]);
                if (cancelled) return;
                setCollections(serialized.map(fromSerializableCollection));
                setNavigationEntries(navEntries);
            } catch (e) {
                console.error("useJsonCollectionsConfigController: failed to load collections", e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [autoLoad]);

    // ── Helpers ────────────────────────────────────────────────────────

    /**
     * Update local state and persist a collection to the store.
     */
    const persistCollection = useCallback(async (collection: EntityCollection) => {
        const serializable = toSerializableCollection(collection);
        await storeRef.current.save(collection.slug, serializable);
    }, []);

    /**
     * Find collection by id (slug).
     */
    const getCollection = useCallback((id: string): EntityCollection => {
        const found = collections.find(c => c.slug === id);
        if (found) return found;
        throw new Error(`Collection "${id}" not found`);
    }, [collections]);

    // ── CRUD operations ───────────────────────────────────────────────

    const saveCollection = useCallback(async <M extends Record<string, unknown>>(
        { id, collectionData }: SaveCollectionParams<M>
    ) => {
        const collection = collectionData as EntityCollection;
        await persistCollection(collection);
        setCollections(prev => {
            const idx = prev.findIndex(c => c.slug === id);
            if (idx >= 0) {
                const next = [...prev];
                next[idx] = collection;
                return next;
            }
            return [...prev, collection];
        });
    }, [persistCollection]);

    const updateCollection = useCallback(async <M extends Record<string, unknown>>(
        { id, collectionData, previousId }: UpdateCollectionParams<M>
    ) => {
        setCollections(prev => {
            const lookupId = previousId ?? id;
            const idx = prev.findIndex(c => c.slug === lookupId);
            if (idx < 0) return prev;

            const merged = { ...prev[idx], ...collectionData } as EntityCollection;
            const next = [...prev];
            next[idx] = merged;

            // Persist async — fire-and-forget with error logging
            persistCollection(merged).catch(e =>
                console.error("useJsonCollectionsConfigController: failed to update collection", e)
            );

            // If slug changed, clean up the old entry in the store
            if (previousId && previousId !== id) {
                storeRef.current.delete(previousId).catch(e =>
                    console.error("useJsonCollectionsConfigController: failed to delete old slug", e)
                );
            }

            return next;
        });
    }, [persistCollection]);

    const deleteCollection = useCallback(async ({ id }: DeleteCollectionParams) => {
        await storeRef.current.delete(id);
        setCollections(prev => prev.filter(c => c.slug !== id));
    }, []);

    const saveProperty = useCallback(async ({
        path,
        propertyKey,
        property,
        newPropertiesOrder,
    }: SavePropertyParams) => {
        setCollections(prev => {
            const idx = prev.findIndex(c => c.slug === path);
            if (idx < 0) return prev;

            const collection = { ...prev[idx] };
            collection.properties = {
                ...collection.properties,
                [propertyKey]: property,
            };
            if (newPropertiesOrder) {
                collection.propertiesOrder = newPropertiesOrder as typeof collection.propertiesOrder;
            }

            const next = [...prev];
            next[idx] = collection as EntityCollection;

            persistCollection(next[idx]).catch(e =>
                console.error("useJsonCollectionsConfigController: failed to save property", e)
            );

            return next;
        });
    }, [persistCollection]);

    const deleteProperty = useCallback(async ({
        path,
        propertyKey,
        newPropertiesOrder,
    }: DeletePropertyParams) => {
        setCollections(prev => {
            const idx = prev.findIndex(c => c.slug === path);
            if (idx < 0) return prev;

            const collection = { ...prev[idx] };
            const { [propertyKey]: _removed, ...remaining } = collection.properties;
            collection.properties = remaining;
            if (newPropertiesOrder) {
                collection.propertiesOrder = newPropertiesOrder as typeof collection.propertiesOrder;
            }

            const next = [...prev];
            next[idx] = collection as EntityCollection;

            persistCollection(next[idx]).catch(e =>
                console.error("useJsonCollectionsConfigController: failed to delete property", e)
            );

            return next;
        });
    }, [persistCollection]);

    const updatePropertiesOrder = useCallback(async ({
        collection,
        newPropertiesOrder,
    }: UpdatePropertiesOrderParams) => {
        const updated = {
            ...collection,
            propertiesOrder: newPropertiesOrder,
        } as EntityCollection;

        setCollections(prev => {
            const idx = prev.findIndex(c => c.slug === collection.slug);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = updated;
            return next;
        });

        await persistCollection(updated);
    }, [persistCollection]);

    const updateKanbanColumnsOrder = useCallback(async ({
        collection,
        kanbanColumnProperty,
        newColumnsOrder,
    }: UpdateKanbanColumnsOrderParams) => {
        // Kanban column order is stored in the enum order of the column property.
        // For JSON persistence, we store it as-is — the view layer reads enum order.
        // This is a no-op for now; the kanban order is determined by the enum
        // definition on the property itself.
    }, []);

    const saveNavigationEntriesHandler = useCallback(async (entries: NavigationGroupMapping[]) => {
        setNavigationEntries(entries);
        if (storeRef.current.saveNavigationEntries) {
            await storeRef.current.saveNavigationEntries(entries);
        }
    }, []);

    // ── Return controller ─────────────────────────────────────────────
    return useMemo<CollectionsConfigController>(() => ({
        loading,
        readOnly,
        readOnlyReason: readOnly ? "Configuration is read-only." : undefined,
        collections,
        getCollection,
        saveCollection,
        updateCollection,
        deleteCollection,
        saveProperty,
        deleteProperty,
        updatePropertiesOrder,
        updateKanbanColumnsOrder,
        navigationEntries,
        saveNavigationEntries: saveNavigationEntriesHandler,
    }), [
        loading,
        readOnly,
        collections,
        getCollection,
        saveCollection,
        updateCollection,
        deleteCollection,
        saveProperty,
        deleteProperty,
        updatePropertiesOrder,
        updateKanbanColumnsOrder,
        navigationEntries,
        saveNavigationEntriesHandler,
    ]);
}
