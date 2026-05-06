import type { EntityCollection, UrlController, SideEntityController } from "@rebasepro/types";

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
    sideEntityController,
    onClose,
    navigation
}:

    {
        openEntityMode: "side_panel" | "full_screen" | "split";
        collection?: EntityCollection;
        entityId?: string | number;
        selectedTab?: string;
        copy?: boolean;
        path: string;
        sideEntityController: SideEntityController;
        onClose?: () => void;
        navigation: UrlController
    }) {

    if (openEntityMode === "side_panel") {

        sideEntityController.open({
            entityId,
            path: path,
            copy,
            selectedTab,
            collection,
            updateUrl: true,
            onClose
        });

    } else {
        let to = navigation.buildUrlCollectionPath(entityId ? `${path ?? path}/${entityId}` : path ?? path);
        if (entityId && selectedTab) {
            to += `/${selectedTab}`;
        }
        if (!entityId) {
            to += "#new";
        }
        if (copy) {
            to += "#copy";
        }
        navigation.navigate(to);
    }

}
