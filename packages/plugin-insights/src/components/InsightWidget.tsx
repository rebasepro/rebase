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
 * @param definition - The insight configuration
 * @param collectionSlug - Optional collection context
 * @param isDarkMode - Whether the UI is in dark mode
 * @param compact - Whether to render in compact (card-inline) mode
 */
export function InsightWidget({
    definition,
    collectionSlug,
    isDarkMode = false,
    compact = false,
}: {
    definition: InsightDefinition;
    collectionSlug?: string;
    isDarkMode?: boolean;
    compact?: boolean;
}) {
    const { data, loading, error } = useInsightsData(definition, collectionSlug);

    if (loading) {
        return <InsightWidgetSkeleton type={definition.type} compact={compact} />;
    }

    if (error) {
        return (
            <div
                className="rounded-lg"
                style={{
                    padding: compact ? "12px 14px" : "16px 20px",
                    color: isDarkMode
                        ? "rgba(239,68,68,0.7)"
                        : "rgba(220,38,38,0.7)",
                    fontSize: "0.8125rem",
                    backgroundColor: isDarkMode
                        ? "rgba(239,68,68,0.06)"
                        : "rgba(220,38,38,0.04)",
                    border: isDarkMode
                        ? "1px solid rgba(239,68,68,0.12)"
                        : "1px solid rgba(220,38,38,0.1)",
                }}
            >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {definition.title}
                </div>
                <div>{error.message}</div>
            </div>
        );
    }

    if (!data || data.rows.length === 0) {
        return (
            <div
                className="rounded-lg"
                style={{
                    padding: compact ? "12px 14px" : "16px 20px",
                    color: isDarkMode
                        ? "rgba(255,255,255,0.4)"
                        : "rgba(0,0,0,0.4)",
                    fontSize: "0.8125rem",
                    backgroundColor: isDarkMode
                        ? "rgba(255,255,255,0.02)"
                        : "rgba(0,0,0,0.02)",
                }}
            >
                {definition.title} — No data
            </div>
        );
    }

    if (definition.type === "chart" && definition.chart) {
        // Merge fetched data into the chart config
        const hydratedConfig: HydratedChartConfig = {
            ...definition.chart,
            data: { values: data.rows },
        };

        return (
            <div style={{ minHeight: compact ? 120 : 200, height: compact ? 180 : 260 }}>
                {!compact && definition.title && (
                    <div style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        marginBottom: 8,
                        color: isDarkMode
                            ? "rgba(255,255,255,0.72)"
                            : "rgba(0,0,0,0.72)",
                    }}>
                        {definition.title}
                    </div>
                )}
                <InsightsChartView
                    config={hydratedConfig}
                    isDarkMode={isDarkMode}
                />
            </div>
        );
    }

    if (definition.type === "scorecard" && definition.scorecard) {
        return (
            <InsightsScorecardView
                config={definition.scorecard}
                data={data.rows[0] as DataRow}
                title={definition.title}
                isDarkMode={isDarkMode}
                compact={compact}
            />
        );
    }

    return null;
}

InsightWidget.displayName = "InsightWidget";
