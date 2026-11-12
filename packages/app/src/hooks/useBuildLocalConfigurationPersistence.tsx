import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { UserConfigurationPersistence } from "@rebasepro/cms-types";
import type { UiTablePreferences } from "@rebasepro/types";
import { isUiTablePreferences, mergeUiTablePreferences } from "@rebasepro/types";
import { stripCollectionPath } from "@rebasepro/common";
import { isArrayValue, readStoredJson, writeStoredJson } from "@rebasepro/utils";

/** The key a table's preferences are stored under in this browser. */
const storageKeyOf = (slug: string): string => `table_preferences::${stripCollectionPath(slug)}`;

/**
 * The user's table preferences, kept in this browser.
 *
 * What the panel uses when nobody is signed in, or when the server stores no
 * preferences (its driver cannot run SQL): the views' column widths, order,
 * view mode and board column, as {@link UiTablePreferences} deltas. A stored
 * value that is not a valid preference — written by an older panel — is
 * ignored, so no view renders from it.
 *
 * @group Hooks and utilities
 */
export function useBuildLocalConfigurationPersistence(): UserConfigurationPersistence {

    const cache = useRef<Record<string, UiTablePreferences>>({});

    // Bumped on every write. The views fold these preferences into their
    // collection while rendering, so a write that is only a ref mutation is
    // invisible to them: the new column width reaches storage, the table keeps
    // rendering the old one, and the next re-render snaps the column back.
    // Making a write a state change is what lets the views re-read it.
    const [version, setVersion] = useState(0);

    const getTablePreferences = useCallback((slug: string): UiTablePreferences => {
        const key = storageKeyOf(slug);
        const cached = cache.current[key];
        if (cached) return cached;
        return readStoredJson<UiTablePreferences>(key, { fallback: {}, accept: isUiTablePreferences });
    }, []);

    const saveTablePreferences = useCallback((slug: string, delta: UiTablePreferences) => {
        const key = storageKeyOf(slug);
        const merged = mergeUiTablePreferences(getTablePreferences(slug), delta);
        cache.current[key] = merged;
        writeStoredJson(key, merged);
        setVersion(v => v + 1);
    }, [getTablePreferences]);

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
        getTablePreferences,
        saveTablePreferences,
        recentlyVisitedPaths,
        setRecentlyVisitedPaths,
        favouritePaths,
        setFavouritePaths,
        collapsedGroups,
        setCollapsedGroups
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `version`
        // contributes nothing to the value and everything to its IDENTITY: the
        // stored preferences live in a ref, and this is the only thing telling
        // the views that read them during render that they changed.
    }), [
        version,
        getTablePreferences,
        saveTablePreferences,
        recentlyVisitedPaths,
        setRecentlyVisitedPaths,
        favouritePaths,
        setFavouritePaths,
        collapsedGroups,
        setCollapsedGroups
    ]);
}
