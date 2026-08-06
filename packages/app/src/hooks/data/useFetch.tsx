
import { useEffect, useState, useMemo } from "react";
import { Entity, User } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/admin-types";
import { useData } from "./useData";
import { useRebaseContext } from "../useRebaseContext";

/**
 * @group Hooks and utilities
 */
export interface FetchProps<M extends Record<string, any>, USER extends User = User> {
    path: string;
    entityId?: string | number;
    databaseId?: string;
    collection: AdminCollection<M, USER>;
    useCache?: boolean;
}

/**
 * @group Hooks and utilities
 */
export interface FetchResult<M extends Record<string, any>> {
    entity?: Entity<M>,
    dataLoading: boolean,
    dataLoadingError?: Error
}

const CACHE: Record<string, Entity<any> | undefined> = {};

/**
 * Pre-populate the entity fetch cache with entities loaded from a collection.
 * This allows entity detail views to render instantly using cached data,
 * while the background fetch/listener brings in fresh data.
 * @param path - The collection path (e.g. "products")
 * @param entities - Array of entities to cache
 */
export function populateFetchCache<M extends Record<string, any>>(path: string, entities: Entity<M>[]): void {
    for (const entity of entities) {
        CACHE[`${path}/${entity.id}`] = entity;
    }
}

/**
 * Clear the entity fetch cache. Call this on auth state changes (e.g. logout)
 * to prevent stale data from a previous session leaking into the next.
 */
export function clearFetchCache(): void {
    for (const key of Object.keys(CACHE)) {
        delete CACHE[key];
    }
}

/**
 * This hook is used to fetch a entity.
 * It gives real time updates if the driver supports it.
 * @param path
 * @param collection
 * @param entityId
 * @param useCache
 * @group Hooks and utilities
 */

export function useFetch<M extends Record<string, any>, USER extends User = User>(
    {
        path,
        entityId,
        collection,
        databaseId,
        useCache = false
    }: FetchProps<M, USER>): FetchResult<M> {

    const dataClient = useData();

    const context: RebaseContext<USER> = useRebaseContext();

    // Seed initial state from the cache to avoid skeleton flashes.
    // Even when useCache is false, we show cached data instantly while
    // the background fetch/listener brings in fresh data.
    const cacheKey = entityId ? `${path}/${entityId}` : undefined;
    const cachedEntity = cacheKey ? CACHE[cacheKey] as Entity<M> | undefined : undefined;

    const [entity, setEntity] = useState<Entity<M> | undefined>(cachedEntity);
    const [dataLoading, setDataLoading] = useState<boolean>(!cachedEntity);
    const [dataLoadingError, setDataLoadingError] = useState<Error | undefined>();

    useEffect(() => {

        // Only show loading state if we have no cached entity to display
        if (!CACHE[`${path}/${entityId}`]) {
            setDataLoading(true);
        }

        const onEntityUpdate = async (updatedEntity?: Entity<M> | null) => {
            CACHE[`${path}/${entityId}`] = updatedEntity ?? undefined;
            setEntity(updatedEntity ?? undefined);
            setDataLoading(false);
            setDataLoadingError(undefined);
        };

        const onError = (error: Error) => {
            console.error("ERROR fetching entity", error);
            setDataLoading(false);
            setEntity(undefined);
            setDataLoadingError(error);
        };

        if (entityId && useCache && CACHE[`${path}/${entityId}`]) {
            setEntity(CACHE[`${path}/${entityId}`]);
            setDataLoading(false);
            setDataLoadingError(undefined);
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            return () => {
            };
        } else if (entityId && path && collection) {
            const accessor = dataClient.collection(path);

            if (accessor.listenById) {
                return accessor.listenById(entityId, (entity) => onEntityUpdate(entity as Entity<M> | undefined), onError);
            } else {
                // The one-shot fallback, taken whenever the client has no
                // socket. `listenById` above cancels on cleanup; a promise
                // cannot, so the cleanup disowns its result instead. `entityId`
                // is an effect dependency, and where this hook's caller is not
                // remounted per record — the side panel replaces its contents
                // in place — a slow response for the record just left would
                // otherwise land on top of the one now showing.
                let cancelled = false;
                accessor.findById(entityId)
                    .then((entity) => {
                        if (cancelled) return;
                        onEntityUpdate(entity as Entity<M> | undefined);
                    })
                    .catch((e) => {
                        if (cancelled) return;
                        onError(e);
                    });
                return () => {
                    cancelled = true;
                };
            }
        }
        // if no entityId is provided we do nothing
        else {
            onEntityUpdate(undefined);
            return () => {
            };
        }
    }, [entityId, path, dataClient, collection, useCache, databaseId]);

    return useMemo(() => ({
        entity,
        dataLoading,
        dataLoadingError
    }), [entity, dataLoading, dataLoadingError]);

}
