import React, { lazy, Suspense, useMemo } from "react";
import { Route } from "react-router";
import {
    useRebaseRegistry,
    RebaseRoutes,
    UserSettingsView,
    NotFoundPage,
    useComponentOverride
} from "@rebasepro/app";
import { CircularProgressCenter } from "@rebasepro/ui";

import { ContentHomePage as DefaultHomePage } from "./HomePage/ContentHomePage";

import { RebaseRoute } from "../routes/RebaseRoute";
import { CustomViewRoute } from "../routes/CustomViewRoute";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { CollectionEditorDialogs } from "./CollectionEditorDialogs";
import { useEffect } from "react";
import { useTranslation } from "@rebasepro/app";
import { useBreadcrumbsController } from "../hooks/useBreadcrumbsController";

function SettingsView() {
    const { t } = useTranslation();
    const breadcrumbs = useBreadcrumbsController();
    useEffect(() => {
        breadcrumbs.set({
            breadcrumbs: [{ title: t("account_settings"),
url: "/settings" }]
        });

    }, []);
    return <UserSettingsView/>;
}

export interface RebaseRouteDefsProps {
    /** User-provided custom routes to include. */
    children?: React.ReactNode;
    /**
     * Wrap function — receives the route tree and lets you wrap it in a layout.
     * If provided, the routes are rendered inside this wrapper.
     * If not provided, routes are rendered directly inside <RebaseRoutes>.
     */
    layout?: React.ReactElement;
}

/**
 * Route definitions for the admin.
 *
 * Defines all standard routes: home, studio home, collection view,
 * settings, debug, custom views, and a catch-all 404.
 *
 * **Independently usable**: Use this when you want Rebase routes
 * inside your own layout/navigation setup.
 *
 * @example
 * ```tsx
 * <RebaseNavigation>
 *   <RebaseRouteDefs layout={<MyCustomLayout />}>
 *     <Route path="/my-custom" element={<MyView />} />
 *   </RebaseRouteDefs>
 * </RebaseNavigation>
 * ```
 */
export function RebaseRouteDefs({ children, layout }: RebaseRouteDefsProps) {
    const registry = useRebaseRegistry();
    const navigationStateController = useNavigationStateController();

    const ResolvedHomePage = useComponentOverride("HomePage", DefaultHomePage);
    const cmsHomePage = registry.cmsConfig?.homePage ?? <Suspense fallback={<CircularProgressCenter/>}><ResolvedHomePage/></Suspense>;
    const studioHomePage = registry.studioConfig?.homePage;

    const combinedViews = useMemo(() => [
        ...(navigationStateController.views ?? []),
        ...(navigationStateController.adminViews ?? [])
    ], [navigationStateController.views, navigationStateController.adminViews]);

    const routeContents = (
        <>
            {/* Core admin Routes */}
            <Route path={"/"} element={cmsHomePage}/>
            {registry.studioConfig && (
                <Route path={"/s"} element={studioHomePage}/>
            )}

            <Route path={"/c/*"} element={<RebaseRoute/>}/>
            <Route path={"/settings"} element={<SettingsView/>}/>


            {/* /debug/ui is not a framework route. It renders the design
                reference, which lives in the dogfood app and registers itself
                there as an ordinary custom view. */}

            {/* Custom Registered Views */}
            {combinedViews.map(view => {
                const slugs = Array.isArray(view.slug) ? view.slug : [view.slug];
                return slugs.flatMap(slug => {
                    const routes = [
                        <Route key={slug} path={slug} element={<CustomViewRoute view={view}/>}/>
                    ];
                    if (view.nestedRoutes) {
                        routes.push(
                            <Route key={slug + "/*"} path={slug + "/*"} element={<CustomViewRoute view={view}/>}/>
                        );
                    }
                    return routes;
                });
            })}

            {/* User Provided Custom Routes */}
            {children}

            <Route path={"*"} element={navigationStateController.loading ? <CircularProgressCenter/> : <NotFoundPage/>}/>
        </>
    );

    return (
        <>
            <RebaseRoutes>
                {layout
                    ? <Route element={layout}>{routeContents}</Route>
                    : <Route element={<>{routeContents}</>}>{routeContents}</Route>
                }
            </RebaseRoutes>
            <CollectionEditorDialogs/>
        </>
    );
}
