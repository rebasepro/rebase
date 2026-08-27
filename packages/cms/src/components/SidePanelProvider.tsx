import type { SidePanelController } from "@rebasepro/cms-types";
import React from "react";
import { useBuildSidePanel } from "../hooks/useBuildSidePanel";
import { useBuildSideDialogsController } from "../hooks/useBuildSideDialogsController";
import { SidePanelControllerContext } from "../hooks/useSidePanel";
import { SideDialogsControllerContext } from "../contexts/SideDialogsControllerContext";
import { BreadcrumbsProvider } from "../contexts/BreacrumbsContext";
import { useBreadcrumbsController } from "../hooks/useBreadcrumbsController";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { useAuthController, useBridgeRegistration, NavigationBlockerProvider } from "@rebasepro/app";

/**
 * Provider that builds the SidePanelController and makes it available
 * via the SidePanelControllerContext from @rebasepro/app.
 *
 * After the admin extraction refactor, `useBuildSidePanel` lives
 * in the admin package while the context it feeds into lives in core.
 * This provider bridges the two: place it inside the `<Rebase>` tree and
 * above any component that calls `useSidePanel()`.
 *
 * Also auto-registers the side entity controller and breadcrumbs into the
 * self-assembling Studio bridge (when a StudioBridgeRegistryProvider is
 * mounted above in the tree).
 *
 * @example
 * ```tsx
 * <Rebase ...>
 *   {({ loading }) => (
 *     <SidePanelProvider>
 *       <RebaseRoutes>
 *         ...
 *       </RebaseRoutes>
 *     </SidePanelProvider>
 *   )}
 * </Rebase>
 * ```
 *
 * @group Components
 */
export function SidePanelProvider({ children }: { children: React.ReactNode }) {
    const collectionRegistryController = useCollectionRegistryController();
    const urlController = useUrlController();
    const navigationStateController = useNavigationStateController();
    const sideDialogsController = useBuildSideDialogsController();
    const authController = useAuthController();

    const sidePanelController = useBuildSidePanel(
        collectionRegistryController,
        urlController,
        navigationStateController,
        sideDialogsController,
        authController
    );

    return (
        <NavigationBlockerProvider>
            <BreadcrumbsProvider>
                <SideDialogsControllerContext.Provider value={sideDialogsController}>
                    <SidePanelControllerContext.Provider value={sidePanelController}>
                        <BridgeAutoRegistrar sidePanelController={sidePanelController}/>
                        {children}
                    </SidePanelControllerContext.Provider>
                </SideDialogsControllerContext.Provider>
            </BreadcrumbsProvider>
        </NavigationBlockerProvider>
    );
}

/**
 * Internal component that auto-registers side entity and breadcrumbs
 * into the Studio bridge. Must be a child of BreadcrumbsProvider.
 */
function BridgeAutoRegistrar({ sidePanelController }: { sidePanelController: SidePanelController }) {
    const breadcrumbs = useBreadcrumbsController();
    useBridgeRegistration("sidePanelController", sidePanelController);
    useBridgeRegistration("breadcrumbs", breadcrumbs);
    return null;
}
