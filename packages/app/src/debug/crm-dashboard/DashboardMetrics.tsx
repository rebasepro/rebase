import React from "react";
import {
    Typography,
    cls,
    Card,
    Skeleton,
    UsersIcon,
    DollarSignIcon,
    AlertTriangleIcon,
    TrendingUpIcon
} from "@rebasepro/ui";

/* ── Types ────────────────────────────────────────────── */

interface InsightsData {
    activeClients: number;
    potentialRevenue: number;
    contractedRevenue: number;
    overdueTaskCount: number;
}

export interface DashboardMetricsProps {
    loading: boolean;
    insights: InsightsData | null;
    totalInPipeline: number;
    totalRevenue: number;
}

/* ── Component ────────────────────────────────────────── */

export function DashboardMetrics({
    loading,
    insights,
    totalInPipeline,
    totalRevenue
}: DashboardMetricsProps) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* In Pipeline */}
            <Card className="p-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
                        <UsersIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <Typography variant="caption" color="secondary" className="uppercase tracking-[0.05em] text-[10px]">In Pipeline</Typography>
                        {loading ? (
                            <Skeleton className="h-7 w-12 mt-0.5" />
                        ) : (
                            <Typography variant="h5" className="tabular-nums mt-0.5">
                                {totalInPipeline}
                            </Typography>
                        )}
                    </div>
                </div>
            </Card>

            {/* Active Clients */}
            <Card className="p-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
                        <TrendingUpIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <Typography variant="caption" color="secondary" className="uppercase tracking-[0.05em] text-[10px]">Active Clients</Typography>
                        {loading ? (
                            <Skeleton className="h-7 w-12 mt-0.5" />
                        ) : (
                            <Typography variant="h5" className="tabular-nums mt-0.5">
                                {insights?.activeClients ?? 0}
                            </Typography>
                        )}
                    </div>
                </div>
            </Card>

            {/* Total Revenue */}
            <Card className="p-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
                        <DollarSignIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <Typography variant="caption" color="secondary" className="uppercase tracking-[0.05em] text-[10px]">Revenue</Typography>
                        {loading ? (
                            <Skeleton className="h-7 w-20 mt-0.5" />
                        ) : (
                            <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2 mt-0.5">
                                <Typography variant="h5" className="tabular-nums">
                                    ${totalRevenue.toLocaleString()}
                                </Typography>
                                {insights && insights.contractedRevenue > 0 && (
                                    <Typography variant="caption" color="secondary" className="text-[10px]">
                                        (${insights.contractedRevenue.toLocaleString()} confirmed)
                                    </Typography>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            {/* Overdue Tasks */}
            <Card className="p-4">
                <div className="flex items-center gap-3">
                    <div className={cls(
                        "flex items-center justify-center w-5 h-5",
                        insights && insights.overdueTaskCount > 0
                            ? "text-red-500"
                            : "text-surface-400 dark:text-surface-500"
                    )}>
                        <AlertTriangleIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <Typography variant="caption" color="secondary" className="uppercase tracking-[0.05em] text-[10px]">Overdue Tasks</Typography>
                        {loading ? (
                            <Skeleton className="h-7 w-8 mt-0.5" />
                        ) : (
                            <Typography variant="h5" className={cls(
                                "tabular-nums mt-0.5",
                                insights && insights.overdueTaskCount > 0 && "text-red-600 dark:text-red-400"
                            )}>
                                {insights?.overdueTaskCount ?? 0}
                            </Typography>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}
