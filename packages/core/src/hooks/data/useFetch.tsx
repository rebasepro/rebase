import type { CollectionConfig } from "@rebasepro/types";
import { useEffect, useState, useMemo } from "react";
import { Snapshot, RebaseContext, User } from "@rebasepro/types";
import { useData } from "./useData";
import { useRebaseContext } from "../useRebaseContext";

/**
 * @group Hooks and utilities
 */
export interface FetchProps<M extends Record<string, any>, USER extends User = User> {
    path: string;
    snapshotId?: string | number;
    databaseId?: string;
    collection: CollectionConfig<M, USER>;
    useCache?: boolean;
}

/**
 * @group Hooks and utilities
 */
export interface FetchResult<M extends Record<string, any>> {
    snapshot?: Snapshot<M>,
    dataLoading: boolean,
    dataLoadingError?: Error
}

const CACHE: Record<string, Snapshot<any> | undefined> = {};

/**
 * Pre-populate the snapshot fetch cache with snapshots loaded from a collection.
 * This allows snapshot detail views to render instantly using cached data,
 * while the background fetch/listener brings in fresh data.
 * @param path - The collection path (e.g. "products")
 * @param snapshots - Array of snapshots to cache
 */
export function populateFetchCache<M extends Record<string, any>>(path: string, snapshots: Snapshot<M>[]): void {
    for (const snapshot of snapshots) {
        CACHE[`${path}/${snapshot.id}`] = snapshot;
    }
}

/**
 * Clear the snapshot fetch cache. Call this on auth state changes (e.g. logout)
 * to prevent stale data from a previous session leaking into the next.
 */
export function clearFetchCache(): void {
    for (const key of Object.keys(CACHE)) {
        delete CACHE[key];
    }
}

/**
 * This hook is used to fetch a snapshot.
 * It gives real time updates if the driver supports it.
 * @param path
 * @param collection
 * @param snapshotId
 * @param useCache
 * @group Hooks and utilities
 */

export function useFetch<M extends Record<string, any>, USER extends User = User>(
    {
        path,
        snapshotId,
        collection,
        databaseId,
        useCache = false
    }: FetchProps<M, USER>): FetchResult<M> {

    const dataClient = useData();

    const context: RebaseContext<USER> = useRebaseContext();

    // Seed initial state from the cache to avoid skeleton flashes.
    // Even when useCache is false, we show cached data instantly while
    // the background fetch/listener brings in fresh data.
    const cacheKey = snapshotId ? `${path}/${snapshotId}` : undefined;
    const cachedSnapshot = cacheKey ? CACHE[cacheKey] as Snapshot<M> | undefined : undefined;

    const [snapshot, setSnapshot] = useState<Snapshot<M> | undefined>(cachedSnapshot);
    const [dataLoading, setDataLoading] = useState<boolean>(!cachedSnapshot);
    const [dataLoadingError, setDataLoadingError] = useState<Error | undefined>();

    useEffect(() => {

        // Only show loading state if we have no cached snapshot to display
        if (!CACHE[`${path}/${snapshotId}`]) {
            setDataLoading(true);
        }

        const onSnapshotUpdate = async (updatedSnapshot?: Snapshot<M> | null) => {
            CACHE[`${path}/${snapshotId}`] = updatedSnapshot ?? undefined;
            setSnapshot(updatedSnapshot ?? undefined);
            setDataLoading(false);
            setDataLoadingError(undefined);
        };

        const onError = (error: Error) => {
            console.error("ERROR fetching snapshot", error);
            setDataLoading(false);
            setSnapshot(undefined);
            setDataLoadingError(error);
        };

        if (snapshotId && useCache && CACHE[`${path}/${snapshotId}`]) {
            setSnapshot(CACHE[`${path}/${snapshotId}`]);
            setDataLoading(false);
            setDataLoadingError(undefined);
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            return () => {
            };
        } else if (snapshotId && path && collection) {
            const accessor = dataClient.collection(path);

            if (accessor.listenById) {
                return accessor.listenById(snapshotId, (snapshot) => onSnapshotUpdate(snapshot as Snapshot<M> | undefined), onError);
            } else {
                accessor.findById(snapshotId)
                    .then((snapshot) => onSnapshotUpdate(snapshot as Snapshot<M> | undefined))
                    .catch(onError);
                return () => {
                };
            }
        }
        // if no snapshotId is provided we do nothing
        else {
            onSnapshotUpdate(undefined);
            return () => {
            };
        }
    }, [snapshotId, path, dataClient, collection, useCache, databaseId]);

    return useMemo(() => ({
        snapshot,
        dataLoading,
        dataLoadingError
    }), [snapshot, dataLoading, dataLoadingError]);

}
