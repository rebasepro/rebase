import React from "react";
import { useParams } from "react-router-dom";
import type { DashboardDefinition } from "../../types";
import { CodeDashboardView } from "./CodeDashboardView";
import { CenteredView, Typography } from "@rebasepro/ui";
import { DashboardsListView } from "./DashboardsListView";

/**
 * Route component that resolves a `DashboardDefinition` by URL param
 * and renders it. No database calls — just a lookup into the
 * code-defined dashboards array.
 *
 * URL structure:
 * - `/dashboards`          → shows list of all dashboards
 * - `/dashboards/:id`      → shows specific dashboard
 *
 * The wildcard segment is extracted via `params["*"]` since
 * Rebase registers `slug/*` routes for nested views.
 */
export function CodeDashboardRoute({
    dashboards,
}: {
    dashboards: DashboardDefinition[];
}) {
    const params = useParams();
    // Rebase uses slug/* pattern, so the nested segment is in params["*"]
    const dashboardId = params["*"] || "";

    // No ID → show the dashboard list
    if (!dashboardId) {
        return <DashboardsListView dashboards={dashboards} />;
    }

    const dashboard = dashboards.find((d) => d.id === dashboardId);

    if (!dashboard) {
        return (
            <CenteredView>
                <Typography variant="label" className="text-surface-500 dark:text-surface-400">
                    Dashboard not found: {dashboardId}
                </Typography>
            </CenteredView>
        );
    }

    return <CodeDashboardView dashboard={dashboard} />;
}

CodeDashboardRoute.displayName = "CodeDashboardRoute";
