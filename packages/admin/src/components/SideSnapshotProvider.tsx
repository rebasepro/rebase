import type { SideSnapshotController } from "@rebasepro/types";
import React from "react";
import { useBuildSideSnapshotController } from "../hooks/useBuildSideSnapshotController";
import { useBuildSideDialogsController } from "../hooks/useBuildSideDialogsController";
import { SideSnapshotControllerContext } from "../hooks/useSideSnapshotController";
import { SideDialogsControllerContext } from "../contexts/SideDialogsControllerContext";
import { BreadcrumbsProvider } from "../contexts/BreacrumbsContext";
import { useBreadcrumbsController } from "../hooks/useBreadcrumbsController";
import { useCollectionRegistryController, useUrlController } from "../index";
import { useNavigationStateController } from "../index";
import { useAuthController, useBridgeRegistration } from "@rebasepro/core";

/**
 * Provider that builds the SideSnapshotController and makes it available
 * via the SideSnapshotControllerContext from @rebasepro/core.
 *
 * After the CMS extraction refactor, `useBuildSideSnapshotController` lives
 * in the CMS package while the context it feeds into lives in core.
 * This provider bridges the two: place it inside the `<Rebase>` tree and
 * above any component that calls `useSideSnapshotController()`.
 *
 * Also auto-registers the side snapshot controller and breadcrumbs into the
 * self-assembling Studio bridge (when a StudioBridgeRegistryProvider is
 * mounted above in the tree).
 *
 * @example
 * ```tsx
 * <Rebase ...>
 *   {({ loading }) => (
 *     <SideSnapshotProvider>
 *       <RebaseRoutes>
 *         ...
 *       </RebaseRoutes>
 *     </SideSnapshotProvider>
 *   )}
 * </Rebase>
 * ```
 *
 * @group Components
 */
export function SideSnapshotProvider({ children }: { children: React.ReactNode }) {
    const collectionRegistryController = useCollectionRegistryController();
    const urlController = useUrlController();
    const navigationStateController = useNavigationStateController();
    const sideDialogsController = useBuildSideDialogsController();
    const authController = useAuthController();

    const sideSnapshotController = useBuildSideSnapshotController(
        collectionRegistryController,
        urlController,
        navigationStateController,
        sideDialogsController,
        authController
    );

    return (
        <BreadcrumbsProvider>
            <SideDialogsControllerContext.Provider value={sideDialogsController}>
                <SideSnapshotControllerContext.Provider value={sideSnapshotController}>
                    <BridgeAutoRegistrar sideSnapshotController={sideSnapshotController}/>
                    {children}
                </SideSnapshotControllerContext.Provider>
            </SideDialogsControllerContext.Provider>
        </BreadcrumbsProvider>
    );
}

/**
 * Internal component that auto-registers side snapshot and breadcrumbs
 * into the Studio bridge. Must be a child of BreadcrumbsProvider.
 */
function BridgeAutoRegistrar({ sideSnapshotController }: { sideSnapshotController: SideSnapshotController }) {
    const breadcrumbs = useBreadcrumbsController();
    useBridgeRegistration("sideSnapshotController", sideSnapshotController);
    useBridgeRegistration("breadcrumbs", breadcrumbs);
    return null;
}
