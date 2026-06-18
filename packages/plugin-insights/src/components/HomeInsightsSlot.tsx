import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Scorecard insights panel rendered at the top of the home page.
 * Injected via the `home.children.start` slot.
 *
 * Renders scorecards in a responsive grid (up to 4 columns).
 */
export function HomeInsightsSlot({
    insights
}: {
    insights: InsightDefinition[];
}) {
    if (!insights || insights.length === 0) return null;

    return (
        <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-6"
            style={{ minHeight: 92 }}
        >
            {insights.map((def) => (
                <InsightWidget key={def.id} definition={def} />
            ))}
        </div>
    );
}

HomeInsightsSlot.displayName = "HomeInsightsSlot";
