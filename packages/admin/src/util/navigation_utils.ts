import type { CollectionConfig, UrlController, SidePanelController, NavigateOptions } from "@rebasepro/types";

// Canonical path utilities — single source of truth in @rebasepro/common
export {
    removeInitialAndTrailingSlashes,
    removeInitialSlash,
    removeTrailingSlash,
    addInitialSlash,
    getLastSegment,
    resolveCollectionPathIds,
    getCollectionBySlugWithin,
    getCollectionPathsCombinations
} from "@rebasepro/common";

/**
 * Navigate to a snapshot using either a side panel or full-screen mode.
 * This is an admin-specific UI concern and lives here (not in common).
 */
export function navigateToSnapshot({
    openSnapshotMode,
    collection,
    snapshotId,
    copy,
    path,
    selectedTab,
    defaultValues,
    sidePanelController,
    onClose,
    navigation,
    replace
}:

    {
        openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";
        collection?: CollectionConfig;
        snapshotId?: string | number;
        selectedTab?: string;
        copy?: boolean;
        /**
         * Pre-populate the new snapshot form with these values.
         * Only applied when snapshotId is not set (i.e. "new" mode).
         *
         * Side panel: passed through SidePanelBindingProps → EditViewBinding.
         * Full screen: carried via React Router location.state so the route
         * component can read it on mount without polluting the URL.
         */
        defaultValues?: Record<string, unknown>;
        path: string;
        sidePanelController: SidePanelController;
        onClose?: () => void;
        navigation: UrlController;
        replace?: boolean;
    }) {

    if (openSnapshotMode === "side_panel" || openSnapshotMode === "dialog") {


        sidePanelController.open({
            snapshotId,
            path: path,
            copy,
            selectedTab,
            collection,
            updateUrl: openSnapshotMode !== "dialog",
            onClose,
            defaultValues
        });

    } else {
        let to = navigation.buildUrlCollectionPath(snapshotId ? `${path ?? path}/${snapshotId}` : path ?? path);
        if (snapshotId && selectedTab) {
            to += `/${selectedTab}`;
        }
        // Preserve the __view query param so the target route knows the current view mode
        const currentViewParam = new URLSearchParams(window.location.search).get("__view");
        if (currentViewParam) {
            to += `${to.includes("?") ? "&" : "?"}__view=${currentViewParam}`;
        }
        if (!snapshotId) {
            to += "#new";
        }
        if (copy) {
            to += "#copy";
        }
        // Use React Router location.state to carry defaultValues — the correct SPA
        // approach. No URL size limits, no encoding, nothing in the address bar.
        // SnapshotFullScreenRoute reads location.state.defaultValues on mount.
        const navigateOptions: NavigateOptions = {};
        if (replace !== undefined) {
            navigateOptions.replace = replace;
        }
        if (defaultValues) {
            navigateOptions.state = { defaultValues };
        }
        const hasOptions = Object.keys(navigateOptions).length > 0;
        navigation.navigate(to, hasOptions ? navigateOptions : undefined);
    }

}
