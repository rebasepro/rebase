
import type { AppView, NavigationResult, RebasePlugin, NavigationStateController, UrlController, NavigationGroupMapping, AdminCollection } from "@rebasepro/cms-types";
import { useCallback, useMemo, useRef } from "react";

import { RebaseData, CollectionRegistryController, User } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import type { EffectiveRoleController } from "@rebasepro/types";
import type { CollectionConfigsBuilder, AppViewsBuilder } from "@rebasepro/cms-types";
import { CollectionRegistry } from "@rebasepro/common";

import { useResolvedCollections } from "./useResolvedCollections";
import { useResolvedViews } from "./useResolvedViews";
import { useTopLevelNavigation } from "./useTopLevelNavigation";

export type BuildNavigationStateProps<EC extends AdminCollection, USER extends User> = {
    authController: AuthController<USER>;
    collections?: EC[] | CollectionConfigsBuilder<EC>;
    views?: AppView[] | AppViewsBuilder;
    adminViews?: AppView[] | AppViewsBuilder;
    data: RebaseData;
    plugins?: RebasePlugin[];
    navigationGroupMappings?: NavigationGroupMapping[];
    disabled?: boolean;
    viewsOrder?: string[];
    collectionRegistryController: CollectionRegistryController<EC> & { collectionRegistryRef: React.MutableRefObject<CollectionRegistry> };
    urlController: UrlController;
    adminMode?: "cms" | "studio" | "settings";
    effectiveRoleController?: EffectiveRoleController;

};

/**
 * Main hook that resolves collections, views, and admin views into a
 * NavigationStateController. This is a thin composition of three focused hooks:
 *
 * - useResolvedCollections: resolves collection props and registers with CollectionRegistry
 * - useResolvedViews: resolves view/admin view props
 * - useTopLevelNavigation: computes the NavigationResult from resolved data
 *
 * The NavigationStateController type is preserved as a public API.
 */
export function useBuildNavigationStateController<EC extends AdminCollection, USER extends User>(
    props: BuildNavigationStateProps<EC, USER>
): NavigationStateController {

    const {
        authController,
        collections: collectionsProp,
        views: viewsProp,
        adminViews: adminViewsProp,
        viewsOrder,
        plugins,
        data,
        disabled,
        navigationGroupMappings,
        collectionRegistryController,
        urlController,
        adminMode = "cms",
        effectiveRoleController
    } = props;

    const {
        collections,
        loading: collectionsLoading,
        error: collectionsError,
        refresh: refreshCollections
    } = useResolvedCollections({
        authController,
        collections: collectionsProp,
        data,
        plugins,
        disabled,
        collectionRegistryController
    });

    const {
        views,
        adminViews,
        loading: viewsLoading,
        error: viewsError,
        refresh: refreshViews
    } = useResolvedViews({
        authController,
        views: viewsProp,
        adminViews: adminViewsProp,
        data,
        plugins,
        adminMode,
        effectiveRoleController
    });

    // Step 3: Compute top-level navigation (pure derived state)
    const { topLevelNavigation } = useTopLevelNavigation({
        collections,
        views,
        adminViews,
        plugins,
        navigationGroupMappings,
        viewsOrder,
        urlController,
        adminMode,
        collectionRegistryController
    });

    // Expose a combined refresh function with microtask batching
    const pendingRefreshRef = useRef(false);
    const refreshNavigation = useCallback(() => {
        if (pendingRefreshRef.current) return;
        pendingRefreshRef.current = true;
        queueMicrotask(() => {
            pendingRefreshRef.current = false;
            refreshCollections();
            refreshViews();
        });
    }, [refreshCollections, refreshViews]);

    return useMemo(() => ({
        views,
        adminViews,
        topLevelNavigation,
        loading: collectionsLoading || viewsLoading,
        navigationLoadingError: collectionsError ?? viewsError,
        refreshNavigation
    }), [
        views,
        adminViews,
        topLevelNavigation,
        collectionsLoading,
        viewsLoading,
        collectionsError,
        viewsError,
        refreshNavigation
    ]);
}
