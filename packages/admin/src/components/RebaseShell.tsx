import React, { useMemo } from "react";
import {
    useRebaseRegistry
} from "@rebasepro/app";
import { ErrorBoundary } from "@rebasepro/ui";

import { RebaseAuthGate } from "./RebaseAuthGate";
import { RebaseNavigation } from "./RebaseNavigation";
import { RebaseLayout } from "./RebaseLayout";
import { RebaseRouteDefs } from "./RebaseRouteDefs";

export interface RebaseShellProps {
    title?: string;
    /** Top bar. Only rendered if provided — pass `<AppBar/>` for the default one. */
    appBar?: React.ReactNode;
    drawer?: React.ReactNode;
    /** Expand the drawer while the pointer is over it. On by default; pass `false` to opt out. Not a load-time default — that is `defaultDrawerOpen`. */
    autoOpenDrawer?: boolean;
    /** Start with the drawer expanded instead of collapsed to icons. Ignored on small layouts. */
    defaultDrawerOpen?: boolean;
    /** Path to the logo shown in the drawer and top bar. Falls back to the Rebase mark. */
    logo?: string;
    children?: React.ReactNode;
}

/**
 * Convenience component that composes all four admin layers:
 *
 * ```
 * <RebaseAuthGate>
 *   <RebaseNavigation>
 *     <RebaseRouteDefs layout={<RebaseLayout>}>
 *       {children}
 *     </RebaseRouteDefs>
 *   </RebaseNavigation>
 * </RebaseAuthGate>
 * ```
 *
 * Each layer is independently usable — see their individual docs.
 * RebaseShell is sugar that composes them all with sensible defaults.
 */
export function RebaseShell(props: RebaseShellProps) {
    const {
        title = "Rebase",
        appBar,
        drawer,
        autoOpenDrawer = true,
        defaultDrawerOpen = false,
        logo,
        children
    } = props;

    const registry = useRebaseRegistry();

    // Compute devViews for the layout's AdminModeSyncer
    const devViews = useMemo(() => {
        return registry.studioConfig?.devViews ?? [];
    }, [registry.studioConfig?.devViews]);

    return (
        <RebaseAuthGate>
            <RebaseNavigation>
                <ErrorBoundary fullPage>
                    <RebaseRouteDefs
                        layout={
                            <RebaseLayout
                                title={title}
                                appBar={appBar}
                                drawer={drawer}
                                autoOpenDrawer={autoOpenDrawer}
                                defaultDrawerOpen={defaultDrawerOpen}
                                logo={logo}
                                devViews={devViews}
                            />
                        }
                    >
                        {children}
                    </RebaseRouteDefs>
                </ErrorBoundary>
            </RebaseNavigation>
        </RebaseAuthGate>
    );
}
