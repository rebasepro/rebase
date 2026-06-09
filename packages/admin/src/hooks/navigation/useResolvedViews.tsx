
import type { AppView, AppViewsBuilder, EffectiveRoleController, RebasePlugin } from "@rebasepro/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

import type { AuthController, RebaseData, User } from "@rebasepro/types";

import { resolveAppViews } from "./useNavigationResolution";

export type UseResolvedViewsProps<USER extends User> = {
    authController: AuthController<USER>;
    views?: AppView[] | AppViewsBuilder;
    adminViews?: AppView[] | AppViewsBuilder;
    data: RebaseData;
    plugins?: RebasePlugin[];
    adminMode?: "content" | "studio" | "settings";
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
        adminMode = "content",
        effectiveRoleController
    } = props;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | undefined>(undefined);
    const [resolvedViews, setResolvedViews] = useState<AppView[] | undefined>(undefined);
    const [resolvedAdminViews, setResolvedAdminViews] = useState<AppView[] | undefined>(undefined);

    // Track the trigger count to allow force-refresh
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const refresh = useCallback(() => {
        setRefreshTrigger(prev => prev + 1);
    }, []);

    // Refs for change-detection (avoids state updates when views haven't changed)
    const viewsRef = useRef<AppView[] | undefined>(undefined);
    const adminViewsRef = useRef<AppView[] | undefined>(undefined);

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
    const user = resolvedAuthController.user;

    useEffect(() => {
        if (initialLoading) return;

        let cancelled = false;

        (async () => {
            try {
                const [newViews, newAdminViews] = await Promise.all([
                    resolveAppViews(viewsProp, resolvedAuthControllerRef.current, dataRef.current, pluginsRef.current),
                    resolveAppViews(adminViewsProp, resolvedAuthControllerRef.current, dataRef.current)
                ]);

                // Compare views by slug identity rather than deepEqual.
                // Views contain React elements (JSX) whose internal properties
                // change on every render, making deepEqual unreliable.
                if (!viewSlugsEqual(viewsRef.current, newViews)) {
                    viewsRef.current = newViews;
                    setResolvedViews(newViews);
                }

                if (!viewSlugsEqual(adminViewsRef.current, newAdminViews)) {
                    adminViewsRef.current = newAdminViews;
                    setResolvedAdminViews(newAdminViews);
                }

                setError(undefined);
            } catch (e) {
                if (!cancelled) {
                    console.error("Error resolving views:", e);
                    setError(e as Error);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        viewsProp,
        adminViewsProp,
        refreshTrigger,
        adminMode,
        initialLoading,
        user
    ]);

    return useMemo(() => ({
        views: resolvedViews,
        adminViews: resolvedAdminViews,
        loading,
        error,
        refresh
    }), [resolvedViews, resolvedAdminViews, loading, error, refresh]);
}

