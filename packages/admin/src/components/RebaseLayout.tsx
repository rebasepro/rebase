import React from "react";
import { Outlet } from "react-router-dom";
import {
    useAdminModeController,
    useComponentOverride,
    useRebaseRegistry
} from "@rebasepro/app";

import { Scaffold } from "./app/Scaffold";
import { Drawer } from "./app/Drawer";
import { SideDialogs } from "./SideDialogs";
import { AdminModeSyncer } from "./AdminModeSyncer";
import type { AppView } from "@rebasepro/admin-types";

export interface RebaseLayoutProps {
    /** Title shown in the drawer. */
    title?: string;
    /** Top bar. Only rendered if provided — pass `<AppBar/>` for the default one. */
    appBar?: React.ReactNode;
    /** Custom Drawer to override the default. */
    drawer?: React.ReactNode;
    /** Whether to auto-open the drawer on load. */
    autoOpenDrawer?: boolean;
    /** Dev views passed to AdminModeSyncer (resolved from RebaseNavigation). */
    devViews?: AppView[];
}

/**
 * Layout layer — provides the Scaffold, Drawer, and SideDialogs.
 *
 * Wraps the route outlet with the standard Rebase admin layout.
 * Override the drawer via props; pass `appBar` to add a top bar (there is
 * none by default — the drawer owns navigation and user actions).
 *
 * **Independently usable**: Use this when you want the Rebase layout
 * without its default route definitions.
 *
 * @example
 * ```tsx
 * <RebaseLayout title="My Admin" appBar={<AppBar/>}>
 *   <Route path="/" element={<MyHomePage />} />
 *   <Route path="/custom" element={<CustomView />} />
 * </RebaseLayout>
 * ```
 */
export function RebaseLayout(props: RebaseLayoutProps) {
    const {
        title = "Rebase",
        appBar,
        drawer,
        autoOpenDrawer = false,
        devViews = []
    } = props;

    const adminModeController = useAdminModeController();
    const ResolvedDrawer = useComponentOverride("Shell.Drawer", Drawer);

    const ActiveDrawer = drawer ?? (
        <ResolvedDrawer
            title={title}
            logoDestination={adminModeController.mode === "studio" ? "/s" : "/"}
        />
    );

    return (
        <Scaffold autoOpenDrawer={autoOpenDrawer}>
            <AdminModeSyncer devViews={devViews}/>
            {appBar}
            {ActiveDrawer}
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    );
}
