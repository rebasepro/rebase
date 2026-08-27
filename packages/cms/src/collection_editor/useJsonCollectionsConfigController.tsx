import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineProperties, Property } from "@rebasepro/types";
import type { NavigationGroupMapping, AdminCollection } from "@rebasepro/cms-types";
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
import type { JsonCollectionStore, SerializableCollectionConfig } from "./serializable_types";
import { toSerializableCollectionConfig, toSerializableProperty, fromSerializableCollectionConfigs } from "./serializable_utils";

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
    const [collections, setCollections] = useState<AdminCollection[]>([]);
    const [loading, setLoading] = useState(autoLoad);
    const [navigationEntries, setNavigationEntries] = useState<NavigationGroupMapping[]>([]);

    // Keep store ref stable to avoid stale closures in callbacks
    const storeRef = useRef(store);
    storeRef.current = store;

    /**
     * The current collections, readable outside a state updater.
     *
     * Three mutators used to compute their new value inside
     * `setCollections(prev => …)` and persist from in there, which cost them
     * both halves of a save: the promise they returned resolved before the
     * store had answered, so a failed write reached the caller as a success,
     * and a `setState` updater must be pure — under `StrictMode` React invokes
     * it twice, so every one of those saves wrote to the store twice in
     * development. Reading `prev` from a ref lets them do what
     * `updatePropertiesOrder` already did: compute, set, then await.
     */
    const collectionsRef = useRef<AdminCollection[]>([]);
    const applyCollections = useCallback((next: AdminCollection[]) => {
        collectionsRef.current = next;
        setCollections(next);
    }, []);

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
                // Deserialized as a set: a relation's target is a slug, and a slug only
                // resolves against the other collections it arrived with.
                applyCollections(fromSerializableCollectionConfigs(serialized));
                setNavigationEntries(navEntries);
            } catch (e) {
                console.error("useJsonCollectionsConfigController: failed to load collections", e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
        // `applyCollections` is `useCallback(…, [])`, so naming it here cannot
        // re-run the mount effect — it is listed because a stable identity is a
        // fact about today's code, not a reason to leave a dependency out.
    }, [autoLoad, applyCollections]);

    // ── Helpers ────────────────────────────────────────────────────────

    /**
     * Update local state and persist a collection to the store.
     */
    const persistCollection = useCallback(async (collection: AdminCollection) => {
        const serializable = toSerializableCollectionConfig(collection);
        await storeRef.current.save(collection.slug, serializable);
    }, []);

    /**
     * Find collection by id (slug).
     */
    const getCollection = useCallback((id: string): AdminCollection => {
        const found = collections.find(c => c.slug === id);
        if (found) return found;
        throw new Error(`Collection "${id}" not found`);
    }, [collections]);

    // ── CRUD operations ───────────────────────────────────────────────

    const saveCollection = useCallback(async <M extends Record<string, unknown>>(
        { id, collectionData }: SaveCollectionParams<M>
    ) => {
        const collection = collectionData as AdminCollection;
        await persistCollection(collection);
        const prev = collectionsRef.current;
        const idx = prev.findIndex(c => c.slug === id);
        if (idx >= 0) {
            const next = [...prev];
            next[idx] = collection;
            applyCollections(next);
        } else {
            applyCollections([...prev, collection]);
        }
    }, [persistCollection, applyCollections]);

    const updateCollection = useCallback(async <M extends Record<string, unknown>>(
        { id, collectionData, previousId }: UpdateCollectionParams<M>
    ) => {
        const prev = collectionsRef.current;
        const lookupId = previousId ?? id;
        const idx = prev.findIndex(c => c.slug === lookupId);
        if (idx < 0) return;

        const merged = { ...prev[idx], ...collectionData } as AdminCollection;
        const next = [...prev];
        next[idx] = merged;
        applyCollections(next);

        await persistCollection(merged);

        // If the slug changed, clean up the old entry in the store. After the
        // save, not beside it: dropping the old key first and then failing to
        // write the new one loses the collection outright.
        if (previousId && previousId !== id) {
            await storeRef.current.delete(previousId);
        }
    }, [persistCollection, applyCollections]);

    const deleteCollection = useCallback(async ({ id }: DeleteCollectionParams) => {
        await storeRef.current.delete(id);
        applyCollections(collectionsRef.current.filter(c => c.slug !== id));
    }, [applyCollections]);

    const saveProperty = useCallback(async ({
        path,
        propertyKey,
        property,
        newPropertiesOrder,
    }: SavePropertyParams) => {
        const prev = collectionsRef.current;
        const idx = prev.findIndex(c => c.slug === path);
        if (idx < 0) return;

        const collection = { ...prev[idx] };
        collection.properties = {
            ...collection.properties,
            [propertyKey]: property,
        } as EngineProperties;
        if (newPropertiesOrder) {
            collection.propertiesOrder = newPropertiesOrder as typeof collection.propertiesOrder;
        }

        const next = [...prev];
        next[idx] = collection as AdminCollection;
        applyCollections(next);

        await persistCollection(next[idx]);
    }, [persistCollection, applyCollections]);

    const deleteProperty = useCallback(async ({
        path,
        propertyKey,
        newPropertiesOrder,
    }: DeletePropertyParams) => {
        const prev = collectionsRef.current;
        const idx = prev.findIndex(c => c.slug === path);
        if (idx < 0) return;

        const collection = { ...prev[idx] };
        const { [propertyKey]: _removed, ...remaining } = collection.properties;
        collection.properties = remaining;
        if (newPropertiesOrder) {
            collection.propertiesOrder = newPropertiesOrder as typeof collection.propertiesOrder;
        }

        const next = [...prev];
        next[idx] = collection as AdminCollection;
        applyCollections(next);

        await persistCollection(next[idx]);
    }, [persistCollection, applyCollections]);

    const updatePropertiesOrder = useCallback(async ({
        collection,
        newPropertiesOrder,
    }: UpdatePropertiesOrderParams) => {
        const updated = {
            ...collection,
            propertiesOrder: newPropertiesOrder,
        } as AdminCollection;

        const prev = collectionsRef.current;
        const idx = prev.findIndex(c => c.slug === collection.slug);
        if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            applyCollections(next);
        }

        await persistCollection(updated);
    }, [persistCollection, applyCollections]);

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
