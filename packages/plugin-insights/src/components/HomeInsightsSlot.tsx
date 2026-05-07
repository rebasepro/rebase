import React from "react";
import type { InsightDefinition } from "../types";
import { InsightWidget } from "./InsightWidget";

/**
 * Full-width insights panel rendered at the top of the home page.
 * Injected via the `home.children.start` slot.
 *
 * Renders a responsive grid of insights (charts and scorecards)
 * that provides a dashboard-like overview.
 */
export function HomeInsightsSlot({
    insights,
    isDarkMode = false,
}: {
    context?: unknown;
    insights: InsightDefinition[];
    isDarkMode?: boolean;
}) {
    if (!insights || insights.length === 0) return null;

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${insights.some(i => i.type === "chart") ? "300px" : "220px"}, 1fr))`,
            gap: 16,
            padding: "0 0 24px",
        }}>
            {insights.map((def) => (
                <InsightWidget
                    key={def.id}
                    definition={def}
                    isDarkMode={isDarkMode}
                />
            ))}
        </div>
    );
}

HomeInsightsSlot.displayName = "HomeInsightsSlot";
