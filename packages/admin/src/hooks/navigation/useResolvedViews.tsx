
import type { AppView, AppViewsBuilder, EffectiveRoleController, EntityCollection, RebasePlugin } from "@rebasepro/types";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

import { AuthController, RebaseData, User } from "@rebasepro/types";
import { UserManagementDelegate } from "@rebasepro/types";

import { resolveAppViews } from "./useNavigationResolution";


// Lazy-load admin views — only rendered when navigation reaches /users or /roles
const UsersView = lazy(() => import("../../components/admin/UsersView").then(m => ({ default: m.UsersView })));
const RolesView = lazy(() => import("../../components/admin/RolesView").then(m => ({ default: m.RolesView })));

export type UseResolvedViewsProps<USER extends User> = {
    authController: AuthController<USER>;
    views?: AppView[] | AppViewsBuilder;
    adminViews?: AppView[] | AppViewsBuilder;
    data: RebaseData;
    plugins?: RebasePlugin[];
    adminMode?: "content" | "studio" | "settings";
    effectiveRoleController?: EffectiveRoleController;
    userManagement?: UserManagementDelegate<USER>;
    collections?: EntityCollection[];
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
 * into concrete AppView[]. Also injects Users/Roles admin views when userManagement
 * is provided.
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
        effectiveRoleController,
        userManagement,
        collections
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

    // Memoize JSX elements for injected admin views to ensure stable references.
    const usersViewElement = useMemo(() =>
        userManagement ? <Suspense fallback={null}><UsersView userManagement={userManagement as unknown as UserManagementDelegate<User>}/></Suspense> : null,
        [userManagement]
    );
    const rolesViewElement = useMemo(() =>
        userManagement?.roles ? <Suspense fallback={null}><RolesView userManagement={userManagement as unknown as UserManagementDelegate<User>}/></Suspense> : null,
        [userManagement]
    );

    const injectedAdminViews: AppView[] = useMemo(() => {
        const views: AppView[] = [];
        const isUserAdmin = userManagement?.isAdmin !== false;
        if (userManagement && isUserAdmin && usersViewElement) {
            const hasUsersCollection = collections?.some(c => c.slug === "users");
            if (!hasUsersCollection) {
                views.push({
                    slug: "users",
                    name: "Users",
                    icon: "Headset",
                    view: usersViewElement,
                    group: "Settings"
                });
            }
            const hasRolesCollection = collections?.some(c => c.slug === "roles");
            if (userManagement.roles && rolesViewElement && !hasRolesCollection) {
                views.push({
                    slug: "roles",
                    name: "Roles",
                    icon: "Shield",
                    view: rolesViewElement,
                    group: "Settings"
                });
            }
        }
        return views;
    }, [userManagement, usersViewElement, rolesViewElement, collections]);

    // Store injectedAdminViews in a ref for effect access
    const injectedAdminViewsRef = useRef(injectedAdminViews);
    injectedAdminViewsRef.current = injectedAdminViews;

    const initialLoading = resolvedAuthController.initialLoading;
    const user = resolvedAuthController.user;

    useEffect(() => {
        if (initialLoading) return;

        let cancelled = false;

        (async () => {
            try {
                const [newViews, newAdminViewsProp] = await Promise.all([
                    resolveAppViews(viewsProp, resolvedAuthControllerRef.current, dataRef.current, pluginsRef.current),
                    resolveAppViews(adminViewsProp, resolvedAuthControllerRef.current, dataRef.current)
                ]);

                const hasCustomUsers = newAdminViewsProp.some(v => v.slug === "users");
                const hasCustomRoles = newAdminViewsProp.some(v => v.slug === "roles");
                const finalInjected = injectedAdminViewsRef.current.filter(v => {
                    if (v.slug === "users" && hasCustomUsers) return false;
                    if (v.slug === "roles" && hasCustomRoles) return false;
                    return true;
                });
                const newAdminViews = [...newAdminViewsProp, ...finalInjected];

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
        user,
        collections
    ]);

    return useMemo(() => ({
        views: resolvedViews,
        adminViews: resolvedAdminViews,
        loading,
        error,
        refresh
    }), [resolvedViews, resolvedAdminViews, loading, error, refresh]);
}
