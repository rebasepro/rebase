import React from "react";
import { useNavigate } from "react-router-dom";
import { Typography } from "@rebasepro/ui";
import { BarChart3, LayoutDashboard, ArrowRight } from "lucide-react";
import type { DashboardDefinition } from "../../types";

/**
 * Full-page list of all code-defined dashboards.
 * Shown when navigating to `/dashboards` without a specific ID.
 */
export function DashboardsListView({
    dashboards,
}: {
    dashboards: DashboardDefinition[];
}) {
    const navigate = useNavigate();

    return (
        <div className="p-6 max-w-[1000px] mx-auto w-full">
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400">
                    <LayoutDashboard size={22} />
                </div>
                <div>
                    <Typography variant="h5" className="font-semibold">
                        Dashboards
                    </Typography>
                    <Typography
                        variant="body2"
                        className="text-surface-500 dark:text-surface-400"
                    >
                        {dashboards.length} dashboard{dashboards.length !== 1 ? "s" : ""} available
                    </Typography>
                </div>
            </div>

            {/* Dashboard cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {dashboards.map((dashboard) => (
                    <DashboardListCard
                        key={dashboard.id}
                        dashboard={dashboard}
                        onClick={() => navigate(dashboard.id)}
                    />
                ))}
            </div>
        </div>
    );
}

function DashboardListCard({
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
            className="group text-left rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-5 transition-all duration-200 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-lg cursor-pointer"
        >
            <div className="flex items-start gap-4">
                <div className="shrink-0 w-11 h-11 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 transition-colors group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40">
                    <BarChart3 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Typography variant="subtitle1" className="font-semibold truncate">
                            {dashboard.title}
                        </Typography>
                        <ArrowRight
                            size={16}
                            className="text-surface-300 dark:text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -translate-x-1 group-hover:translate-x-0 transition-transform"
                        />
                    </div>
                    {dashboard.description && (
                        <Typography
                            variant="body2"
                            className="text-surface-500 dark:text-surface-400 line-clamp-2 mt-1"
                        >
                            {dashboard.description}
                        </Typography>
                    )}
                    <div className="flex items-center gap-3 mt-3 text-xs text-surface-400 dark:text-surface-500">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-100 dark:bg-surface-700/50">
                            {widgetCount} widget{widgetCount !== 1 ? "s" : ""}
                        </span>
                        {chartCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                                {chartCount} chart{chartCount !== 1 ? "s" : ""}
                            </span>
                        )}
                        {scorecardCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                                {scorecardCount} scorecard{scorecardCount !== 1 ? "s" : ""}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
}

DashboardsListView.displayName = "DashboardsListView";
