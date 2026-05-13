import { useCallback, useEffect, useState, useMemo } from "react";

const STORAGE_KEY_PREFIX = "rebase-collapsed-groups";

/**
 * Custom hook for managing collapsed/expanded state of navigation groups
 * with localStorage persistence. Automatically cleans up stale group entries
 * when groups are removed from the navigation.
 *
 * Groups that have never been toggled by the user fall back to
 * `defaults[groupName]` (driven by `collapsedByDefault` in config).
 *
 * @param groupNames - Array of group names to track
 * @param namespace - Namespace for localStorage key (e.g., "home", "drawer") to allow independent state
 * @param defaults - Optional map of group name → collapsed boolean from config
 */
export function useCollapsedGroups(
    groupNames: string[],
    namespace = "default",
    defaults?: Record<string, boolean>
) {
    const storageKey = `${STORAGE_KEY_PREFIX}-${namespace}`;

    // Load collapsed groups from localStorage on mount
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    });

    // Save to localStorage whenever collapsedGroups changes
    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(collapsedGroups));
        } catch {
            // Silently fail if localStorage is not available
        }
    }, [collapsedGroups, storageKey]);

    // Clean up collapsed groups state when groups change - remove entries for groups that no longer exist
    useEffect(() => {
        // Only clean up if we have actual groups loaded (avoid cleaning up during initial load)
        if (groupNames.length === 0) return;

        const currentGroupNames = new Set(groupNames);

        setCollapsedGroups(prev => {
            const cleaned = Object.fromEntries(
                Object.entries(prev).filter(([groupName]) => currentGroupNames.has(groupName))
            );

            // Only update if something actually changed
            const prevKeys = Object.keys(prev);
            const cleanedKeys = Object.keys(cleaned);

            if (prevKeys.length === cleanedKeys.length && prevKeys.every(key => cleanedKeys.includes(key))) {
                return prev;
            }

            return cleaned;
        });
    }, [groupNames]);

    const isGroupCollapsed = useCallback((name: string) => {
        // If the user has explicitly toggled this group, use that value
        if (name in collapsedGroups) {
            return collapsedGroups[name];
        }
        // Otherwise fall back to the config default
        return defaults?.[name] ?? false;
    }, [collapsedGroups, defaults]);

    const toggleGroupCollapsed = useCallback((name: string) => {
        setCollapsedGroups(prev => {
            // Resolve current effective state (explicit or default)
            const currentlyCollapsed = name in prev
                ? prev[name]
                : (defaults?.[name] ?? false);
            return { ...prev, [name]: !currentlyCollapsed };
        });
    }, [defaults]);

    return useMemo(() => ({
        isGroupCollapsed,
        toggleGroupCollapsed
    }), [isGroupCollapsed, toggleGroupCollapsed]);
}

/**
 * Build a defaults map from navigationGroupMappings for a given namespace.
 * Returns a Record<groupName, collapsed> that can be passed to useCollapsedGroups.
 */
export function buildCollapsedDefaults(
    mappings: Array<{ name: string; collapsedByDefault?: boolean | { drawer?: boolean; home?: boolean } }> | undefined,
    namespace: "drawer" | "home"
): Record<string, boolean> {
    if (!mappings) return {};
    const result: Record<string, boolean> = {};
    for (const mapping of mappings) {
        const val = mapping.collapsedByDefault;
        if (val === undefined) continue;
        if (typeof val === "boolean") {
            result[mapping.name] = val;
        } else {
            const ns = val[namespace];
            if (ns !== undefined) {
                result[mapping.name] = ns;
            }
        }
    }
    return result;
}
