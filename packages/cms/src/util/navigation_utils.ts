
import type { UrlController, SidePanelController, NavigateOptions, AdminCollection } from "@rebasepro/cms-types";
import { withListState, withViewMode } from "./view_mode";

// Canonical path utilities — single source of truth in @rebasepro/common
export { removeInitialAndTrailingSlashes, removeInitialSlash, removeTrailingSlash, addInitialSlash, getLastSegment, resolveCollectionPathIds, getCollectionBySlugWithin, getCollectionPathsCombinations } from "@rebasepro/app";

/**
 * Navigate to a entity using either a side panel or full-screen mode.
 * This is an admin-specific UI concern and lives here (not in common).
 */
export function navigateToEntity({
    openEntityMode,
    collection,
    entityId,
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
        openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
        collection?: AdminCollection;
        entityId?: string | number;
        selectedTab?: string;
        copy?: boolean;
        /**
         * Pre-populate the new entity form with these values.
         * Only applied when entityId is not set (i.e. "new" mode).
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

    if (openEntityMode === "side_panel" || openEntityMode === "dialog") {

        sidePanelController.open({
            entityId,
            path: path,
            copy,
            selectedTab,
            collection,
            updateUrl: openEntityMode !== "dialog",
            onClose,
            defaultValues
        });

    } else {
        let to = navigation.buildUrlCollectionPath(entityId ? `${path ?? path}/${entityId}` : path ?? path);
        if (entityId && selectedTab) {
            to += `/${selectedTab}`;
        }
        // The whole list state, not just the view mode: a record opened from a
        // search must come back to that search.
        to = withListState(to);
        if (!entityId) {
            to += "#new";
        }
        if (copy) {
            to += "#copy";
        }
        // Use React Router location.state to carry defaultValues — the correct SPA
        // approach. No URL size limits, no encoding, nothing in the address bar.
        // EntityFullScreenRoute reads location.state.defaultValues on mount.
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
