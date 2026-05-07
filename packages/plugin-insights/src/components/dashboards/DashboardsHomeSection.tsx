import React from "react";
import type { DashboardDefinition } from "../../types";
import { Typography } from "@rebasepro/ui";
import { useNavigate } from "react-router-dom";
import { BarChart3, LayoutDashboard } from "lucide-react";

/**
 * Renders a grid of dashboard cards on the home page.
 * Clicking a card navigates to `/dashboards/:id`.
 */
export function DashboardsHomeSection({
    dashboards,
}: {
    dashboards: DashboardDefinition[];
}) {
    const navigate = useNavigate();

    if (!dashboards || dashboards.length === 0) return null;

    return (
        <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
                <LayoutDashboard
                    size={18}
                    className="text-surface-400 dark:text-surface-500"
                />
                <Typography variant="subtitle2" className="font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 text-xs">
                    Dashboards
                </Typography>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {dashboards.map((dashboard) => (
                    <DashboardCard
                        key={dashboard.id}
                        dashboard={dashboard}
                        onClick={() => navigate(`/dashboards/${dashboard.id}`)}
                    />
                ))}
            </div>
        </div>
    );
}

function DashboardCard({
    dashboard,
    onClick,
}: {
    dashboard: DashboardDefinition;
    onClick: () => void;
}) {
    const widgetCount = dashboard.widgets.length;
    const chartCount = dashboard.widgets.filter((w) => w.type === "chart").length;
    const scorecardCount = dashboard.widgets.filter((w) => w.type === "scorecard").length;

    return (
        <button
            onClick={onClick}
            className="group text-left rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-4 transition-all duration-200 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md cursor-pointer"
        >
            <div className="flex items-start gap-3">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 transition-colors group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                    <BarChart3 size={18} />
                </div>
                <div className="min-w-0 flex-1">
                    <Typography variant="subtitle2" className="font-semibold truncate">
                        {dashboard.title}
                    </Typography>
                    {dashboard.description && (
                        <Typography
                            variant="caption"
                            className="text-surface-500 dark:text-surface-400 line-clamp-2 mt-0.5"
                        >
                            {dashboard.description}
                        </Typography>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-surface-400 dark:text-surface-500">
                        <span>{widgetCount} widget{widgetCount !== 1 ? "s" : ""}</span>
                        {chartCount > 0 && (
                            <>
                                <span className="w-0.5 h-0.5 rounded-full bg-surface-300 dark:bg-surface-600" />
                                <span>{chartCount} chart{chartCount !== 1 ? "s" : ""}</span>
                            </>
                        )}
                        {scorecardCount > 0 && (
                            <>
                                <span className="w-0.5 h-0.5 rounded-full bg-surface-300 dark:bg-surface-600" />
                                <span>{scorecardCount} scorecard{scorecardCount !== 1 ? "s" : ""}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
}

DashboardsHomeSection.displayName = "DashboardsHomeSection";
