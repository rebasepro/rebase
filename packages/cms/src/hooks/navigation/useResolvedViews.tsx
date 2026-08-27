
import type { EffectiveRoleController } from "@rebasepro/types";
import type { AppView, AppViewsBuilder, RebasePlugin } from "@rebasepro/cms-types";
import { useMemo, useRef } from "react";

/**
 * Compare two view arrays by their slug identity.
 * Returns true when the sets of slugs are identical (same order, same values).
 * This avoids deepEqual on React elements, which have unstable internal refs.
 */
function viewSlugsEqual(a: AppView[] | undefined, b: AppView[] | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].slug !== b[i].slug) return false;
    }
    return true;
}

import type { RebaseData, User } from "@rebasepro/types";
import type { AuthController } from "@rebasepro/cms-types";

import { resolveAppViews } from "./useNavigationResolution";
import { useAsyncResolver } from "./useAsyncResolver";

export type UseResolvedViewsProps<USER extends User> = {
    authController: AuthController<USER>;
    views?: AppView[] | AppViewsBuilder;
    adminViews?: AppView[] | AppViewsBuilder;
    data: RebaseData;
    plugins?: RebasePlugin[];
    adminMode?: "cms" | "studio" | "settings";
    effectiveRoleController?: EffectiveRoleController;
};

export type UseResolvedViewsResult = {
    views: AppView[] | undefined;
    adminViews: AppView[] | undefined;
    loading: boolean;
    error: Error | undefined;
    refresh: () => void;
};

/**
 * Combined result type for the async resolver — holds both views and
 * adminViews so they can be resolved together in a single async call.
 */
type ResolvedViewsData = {
    views: AppView[] | undefined;
    adminViews: AppView[] | undefined;
};

/**
 * Equality check for the combined views data.
 * Compares both views and adminViews by slug identity.
 */
function areResolvedViewsEqual(a: ResolvedViewsData, b: ResolvedViewsData): boolean {
    return viewSlugsEqual(a.views, b.views) && viewSlugsEqual(a.adminViews, b.adminViews);
}

/**
 * Hook that resolves view and admin view props (which may be async builders or arrays)
 * into concrete AppView[].
 *
 * Uses refs for potentially-unstable dependencies (driver, authController,
 * plugins) to avoid re-triggering effects when their object identity changes.
 */
export function useResolvedViews<USER extends User>(
    props: UseResolvedViewsProps<USER>
): UseResolvedViewsResult {

    const {
        authController,
        views: viewsProp,
        adminViews: adminViewsProp,
        data,
        plugins,
        adminMode = "cms",
        effectiveRoleController
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

    // Build the resolved auth controller (with effective role override for studio mode)
    const resolvedAuthController = useMemo(() => {
        if (adminMode === "studio" && effectiveRoleController?.effectiveRole && authController.user) {
            return {
                ...authController,
                user: {
                    ...authController.user,
                    roles: [effectiveRoleController.effectiveRole]
                }
            };
        }
        return authController;
    }, [adminMode, effectiveRoleController?.effectiveRole, authController]);

    // Store resolvedAuthController in a ref for effect access without re-triggering
    const resolvedAuthControllerRef = useRef(resolvedAuthController);
    resolvedAuthControllerRef.current = resolvedAuthController;

    const initialLoading = resolvedAuthController.initialLoading;

    const { data: resolvedData, loading, error, refresh } = useAsyncResolver<ResolvedViewsData>({
        resolver: async () => {
            const [newViews, newAdminViews] = await Promise.all([
                resolveAppViews(viewsProp, resolvedAuthControllerRef.current, dataRef.current, pluginsRef.current),
                resolveAppViews(adminViewsProp, resolvedAuthControllerRef.current, dataRef.current)
            ]);
            return { views: newViews, adminViews: newAdminViews };
        },
        initialValue: { views: undefined, adminViews: undefined },
        isEqual: areResolvedViewsEqual,
        deps: [viewsProp, adminViewsProp, adminMode, userIdentity],
        disabled: initialLoading,
    });

    return useMemo(() => ({
        views: resolvedData.views,
        adminViews: resolvedData.adminViews,
        loading,
        error,
        refresh
    }), [resolvedData, loading, error, refresh]);
}
