import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { PartialCollectionConfig, UserConfigurationPersistence } from "@rebasepro/cms-types";
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

    // Bumped on every write. The collection views merge this store into their
    // collection while rendering, so a write that is only a ref mutation is
    // invisible to them: the new column width reaches storage, the table keeps
    // rendering the old one, and the next re-render — a row arriving, a
    // selection, a filter — rebuilds the columns from the stale config and
    // snaps the column back. Making a write a state change is what lets the
    // views re-read it.
    const [configVersion, setConfigVersion] = useState(0);

    const onCollectionModified = useCallback(<M extends Record<string, any>>(path: string, data: PartialCollectionConfig<M>) => {
        const storageKey = `collection_config::${stripCollectionPath(path)}`;
        // Read before writing. `data` is a partial by type and by this
        // interface's contract, so what is already stored is the other half of
        // the result — writing `data` first and merging afterwards read back
        // the value that had just been overwritten, and every key the caller
        // left out was dropped.
        const merged = mergeDeep(configCache.current[storageKey] ?? getCollectionFromStorage(storageKey), data);
        configCache.current[storageKey] = merged;
        writeStoredJson(storageKey, merged);
        setConfigVersion(version => version + 1);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `configVersion`
        // is deliberate and the rule cannot see why: it contributes nothing to
        // the value and everything to its IDENTITY. The stored configs live in a
        // ref, so nothing else in this array changes when they do, and this is
        // the only thing telling the views that read them during render that
        // they have. Removing it as "unnecessary" is what would break it.
    }), [
        configVersion,
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
