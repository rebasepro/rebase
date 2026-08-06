import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { PartialCollectionConfig, UserConfigurationPersistence } from "@rebasepro/admin-types";
import { stripCollectionPath } from "@rebasepro/common";
import { isArrayValue, isRecordValue, mergeDeep, readStoredJson, writeStoredJson } from "@rebasepro/utils";

export function useBuildLocalConfigurationPersistence(): UserConfigurationPersistence {

    const configCache = useRef<Record<string, PartialCollectionConfig>>({});

    // Read during render by every collection view, so an unreadable value here
    // used to throw the view away rather than fall back to an unconfigured one.
    const getCollectionFromStorage = useCallback(<M extends Record<string, any>>(storageKey: string): PartialCollectionConfig<M> => {
        return readStoredJson<PartialCollectionConfig<M>>(storageKey, { fallback: {}, accept: isRecordValue });
    }, []);

    const getCollectionConfig = useCallback(<M extends Record<string, any>>(path: string): PartialCollectionConfig<M> => {
        const storageKey = `collection_config::${stripCollectionPath(path)}`;
        if (configCache.current[storageKey]) {
            return configCache.current[storageKey] as PartialCollectionConfig<M>;
        }
        return getCollectionFromStorage(storageKey);
    }, [getCollectionFromStorage]);

    const onCollectionModified = useCallback(<M extends Record<string, any>>(path: string, data: PartialCollectionConfig<M>) => {
        const storageKey = `collection_config::${stripCollectionPath(path)}`;
        writeStoredJson(storageKey, data);
        const cachedConfig = configCache.current[storageKey];
        // `getCollectionFromStorage` takes the storage key, not the path — every
        // other caller passes one. Reading `path` looked up a key this hook
        // never writes, so the fallback could only ever contribute `{}`. It is
        // masked today because the one caller merges the stored config in
        // before calling, but `onCollectionModified` accepts a partial by type
        // and by its public interface, and a real partial would lose the rest.
        const newConfig = mergeDeep(cachedConfig ?? getCollectionFromStorage(storageKey), data);
        configCache.current[storageKey] = mergeDeep(configCache.current[storageKey], newConfig);
    }, [getCollectionFromStorage]);

    const [recentlyVisitedPaths, _setRecentlyVisitedPaths] = useState<string[]>([]);
    const [favouritePaths, _setFavouritePaths] = useState<string[]>([]);
    const [collapsedGroups, _setCollapsedGroups] = useState<string[]>([]);

    useEffect(() => {
        const readPaths = (key: string) => readStoredJson<string[]>(key, { fallback: [], accept: isArrayValue });
        _setRecentlyVisitedPaths(readPaths("recently_visited_paths"));
        _setFavouritePaths(readPaths("favourite_paths"));
        _setCollapsedGroups(readPaths("collapsed_groups"));
    }, []);

    const setRecentlyVisitedPaths = useCallback((paths: string[]) => {
        writeStoredJson("recently_visited_paths", paths);
        _setRecentlyVisitedPaths(paths);
    }, []);

    const setFavouritePaths = useCallback((paths: string[]) => {
        writeStoredJson("favourite_paths", paths);
        _setFavouritePaths(paths);
    }, []);

    const setCollapsedGroups = useCallback((paths: string[]) => {
        writeStoredJson("collapsed_groups", paths);
        _setCollapsedGroups(paths);
    }, []);

    return useMemo(() => ({
        onCollectionModified,
        getCollectionConfig,
        recentlyVisitedPaths,
        setRecentlyVisitedPaths,
        favouritePaths,
        setFavouritePaths,
        collapsedGroups,
        setCollapsedGroups
    }), [
        onCollectionModified,
        getCollectionConfig,
        recentlyVisitedPaths,
        setRecentlyVisitedPaths,
        favouritePaths,
        setFavouritePaths,
        collapsedGroups,
        setCollapsedGroups
    ]);
}
