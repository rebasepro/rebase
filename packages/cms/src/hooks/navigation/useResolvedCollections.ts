
import type { RebasePlugin, AdminCollection } from "@rebasepro/cms-types";
import { useRef, useMemo } from "react";

import { CollectionRegistryController, RebaseData, User } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import type { CollectionConfigsBuilder } from "@rebasepro/cms-types";
import { CollectionRegistry } from "@rebasepro/common";

import { resolveCollections } from "./useNavigationResolution";
import { areCollectionListsEqual } from "./utils";
import { useAsyncResolver } from "./useAsyncResolver";

export type UseResolvedCollectionsProps<EC extends AdminCollection, USER extends User> = {
    authController: AuthController<USER>;
    collections?: EC[] | CollectionConfigsBuilder<EC>;
    data: RebaseData;
    plugins?: RebasePlugin[];
    disabled?: boolean;
    collectionRegistryController: CollectionRegistryController<EC> & { collectionRegistryRef: React.MutableRefObject<CollectionRegistry> };

};

export type UseResolvedCollectionsResult = {
    collections: AdminCollection[];
    loading: boolean;
    error: Error | undefined;
    refresh: () => void;
};

/**
 * Hook that resolves collection props (which may be async builders or arrays)
 * into concrete AdminCollection[], and registers them with the CollectionRegistry.
 *
 * When userManagement is provided, the default users collection is always
 * prepended. Developer collections override via generic slug-based dedup
 * (Map keyed by slug, last-write-wins). No hardcoded string checks.
 *
 * Uses refs for potentially-unstable dependencies (driver, authController,
 * plugins) to avoid re-triggering effects when their object identity changes.
 */
export function useResolvedCollections<EC extends AdminCollection, USER extends User>(
    props: UseResolvedCollectionsProps<EC, USER>
): UseResolvedCollectionsResult {

    const {
        authController,
        collections: collectionsProp,
        data,
        plugins,
        disabled,
        collectionRegistryController
    } = props;

    // Stable identity string for the user — avoids re-triggering when the
    // authController object reference changes but uid/roles are the same.
    const userIdentity = authController.user
        ? `${authController.user.uid}:${(authController.user.roles ?? []).sort().join(',')}`
        : null;

    // Use refs for values that may be new objects each render but shouldn't
    // re-trigger the effect. The effect reads them at execution time.
    const dataRef = useRef(data);
    dataRef.current = data;
    const authControllerRef = useRef(authController);
    authControllerRef.current = authController;
    const pluginsRef = useRef(plugins);
    pluginsRef.current = plugins;

    const { data: collections, loading, error, refresh } = useAsyncResolver<AdminCollection[]>({
        resolver: async () => {
            const resolved = await resolveCollections(
                collectionsProp,
                authControllerRef.current,
                dataRef.current,
                pluginsRef.current
            );

            const deduped = [...resolved];

            // Register with the CollectionRegistry; returns true if changed
            const changed = collectionRegistryController.collectionRegistryRef.current.registerMultiple(deduped);

            if (changed) {
                console.debug("Collections have changed", deduped);
            }

            return deduped;
        },
        initialValue: [],
        isEqual: areCollectionListsEqual,
        deps: [collectionsProp, userIdentity, disabled],
        disabled: disabled || authController.initialLoading,
    });

    return useMemo(() => ({
        collections,
        loading,
        error,
        refresh
    }), [collections, loading, error, refresh]);
}
