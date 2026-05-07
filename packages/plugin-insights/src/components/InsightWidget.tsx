import React from "react";
import type { InsightDefinition, DataRow, HydratedChartConfig } from "../types";
import { useInsightsData } from "../engine/useInsightsData";
import { InsightsChartView } from "./InsightsChartView";
import { InsightsScorecardView } from "./InsightsScorecardView";
import { InsightWidgetSkeleton } from "./InsightWidgetSkeleton";

/**
 * Single insight widget orchestrator.
 *
 * Fetches data via the engine, renders the appropriate visualization
 * (chart or scorecard) based on the definition type, and manages
 * loading/error states.
 *
 * When `dashboard` is true, the widget is rendered inside a dashboard card
 * that already provides background/border styling, so inner components
 * skip their own borders.
 *
 * All theme-awareness is handled via Tailwind `dark:` classes — no isDarkMode prop.
 */
export function InsightWidget({
    definition,
    collectionSlug,
    compact = false,
    dashboard = false,
}: {
    definition: InsightDefinition;
    collectionSlug?: string;
    compact?: boolean;
    /** When true, inner views skip their own borders since the parent card provides them. */
    dashboard?: boolean;
}) {
    const { data, loading, error } = useInsightsData(definition, collectionSlug);

    if (loading) {
        return <InsightWidgetSkeleton type={definition.type} compact={compact} embedded={dashboard} />;
    }

    if (error) {
        return (
            <div
                className={`text-red-500/70 dark:text-red-400/70 text-[0.8125rem] ${dashboard ? "px-5 py-4 h-full" : `rounded-lg bg-red-500/5 dark:bg-red-400/5 border border-red-500/10 dark:border-red-400/10 ${compact ? "px-3.5 py-3" : "px-5 py-4"}`}`}
            >
                <div className="font-semibold mb-1">{definition.title}</div>
                <div>{error.message}</div>
            </div>
        );
    }

    if (!data || data.rows.length === 0) {
        return (
            <div
                className={`text-surface-400 dark:text-surface-500 text-[0.8125rem] ${dashboard ? "px-5 py-4 h-full" : `rounded-lg bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 ${compact ? "px-3.5 py-3" : "px-5 py-4"}`}`}
            >
                {definition.title} — No data
            </div>
        );
    }

    if (definition.type === "chart" && definition.chart) {
        const hydratedConfig = {
            ...definition.chart,
            data: { values: data.rows },
        } as HydratedChartConfig;

        // Dashboard mode: fill parent (parent card has explicit height set)
        // Standalone mode: use fixed pixel height
        const heightClass = dashboard ? "h-full" : compact ? "h-[160px]" : "h-[240px]";

        return (
            <div className={`flex flex-col ${heightClass}`}>
                {definition.title && (
                    <div className={`font-semibold shrink-0 text-surface-600 dark:text-surface-300 ${dashboard ? "text-sm px-5 pt-4 pb-2" : "text-[0.8125rem] mb-2"}`}>
                        {definition.title}
                    </div>
                )}
                <div className={`flex-1 min-h-0 ${dashboard ? "px-3 pb-3" : ""}`}>
                    <InsightsChartView config={hydratedConfig} embedded={dashboard} />
                </div>
            </div>
        );
    }

    if (definition.type === "scorecard" && definition.scorecard) {
        return (
            <InsightsScorecardView
                config={definition.scorecard}
                data={data.rows[0] as DataRow}
                title={definition.title}
                compact={compact}
                embedded={dashboard}
            />
        );
    }

    return null;
}

InsightWidget.displayName = "InsightWidget";
