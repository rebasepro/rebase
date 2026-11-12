
import type { UrlController, SidePanelBindingProps, SidePanelController, NavigateOptions, AdminCollection } from "@rebasepro/cms-types";
import { hasEntityId } from "./identity";
import { withListState } from "./view_mode";

// Canonical path utilities — single source of truth in @rebasepro/common
export { removeInitialAndTrailingSlashes, removeInitialSlash, removeTrailingSlash, addInitialSlash, getLastSegment, resolveCollectionPathIds, getCollectionBySlugWithin, getCollectionPathsCombinations } from "@rebasepro/app";

/**
 * Navigate to a entity using either a side panel or full-screen mode.
 * This is an admin-specific UI concern and lives here (not in common).
 */
export function navigateToEntity({
    openEntityMode,
    collection,
    id,
    copy,
    path,
    selectedTab,
    defaultValues,
    sidePanelController,
    onClose,
    onSaved,
    navigation,
    replace
}:

    {
        openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
        collection?: AdminCollection;
        /** Id of the record to open; unset opens the form for a new record. */
        id?: string | number;
        selectedTab?: string;
        copy?: boolean;
        /**
         * Pre-populate the new entity form with these values.
         * Only applied when `id` is not set (i.e. "new" mode).
         *
         * Side panel: passed through SidePanelBindingProps → EditViewBinding.
         * Full screen: carried via React Router location.state so the route
         * component can read it on mount without polluting the URL.
         */
        defaultValues?: Record<string, unknown>;
        path: string;
        sidePanelController: SidePanelController;
        onClose?: () => void;
        /**
         * Called when the side panel or dialog saves the record. A full-screen
         * record replaces the view that opened it, and that view reads
         * everything again when it comes back, so nothing is called there.
         */
        onSaved?: SidePanelBindingProps["onSaved"];
        navigation: UrlController;
        replace?: boolean;
    }) {

    // No CMS route serves this page (a collection embedded in the host app's
    // own page): there is no URL to go to, so the record opens over the page.
    const mode = navigation.routesMounted === false && openEntityMode !== "dialog"
        ? "side_panel"
        : openEntityMode;

    if (mode === "side_panel" || mode === "dialog") {

        sidePanelController.open({
            id,
            path: path,
            copy,
            selectedTab,
            collection,
            updateUrl: mode !== "dialog",
            onClose,
            onSaved,
            defaultValues
        });

    } else {
        let to = navigation.buildUrlCollectionPath(hasEntityId(id) ? `${path}/${id}` : path);
        if (hasEntityId(id) && selectedTab) {
            to += `/${selectedTab}`;
        }
        // The whole list state, not just the view mode: a record opened from a
        // search must come back to that search.
        to = withListState(to);
        if (!hasEntityId(id)) {
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

/**
 * Whether `pathname` is the record at `entityPath` or somewhere below it — one
 * of its tabs, its `/edit`. A path segment, not a string prefix:
 * `/c/products/12` is another record, not a place inside `/c/products/1`.
 */
export function isPathWithinRecord(pathname: string, entityPath: string): boolean {
    return pathname === entityPath || pathname.startsWith(`${entityPath}/`);
}
