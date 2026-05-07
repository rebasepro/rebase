import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Full-width insights panel rendered at the top of the home page.
 * Injected via the `home.children.start` slot.
 *
 * Separates scorecards (compact 4-col grid) from charts (2-col grid)
 * to give each widget type the right amount of breathing room.
 */
export function HomeInsightsSlot({
    insights,
}: {
    context?: unknown;
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    const scorecards = insights.filter((i) => i.type === "scorecard");
    const charts = insights.filter((i) => i.type === "chart");

    return (
        <div className="flex flex-col gap-4 pb-6">
            {/* Scorecards — compact row */}
            {scorecards.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {scorecards.map((def) => (
                        <InsightWidget key={def.id} definition={def} />
                    ))}
                </div>
            )}
            {/* Charts — wider panels */}
            {charts.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {charts.map((def) => (
                        <InsightWidget key={def.id} definition={def} />
                    ))}
                </div>
            )}
        </div>
    );
}

HomeInsightsSlot.displayName = "HomeInsightsSlot";
