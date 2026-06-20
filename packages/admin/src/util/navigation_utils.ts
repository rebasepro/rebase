import type { EntityCollection, UrlController, SideEntityController, NavigateOptions } from "@rebasepro/types";

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
 * Navigate to an entity using either a side panel or full-screen mode.
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
    sideEntityController,
    onClose,
    navigation,
    replace
}:

    {
        openEntityMode: "side_panel" | "full_screen" | "split" | "dialog";
        collection?: EntityCollection;
        entityId?: string | number;
        selectedTab?: string;
        copy?: boolean;
        /**
         * Pre-populate the new entity form with these values.
         * Only applied when entityId is not set (i.e. "new" mode).
         *
         * Side panel: passed through EntitySidePanelProps → EntityEditView.
         * Full screen: carried via React Router location.state so the route
         * component can read it on mount without polluting the URL.
         */
        defaultValues?: Record<string, unknown>;
        path: string;
        sideEntityController: SideEntityController;
        onClose?: () => void;
        navigation: UrlController;
        replace?: boolean;
    }) {

    if (openEntityMode === "side_panel" || openEntityMode === "dialog") {


        sideEntityController.open({
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
        // Preserve the __view query param so the target route knows the current view mode
        const currentViewParam = new URLSearchParams(window.location.search).get("__view");
        if (currentViewParam) {
            to += `${to.includes("?") ? "&" : "?"}__view=${currentViewParam}`;
        }
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
